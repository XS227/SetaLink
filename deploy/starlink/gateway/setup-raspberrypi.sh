#!/usr/bin/env bash
# Starlink gateway — Raspberry Pi (Debian/Raspberry Pi OS) setup, alternative
# to the OpenWrt travel router. Assumes the Pi is connected to the Starlink
# Mini's Wi-Fi (via USB Wi-Fi adapter or the Pi's onboard Wi-Fi) as its
# default route, or via Ethernet if the Starlink router is reachable by cable.
#
# Run this ON THE RASPBERRY PI, not on the VPS.
# Usage: setup-raspberrypi.sh <vps-public-ip> <vps-wg-port> <vps-wg-public-key> [wan-iface]

set -euo pipefail

VPS_IP="${1:?usage: setup-raspberrypi.sh <vps-public-ip> <vps-wg-port> <vps-wg-public-key> [wan-iface]}"
VPS_PORT="${2:?missing vps-wg-port}"
VPS_PUBKEY="${3:?missing vps-wg-public-key}"
WAN_IFACE="${4:-wlan0}"   # the interface facing the Starlink router — override if using eth0

WG_IFACE="wg-starlink0"
GW_ADDR="10.90.0.2/32"
GATEWAY_DIR="/opt/starlink-gateway"
HB_ENV_FILE="${STARLINK_HB_CONFIG:-/etc/starlink-heartbeat.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Starlink gateway setup (Raspberry Pi) =="
echo "WAN-facing interface (toward the Starlink router): $WAN_IFACE"

apt-get update -qq
# python3 is for Node Console command dispatch in heartbeat.sh (safe JSON
# parse/encode of remote commands + their output) -- ships by default on
# Raspberry Pi OS/Debian already, listed explicitly so a minimal/server
# image still gets it.
apt-get install -y -qq wireguard-tools iptables python3

echo "-- Enabling IP forwarding --"
if ! grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf; then
  echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
fi
sysctl -w net.ipv4.ip_forward=1

WG_DIR="/etc/wireguard"
mkdir -p "$WG_DIR"
chmod 700 "$WG_DIR"

umask 077
if [[ ! -f "$WG_DIR/$WG_IFACE.key" ]]; then
  wg genkey | tee "$WG_DIR/$WG_IFACE.key" | wg pubkey > "$WG_DIR/$WG_IFACE.pub"
fi
PRIVATE_KEY="$(cat "$WG_DIR/$WG_IFACE.key")"
PUBLIC_KEY="$(cat "$WG_DIR/$WG_IFACE.pub")"

echo
echo "== Gateway public key (paste this into the VPS's wg-starlink0.conf [Peer] block) =="
echo "$PUBLIC_KEY"
echo

cat > "$WG_DIR/$WG_IFACE.conf" <<EOF
[Interface]
Address = $GW_ADDR
PrivateKey = $PRIVATE_KEY
# NAT: decapsulated tunnel traffic egresses via the Starlink WAN interface.
# Only masquerades traffic that came IN via the tunnel — the Pi's own SSH/
# admin traffic is unaffected (it never touches this interface).
PostUp   = iptables -t nat -A POSTROUTING -o $WAN_IFACE -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -o $WAN_IFACE -j MASQUERADE

[Peer]
PublicKey = $VPS_PUBKEY
Endpoint = $VPS_IP:$VPS_PORT
AllowedIPs = 10.90.0.1/32
# Always-initiate keepalive — this is what makes the tunnel work behind
# Starlink's CGNAT: the Pi dials out and refreshes the NAT mapping, the VPS
# never needs to dial in.
PersistentKeepalive = 25
EOF
chmod 600 "$WG_DIR/$WG_IFACE.conf"

systemctl enable --now "wg-quick@$WG_IFACE"

echo
echo "-- Installing heartbeat.sh + watchdog.sh (Node Console + self-heal) --"
mkdir -p "$GATEWAY_DIR"
install -m 755 "$SCRIPT_DIR/heartbeat.sh" "$GATEWAY_DIR/heartbeat.sh"
install -m 755 "$SCRIPT_DIR/watchdog.sh" "$GATEWAY_DIR/watchdog.sh"

if [[ ! -f "$HB_ENV_FILE" ]]; then
  install -m 600 "$SCRIPT_DIR/config.template.env" "$HB_ENV_FILE"
  # Pre-fill what this setup run already knows -- VPS_API_URL/HEARTBEAT_TOKEN
  # still need the admin panel's "Generate heartbeat token" value, same gap
  # as the Windows path's config.template.env step 4.
  sed -i "s/^WG_IFACE=.*/WG_IFACE=$WG_IFACE/" "$HB_ENV_FILE"
  sed -i "s/^WAN_IFACE=.*/WAN_IFACE=$WAN_IFACE/" "$HB_ENV_FILE"
  echo "Wrote $HB_ENV_FILE (mode 600) -- VPS_API_URL and HEARTBEAT_TOKEN still need filling in."
else
  echo "$HB_ENV_FILE already exists -- left untouched."
fi

echo "-- Installing systemd timers (heartbeat ~30s, watchdog ~60s, both boot-persistent) --"
install -m 644 "$SCRIPT_DIR/systemd/starlink-heartbeat.service" /etc/systemd/system/
install -m 644 "$SCRIPT_DIR/systemd/starlink-heartbeat.timer" /etc/systemd/system/
install -m 644 "$SCRIPT_DIR/systemd/starlink-watchdog.service" /etc/systemd/system/
install -m 644 "$SCRIPT_DIR/systemd/starlink-watchdog.timer" /etc/systemd/system/
systemctl daemon-reload
# enable (boot-persistent) but do NOT --now start yet -- HEARTBEAT_TOKEN is
# still blank at this point and every run would just fail loudly until it's
# filled in. Start manually after step 3 below.
systemctl enable starlink-heartbeat.timer starlink-watchdog.timer

echo
echo "== Done. Verify the tunnel with: =="
echo "     wg show"
echo "     ping -c3 10.90.0.1        # should reach the VPS over the tunnel"
echo
echo "== Next steps (heartbeat/watchdog are installed but NOT started yet): =="
echo "  1. In the admin panel's Starlink tab: 'Generate heartbeat token' for $VPS_IP's node."
echo "  2. Fill in VPS_API_URL and HEARTBEAT_TOKEN in $HB_ENV_FILE."
echo "  3. systemctl start starlink-heartbeat.timer starlink-watchdog.timer"
echo "  4. Confirm the node shows ONLINE in the admin panel within ~90s, then flip 'enabled' when ready."
echo "  5. Reboot once and confirm both timers fire again without any manual step (automatic recovery check)."
