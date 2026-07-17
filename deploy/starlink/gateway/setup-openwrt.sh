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
echo "-- Installing heartbeat.sh + watchdog.sh via cron (no systemd on OpenWrt) --"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATEWAY_DIR="/opt/starlink-gateway"
mkdir -p "$GATEWAY_DIR"
cp "$SCRIPT_DIR/../heartbeat.sh" "$GATEWAY_DIR/heartbeat.sh"
cp "$SCRIPT_DIR/../watchdog.sh" "$GATEWAY_DIR/watchdog.sh"
chmod 755 "$GATEWAY_DIR/heartbeat.sh" "$GATEWAY_DIR/watchdog.sh"

HB_ENV_FILE="/etc/starlink-heartbeat.env"
if [ ! -f "$HB_ENV_FILE" ]; then
  cp "$SCRIPT_DIR/../config.template.env" "$HB_ENV_FILE"
  sed -i "s/^WG_IFACE=.*/WG_IFACE=$WG_IFACE/" "$HB_ENV_FILE"
  chmod 600 "$HB_ENV_FILE"
  echo "Wrote $HB_ENV_FILE -- fill in VPS_API_URL and HEARTBEAT_TOKEN (admin panel's 'Generate"
  echo "heartbeat token'), and set WAN_IFACE if this router's WAN-side interface isn't the"
  echo "default (check with: uci show network | grep wan)."
fi

# No systemd on OpenWrt -- cron is the standard mechanism. Runs even if the
# router reboots, since /etc/crontabs is persisted config, not overlay-tmp.
( crontab -l 2>/dev/null | grep -v 'starlink-gateway/heartbeat.sh' | grep -v 'starlink-gateway/watchdog.sh'
  echo "* * * * * $GATEWAY_DIR/heartbeat.sh >/dev/null 2>&1"
  echo "* * * * * sleep 30; $GATEWAY_DIR/watchdog.sh >/dev/null 2>&1"
) | crontab -
/etc/init.d/cron restart

echo
echo "== Done. Verify with: =="
echo "     wg show"
echo "     ping -c3 10.90.0.1        # should reach the VPS over the tunnel"
echo "== Note: OpenWrt typically has no python3, so heartbeat.sh's Node Console command"
echo "   dispatch (remote wg_status/restart_wireguard/etc.) will no-op here -- telemetry"
echo "   and watchdog self-healing still work fully. opkg install python3-light to enable it."
