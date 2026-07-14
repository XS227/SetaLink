#!/usr/bin/env bash
# Starlink exit-node — VPS-side rollback. Safe to run at any time; only
# touches what setup-starlink-wg.sh added. Does not touch Xray's existing
# "direct"/"block" outbounds or any routing rule other than the one this
# feature added (which you must remove from config.json by hand — see below,
# this script does not edit Xray config for you, matching how it was applied).

set -euo pipefail

WG_IFACE="wg-starlink0"
RT_TABLE_ID=90
RT_TABLE_NAME="starlink"

echo "== Starlink VPS-side rollback =="

echo "-- Stopping wg-starlink0 (if running) --"
systemctl disable --now "wg-quick@$WG_IFACE" 2>/dev/null || true

echo "-- Removing policy route / rule (if present) --"
ip rule del from 10.90.0.1 table "$RT_TABLE_NAME" 2>/dev/null || true
ip route del default dev "$WG_IFACE" table "$RT_TABLE_NAME" 2>/dev/null || true

echo "-- Leaving /etc/wireguard/$WG_IFACE.conf and keys in place for inspection --"
echo "   (delete manually with: rm -f /etc/wireguard/$WG_IFACE.*)"

echo
echo "-- Manual step still required: remove the 'starlink-exit' outbound and its"
echo "   matching routing rule from Xray's config.json, then:"
echo "     xray -test -config /usr/local/etc/xray/config.json && systemctl restart xray"
echo
echo "-- Once satisfied, remove the routing table entry from /etc/iproute2/rt_tables:"
echo "     sed -i '/^$RT_TABLE_ID $RT_TABLE_NAME\$/d' /etc/iproute2/rt_tables"
echo
echo "== Rollback complete. The VPS's normal (Finland/Germany) routing was never touched. =="
