# Starlink node deployment — Phase 1

Scripts here implement the VPS ↔ Starlink-gateway WireGuard tunnel described
in `docs/STARLINK_NODE_ARCHITECTURE.md`. **Nothing here runs automatically —
Khabat runs each script by hand, in order, after reviewing it.**

## Order of operations

1. `vps/setup-starlink-wg.sh` — run on the VPS. Generates the VPS-side
   WireGuard keypair, writes `wg-starlink0.conf` (peer key left as a
   placeholder), adds the dedicated routing table, and **prints** (does not
   apply) the Xray `config.json` snippet to add by hand.
2. `gateway/setup-openwrt.sh <vps-ip> <vps-port> <vps-pubkey>` **or**
   `gateway/setup-raspberrypi.sh <vps-ip> <vps-port> <vps-pubkey> [wan-iface]`
   — run on the Starlink-side device. Generates its own keypair, prints its
   public key.
3. Paste the gateway's public key into the VPS's
   `/etc/wireguard/wg-starlink0.conf` `[Peer]` block, then
   `systemctl enable --now wg-quick@wg-starlink0` on the VPS.
4. Apply the Xray config.json snippet from step 1 (add the `starlink-exit`
   outbound + the per-UUID routing rule), `xray -test -config ...`, then
   `systemctl restart xray`.
5. In the admin panel's Starlink tab, click "Generate heartbeat token" for
   `starlink-no-01`, and "Update config" to set its `vless_uuid` to the same
   UUID used in the Xray routing rule in step 4.
6. Copy the heartbeat token into `/etc/starlink-heartbeat.env` on the gateway
   device (see `gateway/heartbeat.sh` header for the format), install it as a
   cron job running every ~30s.
7. Confirm the node shows `ONLINE` in the admin panel before enabling it or
   allowlisting any test device.

## Rollback

`vps/rollback-starlink-wg.sh` reverses everything on the VPS side. On the
gateway device: `systemctl disable --now wg-quick@wg-starlink0` (Pi) or
remove the `wgstarlink` interface via `uci` / LuCI (OpenWrt).
