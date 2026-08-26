#!/usr/bin/env bash
# Starlink gateway heartbeat — run every ~30s via cron/systemd-timer on the
# gateway device (OpenWrt: cron; Raspberry Pi: cron or a systemd timer).
#
# Reports tunnel/health telemetry to public/starlink-heartbeat.php over plain
# HTTPS to the VPS's normal public address — deliberately NOT through the
# WireGuard tunnel itself, so a dead tunnel can still be reported as dead.
#
# Config: fill in the four variables below (or export them from
# /etc/starlink-heartbeat.env and `source` it here) before installing.
#
#   VPS_API_URL     e.g. https://api.setalink.no/starlink-heartbeat.php
#   NODE_ID         e.g. starlink-no-01
#   HEARTBEAT_TOKEN the full "starlink-node-<id>:<secret>" string from the
#                   admin panel's "Generate heartbeat token" button
#                   (shown once — store it in this env file, mode 600)
#   WG_IFACE        e.g. wg-starlink0 (Pi) or wgstarlink (OpenWrt)

set -uo pipefail

CONFIG_FILE="${STARLINK_HB_CONFIG:-/etc/starlink-heartbeat.env}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

: "${VPS_API_URL:?set VPS_API_URL in $CONFIG_FILE}"
: "${NODE_ID:?set NODE_ID in $CONFIG_FILE}"
: "${HEARTBEAT_TOKEN:?set HEARTBEAT_TOKEN in $CONFIG_FILE}"
: "${WG_IFACE:=wg-starlink0}"

# Tunnel status: does the WG interface have a recent handshake?
tunnel_status="down"
latest_handshake=0
if command -v wg >/dev/null 2>&1; then
  latest_handshake="$(wg show "$WG_IFACE" latest-handshakes 2>/dev/null | awk '{print $2}' | head -1)"
  latest_handshake="${latest_handshake:-0}"
  now="$(date +%s)"
  if [[ "$latest_handshake" -gt 0 ]] && (( now - latest_handshake < 150 )); then
    tunnel_status="up"
  fi
fi

# Latency + loss: ping the VPS's tunnel address over the WG interface itself
# (not a public target) so this measures the tunnel's own health, not the
# general internet's.
ping_out="$(ping -c 5 -W 2 -I "$WG_IFACE" 10.90.0.1 2>/dev/null || true)"
latency_ms="$(echo "$ping_out" | awk -F'/' '/rtt|round-trip/{print $5}' | cut -d. -f1)"
loss_pct="$(echo "$ping_out" | grep -oE '[0-9]+(\.[0-9]+)?% packet loss' | grep -oE '^[0-9.]+')"
latency_ms="${latency_ms:-}"
loss_pct="${loss_pct:-100}"

exit_ip="$(curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null || echo '')"
uptime_secs="$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo '')"
sw_version="phase1-$(date +%Y%m%d)"

payload="$(cat <<JSON
{
  "tunnel_status": "$tunnel_status",
  "exit_ip": "$exit_ip",
  "latency_ms": ${latency_ms:-null},
  "packet_loss_pct": ${loss_pct:-null},
  "uptime_secs": ${uptime_secs:-null},
  "software_version": "$sw_version"
}
JSON
)"

response="$(curl -fsS --max-time 6 \
  -X POST "$VPS_API_URL" \
  -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload" 2>/dev/null || true)"   # never crash the cron job on a transient network blip

# Persist the server's response (health_state + admin-controlled config —
# enabled/maintenance_mode/max_sessions/allocated_kbps, see
# lib/starlink.php:st_gateway_config()) so an admin change on the VPS is
# visible on the gateway without a redeploy. No dependency on jq (not
# guaranteed present on OpenWrt) — written as-is, whatever consumes it
# parses the JSON itself.
[[ -n "$response" ]] && echo "$response" > "${STARLINK_HB_STATE_FILE:-/tmp/starlink-node-config.json}" 2>/dev/null || true

# --- Node Console (Phase 1, 2026-07-17): dispatch pending commands, report
# results. Keys MUST match lib/node_console.php's NC_COMMAND_REGISTRY exactly
# -- this case statement is the node-side half of the two-independent-
# enforcement-points rule (server registry + this allowlist; never a raw
# string executed from the server). Requires python3 for safe JSON parsing/
# encoding of command output (ships by default on Raspberry Pi OS/Debian).
# If python3 is absent, this whole block is skipped -- heartbeat delivery
# itself is unaffected, only remote-command dispatch is unavailable (logged
# once so it's visible, not silently missing).
if [[ -n "$response" ]] && command -v python3 >/dev/null 2>&1; then
  cmd_lines="$(printf '%s' "$response" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for c in (data.get("commands") or []):
    print("\t".join([str(c.get("command_id","")), str(c.get("command_key","")), str(c.get("token",""))]))
' 2>/dev/null || true)"

  if [[ -n "$cmd_lines" ]]; then
    result_url="${VPS_API_URL/starlink-heartbeat.php/starlink-command-result.php}"
    while IFS=$'\t' read -r cmd_id cmd_key token; do
      # Defensive: command_id/token are always hex (bin2hex / hash_hmac
      # output server-side) -- reject anything else rather than passing it
      # through to the shell/python invocations below.
      [[ "$cmd_id" =~ ^[0-9a-f]+$ && "$token" =~ ^[0-9a-f]+$ ]] || continue

      cmd_start_ms="$(date +%s%3N)"
      success=true
      case "$cmd_key" in
        wg_status)
          output="$(wg show 2>&1 || true)"
          ;;
        network_status)
          output="$(ip addr show 2>&1; echo '---'; ip route show 2>&1)"
          ;;
        last_100_logs)
          output="$(tail -n 100 "${STARLINK_LOG_DIR:-/var/log/starlink-gateway}/watchdog.log" 2>&1 || echo '(no watchdog.log yet)')"
          ;;
        refresh_telemetry)
          # No-op signal: the heartbeat that just ran IS the refresh.
          output="telemetry refresh acknowledged -- next heartbeat cycle carries current state"
          ;;
        restart_wireguard)
          if systemctl restart "wg-quick@$WG_IFACE" 2>&1; then
            output="restarted wg-quick@$WG_IFACE"
          else
            output="failed to restart wg-quick@$WG_IFACE"
            success=false
          fi
          ;;
        *)
          output="unknown command_key on this gateway: $cmd_key"
          success=false
          ;;
      esac
      duration_ms=$(( $(date +%s%3N) - cmd_start_ms ))

      if [[ -n "$result_url" && "$result_url" != "$VPS_API_URL" ]]; then
        payload_file="$(mktemp)"
        printf '%s' "$output" | python3 -c "
import json, sys
print(json.dumps({
    'command_id': '$cmd_id',
    'token': '$token',
    'success': $([ "$success" = true ] && echo True || echo False),
    'duration_ms': $duration_ms,
    'output': sys.stdin.read()[:8000],
}))
" > "$payload_file" 2>/dev/null

        curl -fsS --max-time 6 \
          -X POST "$result_url" \
          -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
          -H "Content-Type: application/json" \
          -d @"$payload_file" >/dev/null 2>&1 || true
        rm -f "$payload_file"
      fi
    done <<< "$cmd_lines"
  fi
elif [[ -n "$response" ]] && ! command -v python3 >/dev/null 2>&1; then
  : # python3 missing -- command dispatch unavailable, telemetry unaffected. Not logged every cycle to avoid log spam; see setup script output for the one-time warning.
fi
