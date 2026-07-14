#!/bin/sh
# Starlink gateway — OpenWrt setup (recommended Phase 1 device: GL.iNet or
# similar travel router, e.g. GL-MT3000/Beryl AX, connected to the Starlink
# Mini's Wi-Fi as a WAN-side client).
#
# Run this ON THE OPENWRT ROUTER (ssh root@<router-ip>), not on the VPS.
# Usage: setup-openwrt.sh <vps-public-ip> <vps-wg-port> <vps-wg-public-key>

set -eu

VPS_IP="${1:?usage: setup-openwrt.sh <vps-public-ip> <vps-wg-port> <vps-wg-public-key>}"
VPS_PORT="${2:?missing vps-wg-port}"
VPS_PUBKEY="${3:?missing vps-wg-public-key}"

WG_IFACE="wgstarlink"
GW_ADDR="10.90.0.2/32"

echo "== Starlink gateway setup (OpenWrt) =="

opkg update
opkg install wireguard-tools kmod-wireguard luci-app-wireguard iptables-mod-nat-extra

umask 077
PRIVATE_KEY="$(wg genkey)"
PUBLIC_KEY="$(echo "$PRIVATE_KEY" | wg pubkey)"

echo
echo "== Gateway public key (paste this into the VPS's wg-starlink0.conf [Peer] block) =="
echo "$PUBLIC_KEY"
echo

uci -q delete network.$WG_IFACE || true
uci set network.$WG_IFACE="interface"
uci set network.$WG_IFACE.proto="wireguard"
uci set network.$WG_IFACE.private_key="$PRIVATE_KEY"
uci add_list network.$WG_IFACE.addresses="$GW_ADDR"

uci -q delete network.${WG_IFACE}_peer || true
uci set network.${WG_IFACE}_peer="wireguard_${WG_IFACE}"
uci set network.${WG_IFACE}_peer.public_key="$VPS_PUBKEY"
uci add_list network.${WG_IFACE}_peer.allowed_ips="10.90.0.1/32"
uci set network.${WG_IFACE}_peer.endpoint_host="$VPS_IP"
uci set network.${WG_IFACE}_peer.endpoint_port="$VPS_PORT"
# Keepalive is the CGNAT-compatibility mechanism: this device always
# initiates, so the VPS never needs to dial in.
uci set network.${WG_IFACE}_peer.persistent_keepalive="25"
uci commit network

echo "-- Enabling IP forwarding + NAT (MASQUERADE) so decapsulated traffic exits via the Starlink WAN --"
uci set network.$WG_IFACE.masq="1" 2>/dev/null || true
# Add wgstarlink to the WAN firewall zone so it gets masqueraded like the
# router's own WAN traffic (adjust zone name if this router's default WAN
# zone isn't literally "wan" — check with: uci show firewall | grep name=).
if ! uci show firewall | grep -q "wgstarlink"; then
  WAN_ZONE_IDX="$(uci show firewall | sed -n "s/firewall\.\(@zone\[[0-9]*\]\)\.name='wan'/\1/p" | head -1)"
  if [ -n "$WAN_ZONE_IDX" ]; then
    uci add_list firewall.$WAN_ZONE_IDX.network="$WG_IFACE"
    uci commit firewall
  else
    echo "   WARNING: could not auto-detect the 'wan' firewall zone — add"
    echo "   $WG_IFACE to it manually in LuCI (Network > Firewall > wan > Covered networks)."
  fi
fi

/etc/init.d/network restart

echo
echo "== Done. Verify with: =="
echo "     wg show"
echo "     ping -c3 10.90.0.1        # should reach the VPS over the tunnel"
echo "== Next: set up the heartbeat script (heartbeat.sh) as a cron job. =="
