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

echo "== Starlink gateway setup (Raspberry Pi) =="
echo "WAN-facing interface (toward the Starlink router): $WAN_IFACE"

apt-get update -qq
apt-get install -y -qq wireguard-tools iptables

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
echo "== Done. Verify with: =="
echo "     wg show"
echo "     ping -c3 10.90.0.1        # should reach the VPS over the tunnel"
echo "== Next: install heartbeat.sh as a cron job (see deploy/starlink/gateway/heartbeat.sh). =="
