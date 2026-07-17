#!/usr/bin/env bash
# Starlink gateway — Phase 2 self-registration (Linux: Raspberry Pi / OpenWrt).
#
# Replaces the manual "admin tells you the VPS's WG endpoint + public key,
# you paste it into a config" step with one call: given a one-time
# enrollment token (from the admin panel's "Create enrollment token"
# action), this generates a local WireGuard keypair (if one doesn't already
# exist), registers with the backend, and writes BOTH the WireGuard tunnel
# config and the heartbeat.sh env file — so heartbeat.sh runs completely
# unchanged afterward.
#
# Phase 1's manual path (setup-raspberrypi.sh / setup-openwrt.sh with
# hand-relayed VPS endpoint+pubkey) still works exactly as before — this is
# an additional, optional path, not a replacement.
#
# Usage:
#   enroll.sh <enrollment-token> <vps-api-url> [wan-iface]
#
#   vps-api-url   e.g. https://api.setalink.no/starlink-enroll.php
#   wan-iface     the interface facing the Starlink router (default: wlan0)
#
# NOT exercised against real hardware — same caveat as the rest of this
# Starlink work (VPS-only environment, no gateway device available here).
# Review before running on an actual gateway.

set -euo pipefail

ENROLLMENT_TOKEN="${1:?usage: enroll.sh <enrollment-token> <vps-api-url> [wan-iface]}"
VPS_API_URL="${2:?missing vps-api-url, e.g. https://api.setalink.no/starlink-enroll.php}"
WAN_IFACE="${3:-wlan0}"

WG_IFACE="wg-starlink0"
WG_DIR="/etc/wireguard"
HB_ENV_FILE="${STARLINK_HB_CONFIG:-/etc/starlink-heartbeat.env}"
GW_ADDR="10.99.0.2/32"   # matches the current live rendezvous subnet — see
                          # docs/STARLINK_WINDOWS_HANDOFF.md §13 if this ever
                          # needs to change again; do not hand-edit blindly.

command -v wg   >/dev/null 2>&1 || { echo "wireguard-tools not installed (need 'wg'). apt-get install wireguard-tools first." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl not installed." >&2; exit 1; }

mkdir -p "$WG_DIR"
chmod 700 "$WG_DIR"
umask 077

if [[ ! -f "$WG_DIR/$WG_IFACE.key" ]]; then
  echo "== Generating a new WireGuard keypair for this gateway =="
  wg genkey | tee "$WG_DIR/$WG_IFACE.key" | wg pubkey > "$WG_DIR/$WG_IFACE.pub"
else
  echo "== Reusing existing keypair at $WG_DIR/$WG_IFACE.key =="
fi
PRIVATE_KEY="$(cat "$WG_DIR/$WG_IFACE.key")"
PUBLIC_KEY="$(cat "$WG_DIR/$WG_IFACE.pub")"

echo "== Calling $VPS_API_URL to self-register =="
response="$(curl -fsS --max-time 10 \
  -X POST "$VPS_API_URL" \
  -H "Authorization: Bearer $ENROLLMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"wg_public_key\":\"$PUBLIC_KEY\",\"platform\":\"linux\"}")"

# No jq dependency (not guaranteed present, same reasoning as heartbeat.sh) —
# a small, deliberately narrow grep/sed extraction instead of a full JSON parser.
extract() { echo "$response" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed -E "s/\"$1\":\"([^\"]*)\"/\1/"; }

ok="$(echo "$response" | grep -o '"ok":[a-z]*' | head -1)"
if [[ "$ok" != '"ok":true' ]]; then
  echo "Enrollment failed. Server response:" >&2
  echo "$response" >&2
  exit 1
fi

NODE_ID="$(extract node_id)"
HEARTBEAT_TOKEN="$(extract heartbeat_token)"
VPS_WG_ENDPOINT="$(extract vps_wg_endpoint)"
VPS_WG_PUBLIC_KEY="$(extract vps_wg_public_key)"

if [[ -z "$NODE_ID" || -z "$HEARTBEAT_TOKEN" ]]; then
  echo "Enrollment response missing node_id/heartbeat_token — did the server response shape change? Raw response:" >&2
  echo "$response" >&2
  exit 1
fi

echo "== Registered as $NODE_ID =="

if [[ -z "$VPS_WG_ENDPOINT" || -z "$VPS_WG_PUBLIC_KEY" ]]; then
  echo "WARNING: server did not return vps_wg_endpoint/vps_wg_public_key" \
       "(STARLINK_WG_ENDPOINT / STARLINK_WG_PUBLIC_KEY env vars not set on the" \
       "VPS yet). Node identity + heartbeat token ARE registered below, but" \
       "you still need to fill in the WireGuard [Peer] section by hand," \
       "same as the Phase 1 manual path." >&2
fi

cat > "$WG_DIR/$WG_IFACE.conf" <<EOF
[Interface]
Address = $GW_ADDR
PrivateKey = $PRIVATE_KEY
PostUp   = iptables -t nat -A POSTROUTING -o $WAN_IFACE -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -o $WAN_IFACE -j MASQUERADE

[Peer]
PublicKey = ${VPS_WG_PUBLIC_KEY:-REPLACE_ME_VPS_PUBLIC_KEY}
Endpoint = ${VPS_WG_ENDPOINT:-REPLACE_ME_VPS_IP:PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOF
chmod 600 "$WG_DIR/$WG_IFACE.conf"
echo "Wrote $WG_DIR/$WG_IFACE.conf"

mkdir -p "$(dirname "$HB_ENV_FILE")"
cat > "$HB_ENV_FILE" <<EOF
VPS_API_URL=${VPS_API_URL%starlink-enroll.php}starlink-heartbeat.php
NODE_ID=$NODE_ID
HEARTBEAT_TOKEN=$HEARTBEAT_TOKEN
WG_IFACE=$WG_IFACE
WAN_IFACE=$WAN_IFACE
HANDSHAKE_STALE_SECS=180
EOF
chmod 600 "$HB_ENV_FILE"
echo "Wrote $HB_ENV_FILE — heartbeat.sh AND watchdog.sh (both unchanged) pick this up automatically."

echo
echo "== Next steps (same as the manual Phase 1 path from here) =="
echo "  1. sysctl -w net.ipv4.ip_forward=1 (and persist in /etc/sysctl.conf)"
echo "  2. systemctl enable --now wg-quick@$WG_IFACE"
echo "  3. Install heartbeat.sh + watchdog.sh + the systemd timers -- see setup-raspberrypi.sh's"
echo "     'Installing heartbeat.sh + watchdog.sh' section for the exact install/enable commands"
echo "     (this enrollment script only writes config, it doesn't install the scripts themselves)."
echo "  4. In the admin panel, confirm this node shows ONLINE within ~90s, then flip 'enabled' when ready."
