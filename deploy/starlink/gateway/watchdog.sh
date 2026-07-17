#!/usr/bin/env bash
# Starlink gateway watchdog — Linux (Raspberry Pi / Debian). Run every ~60s
# via the starlink-watchdog.timer systemd unit installed by
# setup-raspberrypi.sh (falls back to cron if systemd isn't in use).
#
# Linux does NOT have Windows ICS's "toggle amnesia" problem (see
# docs/STARLINK_WINDOWS_HANDOFF.md sections 17/20) — wg-quick's own
# PostUp/PostDown manage the NAT rule declaratively and there is no COM
# event chain to wedge. This script's job is correspondingly simpler:
#
#   1. TUNNEL LIVENESS — same handshake-age approach as heartbeat.sh /
#      the Windows watchdog: fi-hel drops inner ICMP by design, so a stale
#      `wg show` handshake (not a failed ping) is what triggers a restart.
#   2. DEFENSIVE RE-ASSERT — re-enable IPv4 forwarding and re-add the NAT
#      MASQUERADE rule if either was somehow lost (a reboot before the
#      sysctl.conf write took effect, an external `iptables -F`, etc.).
#      Idempotent and cheap, so it runs every cycle regardless of duty 1.
#
# Backs off (does nothing but log) if the WAN-facing interface itself has
# no carrier/no route — restarting wg-quick while the underlying Starlink
# link is down would just thrash it and falsely inflate the disconnect
# count for what is actually a Starlink outage, not a tunnel problem (same
# reasoning as the Windows watchdog's Starlink-adapter-down backoff).
#
# Reports every self-heal to public/starlink-command-result.php as a
# self_heal:true event (Node Console, see lib/node_console.php) — this is
# what feeds node_command_events, which ni_rebuild_genome() in
# lib/node_intel.php folds into the node's stability score. Best-effort:
# a reporting failure never affects the local repair, which has already
# happened by the time reporting is attempted.

set -uo pipefail

CONFIG_FILE="${STARLINK_HB_CONFIG:-/etc/starlink-heartbeat.env}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

: "${WG_IFACE:=wg-starlink0}"
: "${WAN_IFACE:=wlan0}"
: "${HANDSHAKE_STALE_SECS:=180}"

LOG_DIR="${STARLINK_LOG_DIR:-/var/log/starlink-gateway}"
mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="/tmp"
LOG_FILE="$LOG_DIR/watchdog.log"
DISCONNECTS_LOG="$LOG_DIR/disconnects.log"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG_FILE"; }
record_disconnect() { date -u +%Y-%m-%dT%H:%M:%SZ >> "$DISCONNECTS_LOG"; }

# Rotate — this runs forever every ~60s, don't let the log fill the disk
# (same 5MB threshold as the Windows watchdog).
if [[ -f "$LOG_FILE" ]] && [[ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]]; then
  mv -f "$LOG_FILE" "$LOG_FILE.1"
fi

# --- Self-heal reporting (Node Console) -------------------------------------
# VPS_API_URL/NODE_ID/HEARTBEAT_TOKEN come from the same CONFIG_FILE as
# heartbeat.sh. If unset, reporting silently no-ops — the repair below still
# happens regardless, this is optional telemetry, not a dependency.
report_self_heal() {
  local action="$1" success="$2" duration_ms="$3" before="$4" after="$5"
  [[ -z "${VPS_API_URL:-}" || -z "${NODE_ID:-}" || -z "${HEARTBEAT_TOKEN:-}" ]] && return 0
  local result_url="${VPS_API_URL/starlink-heartbeat.php/starlink-command-result.php}"
  if [[ "$result_url" == "$VPS_API_URL" ]]; then
    log "WARN: cannot derive command-result URL from VPS_API_URL='$VPS_API_URL' -- skipping self-heal report."
    return 0
  fi
  local payload
  payload="$(cat <<JSON
{
  "self_heal": true,
  "recovery_action": "$action",
  "success": $success,
  "duration_ms": $duration_ms,
  "health_before": "$before",
  "health_after": "$after"
}
JSON
)"
  curl -fsS --max-time 6 \
    -X POST "$result_url" \
    -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null 2>&1 || log "WARN: could not report self-heal '$action' to server."
}

# --- Is the WAN-facing interface (toward the Starlink router) even up? -----
if ! ip link show "$WAN_IFACE" 2>/dev/null | grep -q 'state UP'; then
  log "WAN interface '$WAN_IFACE' is not UP -- backing off, not touching the tunnel. This is a Starlink/Wi-Fi problem, not a tunnel problem."
  exit 0
fi

if ! ping -c 2 -W 2 -I "$WAN_IFACE" 8.8.8.8 >/dev/null 2>&1; then
  log "WAN interface '$WAN_IFACE' is UP but no internet reachable through it -- backing off, not restarting the tunnel (would just thrash it while the real cause is upstream)."
  exit 0
fi

# --- Duty 2: defensive re-assert (cheap, every run, order matches Windows
#     watchdog's Assert-ExitPath: forwarding + NAT, independent of duty 1). -
if [[ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0)" != "1" ]]; then
  sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
  log "HEALED: IPv4 forwarding was disabled -- re-enabled."
  report_self_heal "ip_forward_assert" true 0 "disabled" "enabled"
fi

if ! iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null; then
  if iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null; then
    log "HEALED: NAT MASQUERADE rule for '$WAN_IFACE' was missing -- re-added."
    record_disconnect
    report_self_heal "nat_rule_assert" true 0 "missing" "restored"
  else
    log "ERROR: NAT MASQUERADE rule for '$WAN_IFACE' missing and could not be re-added."
    report_self_heal "nat_rule_assert" false 0 "missing" "still_missing"
  fi
fi

# --- Duty 1: tunnel liveness via handshake age (fi-hel drops inner ICMP by
#     design -- see heartbeat.sh's identical reasoning). --------------------
if ! command -v wg >/dev/null 2>&1; then
  log "WARN: wg CLI not found -- cannot check tunnel liveness. Is wireguard-tools installed?"
  exit 1
fi

latest_hs="$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk '{print $2}' | head -1)"
latest_hs="${latest_hs:-0}"
now_ts="$(date +%s)"
age=$(( now_ts - latest_hs ))

if [[ "$latest_hs" -gt 0 && "$age" -le "$HANDSHAKE_STALE_SECS" ]]; then
  log "Tunnel healthy -- handshake ${age}s ago."
  exit 0
fi

log "Tunnel stale -- handshake ${age}s ago (limit ${HANDSHAKE_STALE_SECS}s, latest_hs=$latest_hs). Restarting wg-quick@$WG_IFACE."
restart_start_ms="$(date +%s%3N)"
if systemctl restart "wg-quick@$WG_IFACE" 2>/dev/null; then
  restart_ok=true
else
  # systemd not managing it (manual wg-quick usage) -- fall back directly.
  wg-quick down "$WG_IFACE" >/dev/null 2>&1 || true
  if wg-quick up "$WG_IFACE" >/dev/null 2>&1; then restart_ok=true; else restart_ok=false; fi
fi
record_disconnect
sleep 3

retry_hs="$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk '{print $2}' | head -1)"
retry_hs="${retry_hs:-0}"
retry_age=$(( $(date +%s) - retry_hs ))
duration_ms=$(( $(date +%s%3N) - restart_start_ms ))

if [[ "$retry_hs" -gt 0 && "$retry_age" -le "$HANDSHAKE_STALE_SECS" ]]; then
  log "Restart fixed it -- handshake ${retry_age}s ago."
  report_self_heal "tunnel_restart" true "$duration_ms" "stale_${age}s" "healed_${retry_age}s"
else
  log "Still stale after restart (restart command itself: ok=$restart_ok). Will retry next cycle."
  report_self_heal "tunnel_restart" false "$duration_ms" "stale_${age}s" "still_stale"
fi
