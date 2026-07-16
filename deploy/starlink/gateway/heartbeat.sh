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
