# Starlink exit-node — architecture analysis & Phase 1 design

**Date:** 2026-07-14 · **Status:** Analysis complete, Phase 1 implemented, **not deployed, not enabled**.
**Branch:** `feat/starlink-node-phase1` (isolated worktree — production checkout at
`/var/www/setalink` was never touched; see §8).

> Per `docs/CLAUDE_REALINK_RULES.md` Rule 7: this document proposes routing real
> user traffic through a new node type. **No production rollout without
> Khabat's explicit approval.** Everything here ships disabled by default.

---

## 1. What exists today (ground truth, read from the live code)

SetaLink/ReaLink nodes today are **single-hop**: the mobile app dials a VLESS+
Reality (or WS/XHTTP-fronted) inbound directly on a VPS, and that same VPS's
Xray `freedom` outbound is the internet egress (`deploy/helsinki/xray/config.json`
outbounds: `direct` (freedom), `block` — no second hop exists anywhere in the
stack). Two nodes exist: `primary` (Germany, Hetzner) and `fi-hel` (Finland,
Helsinki) — both direct-egress VPS boxes with their own Reality keypairs
(`public/v1.php:100-222`).

Node catalog + credential hand-out is server-controlled: `GET /v1/servers` →
`ServerRecord[]` (no secrets), `GET /v1/servers/{id}/config` → per-node
`ServerCredentials`, gated by a `node_allowlist` SQLite table
(`data/analytics.db`) for any node marked `test: true` (`public/v1.php:504-542`).
Node health is a **pull model**: a cron script on the control box
(`scripts/check-node-health.sh`, every 2 min) TCP/TLS-probes each node's public
endpoint and writes `data/node_health.json`; `v1.php` reads it to auto-hide a
down non-primary node (`v1_node_down()`, `public/v1.php:230-251`).

This pull-probe model **cannot work for Starlink**: Starlink has no stable
public address to probe (CGNAT), and admin must not expose it anyway. Starlink
therefore needs a **push heartbeat** model — the Starlink gateway calls in to
the VPS — which is new (see §5).

Admin panel: PHP dashboard (`admin/index.php`, `admin/api.php`), nginx
`auth_basic` gate + PHP session/CSRF (HMAC over the authenticated username,
`admin/api.php:107-130`). Action dispatch is `?action=` (GET) or
`{action, _csrf}` (POST), one `case` per action inside a big switch, or an
early `if ($action===...)` block for some mutations. Existing "Node Health" /
"Network Intel" panels (`admin/index.php:560-650`) are the pattern to extend.

---

## 2. Architecture options considered

| # | Option | Speed/overhead | CGNAT-safe | Hides Starlink IP | Failover | Multi-node ready | Verdict |
|---|--------|-----------------|------------|--------------------|----------|-------------------|---------|
| 1 | **WireGuard, Starlink-initiated outbound** | Low overhead (UDP, ChaCha20), near line-rate | ✅ yes — client-role peer dials out, server never dials in | ✅ yes — client only ever talks to the VPS | Backend-controlled (see §5) | ✅ — one more peer + one more Xray outbound per node | **Selected** |
| 2 | Cloudflare Tunnel / private networking | Higher overhead — full TLS+HTTP/2 stream per connection, extra hop via Cloudflare edge, historically inconsistent throughput for sustained bulk transfer | ✅ yes | ✅ yes | Cloudflare-side, opaque to us | Possible but adds a third party in the data path for every byte of user traffic | Rejected: adds latency/overhead on top of the already-tunneled Reality traffic, and routes Iran users' VPN payload through Cloudflare's network twice (once for `cf-edge` stealth, again for Starlink egress) for no DPI benefit — Iran never sees this hop either way, so Cloudflare's anti-DPI value (relevant for option 1's WireGuard fingerprint concern) is moot here (see note below) |
| 3 | Direct public IPv6 to Starlink | Zero overhead (no tunnel) | ❌ no — IPv4 is CGNAT'd, and per the brief **we explicitly don't want Iran users hitting the Starlink IP directly** | ❌ fails the core requirement | None — single box, single point of failure | Doesn't scale — every volunteer node becomes a directly-dialable target | Rejected outright — violates the stated requirement, not just suboptimal |
| 4 | Xray reverse/bridge (`reverse` outbound + `portal`/`bridge` inbound tags) | Comparable to WireGuard for the tunnel itself, but adds Xray-in-Xray protocol overhead (VLESS framing twice) vs a flat WG tunnel | ✅ yes — Xray's `bridge` side dials out, matching the CGNAT need | ✅ yes | Backend-controlled, same as option 1 | Works, but doubles the moving parts (2× Xray configs, 2× credential rotation, `reverse` is a less battle-tested corner of Xray) for no benefit over plain WireGuard once you're already off the Iran-facing hop | Rejected: more complexity, no upside, for a link that isn't crossing the Iran filter |
| 5 | **This report's refinement of option 1**: run real WireGuard as the tunnel, but let the *existing* VPS Xray process be the one that uses it — a dedicated `freedom` outbound bound (`sendThrough`) to the WireGuard interface's local address, selected by a per-user routing rule (`user: [<starlink-uuid>]`), instead of a second OS-level VPN client/gateway with policy routing touching the whole box | Same as option 1 (WG does the heavy lifting) | ✅ | ✅ | Backend-controlled | ✅ | **This is what got implemented** — see §4 |

**On "WireGuard is DPI-identifiable" (this codebase's own marketing copy says
so, e.g. `public/iran-vpn/index.php:19-20`, `public/faq.php:92`):** that
concern applies to the **Iran-facing hop** — a client inside Iran dialing a
VPN protocol directly. It does not apply here. In this design, WireGuard only
ever carries traffic on the **VPS ↔ Norway** hop, entirely outside Iran, after
the user's traffic has already survived the Iran-facing hop disguised as
VLESS+Reality/TLS. Iranian DPI never observes a WireGuard handshake in this
design. This is a real distinction, not a rationalization — the two hops have
different threat models (DPI-evasion for hop 1, plain confidentiality +
authenticity for hop 2), and it's worth stating explicitly so nobody
downstream reads the marketing copy and assumes WireGuard was used carelessly.

**Decision: Option 5 (WireGuard tunnel, Xray-native per-user routing).**
It is the initially recommended design, refined at the implementation level
to route through the existing Xray process rather than adding a second,
separately-managed OS-level VPN/NAT/policy-routing stack on the production
VPS. This directly serves the "kill-safe" and "no SPOF" requirements in the
brief: the blast radius of Starlink failing is contained inside one Xray
outbound/routing-rule pair, not the box's kernel routing table.

---

## 3. Critical physical constraint — verified

**The Starlink Mini's bundled Wi-Fi router cannot run WireGuard, cloudflared,
Xray, or any custom software.** This is a verified, well-documented property
of Starlink's consumer hardware (Gen2/Gen3/Mini routers): they run a closed,
non-rootable firmware with no SSH, no OpenWrt/third-party firmware support,
and no way to install or run arbitrary binaries. There is no public report of
anyone running a VPN server or general-purpose Linux workload directly on a
stock Starlink router. **I have not personally tested the specific unit in
Norway** — if Khabat's router has been modified or is a non-stock variant,
that changes this — but absent evidence otherwise, this is the governing
assumption, and Phase 1 is designed around a **separate gateway device**
being required. Do not attempt to configure the Starlink router itself as
the WireGuard peer; it will fail.

**What must physically exist at the Starlink location for Phase 1:**

A small, always-on Linux device connected to the Starlink Mini's Wi-Fi as a
client, capable of running: (a) a WireGuard client interface, (b) NAT
(`iptables MASQUERADE`) so decapsulated tunnel traffic egresses to the real
internet, (c) a small heartbeat script (cron/systemd-timer). Three viable
options, cheapest/most-portable first:

1. **A spare Android device is NOT sufficient on its own.** The Play-Store
   WireGuard app is a *client* implementation with no root-level `iptables`
   NAT/forwarding control exposed to third-party apps; Android does not let
   an unrooted app act as a NAT gateway for other devices' traffic, and
   background-service reliability under Doze/battery-optimization makes it
   unsuitable for an always-on exit node. **Verified conclusion: the current
   ReaLink Android app cannot be repurposed as a gateway without rooting the
   device and running a foreground root daemon — not recommended for a
   production, movable node.** An Android device could theoretically work
   *rooted* with Termux + iptables, but this is fragile and not being
   recommended.
2. **A GL.iNet (or similar) OpenWrt travel router** (e.g. GL-MT3000 "Beryl
   AX", GL-AXT1800) connected to the Starlink Mini's Wi-Fi as a WAN-side
   client. OpenWrt has first-class WireGuard support (`luci-app-wireguard`),
   runs on ~2-5W, is small enough to travel with the Starlink Mini, and this
   is the **recommended Phase 1 device** — cheap (~$60-120), purpose-built,
   low power, portable.
3. **A Raspberry Pi 4/5** with a USB Wi-Fi adapter (or Ethernet if the
   Starlink router is reachable by cable) running standard Debian/Raspberry
   Pi OS + `wireguard-tools`. More flexible (can also run the heartbeat
   script and future health probes natively), slightly less portable than
   #2, but works equally well.

**Recommendation:** GL.iNet OpenWrt travel router for portability (the brief
says the node may move between locations) and lower operational complexity
(a locked-down single-purpose appliance is less to maintain than a general
Raspberry Pi OS install). Phase 1 code below ships setup scripts for **both**
(deploy/starlink/gateway/); Khabat can pick based on hardware on hand.

**This is a hard blocker for live testing** (not for the code in this PR):
without one of these two devices, there is nothing at the Starlink location
capable of terminating the WireGuard tunnel. The code changes here can be
committed and reviewed without the hardware, but §9's manual steps cannot
proceed past "confirm gateway device" until Khabat has one.

---

## 4. Design: how a user's traffic actually reaches Norway

```
Iran user's phone
  │  VLESS+Reality (as today — indistinguishable from TLS 1.3)
  ▼
Existing ReaLink VPS (Germany, unchanged Reality inbound; same address/port
  as always — nothing about the client's connection profile changes)
  │  Xray routing rule: `user == <starlink-test-uuid>` → outboundTag
  │  `starlink-exit` (NEW outbound; every other client is untouched and
  │  keeps using the existing `direct` outbound)
  │
  │  `starlink-exit` = a `freedom` outbound, `sendThrough` bound to the local
  │  WireGuard interface address (10.90.0.1), so the kernel's policy route
  │  (a DEDICATED routing table, only matched by that source IP — see
  │  deploy/starlink/vps/) sends it out the WireGuard tunnel instead of the
  │  box's normal default route. SSH, DB, monitoring, and every other
  │  outbound keep using the main routing table — untouched.
  ▼
WireGuard tunnel (UDP, VPS listens on a fixed port; Starlink gateway dials
  out and keeps the NAT mapping alive with PersistentKeepalive — works
  through CGNAT because the gateway always initiates)
  ▼
Starlink gateway device (Norway) → iptables MASQUERADE → Starlink Mini → public internet
```

Key property: **the VLESS credential the client holds never changes and
never points at Norway.** The mobile app's Xray config still dials the same
Germany VPS address it always would. Only a server-side routing rule (keyed
to a specific allowlisted VLESS UUID, exactly like the existing per-device
`fi-hel` UUID isolation in `public/v1.php:147-151`) decides whether that
UUID's traffic takes the Starlink egress. This is why the brief's requirement
"do not make users connect directly to the Starlink address" and "backend
decides whether the session receives the Starlink exit route" fall out
naturally — the client-visible node catalog entry for `starlink-no-01` reuses
the **existing VPS's own address**, just with a distinct UUID.

**Failover model (Phase 1, deliberately simple):** health is decided
server-side, at credential hand-out time, not via in-tunnel automatic
failover. `GET /v1/servers/starlink-no-01/config` returns `503` unless
`health_state == ONLINE` and the node is `enabled`; the app's existing
failover logic (already present for the `fi-hel`/primary fallback path) then
retries against the primary node. Already-connected sessions riding a
Starlink tunnel that drops mid-flight will see that one TCP stream fail and
reconnect — at which point the health gate hands them back to a healthy
node. This is a reconnect blip, not seamless mid-session failover; that's an
acceptable, honestly-reported limitation for a 3-user/20 Mbps test node, not
a silent gap.

---

## 5. Backend data model (Phase 1)

New table `starlink_nodes` in the existing `data/analytics.db` SQLite file
(same DB every other admin/telemetry table already lives in —
`lib/starlink.php`, loaded from both `public/v1.php` and `admin/api.php`,
matching the existing `lib/node_intel.php` pattern of a shared library file
with a `CREATE TABLE IF NOT EXISTS` initializer, no separate migration
tooling exists in this repo and this doesn't invent one). Columns map
directly to the field list in the task brief (id, display name, country,
node_type, role, enabled, health_state, tunnel_status, last_heartbeat_at,
public_ipv4/6, exit_ip, latency_ms, packet_loss_pct, recent_disconnects,
measured up/down mbps, allocated/used bandwidth, sessions/max_sessions,
uptime_secs, software_version, last_error, maintenance_mode, plus an admin
audit log table `starlink_admin_log`). Device gating reuses the **existing**
`node_allowlist`/`node_usage` tables (`public/v1.php:70-77`) — no need for a
parallel allowlist mechanism, `starlink-no-01` is just another `node_id` in
the same table the Helsinki test rollout used.

Health policy (`st_health_state()` in `lib/starlink.php`), matching the
brief's suggested policy exactly:
- `MAINTENANCE` — `maintenance_mode` flag set, overrides everything else.
- `OFFLINE` — no heartbeat in the last 90s, or `tunnel_status != 'up'`.
- `DEGRADED` — heartbeat is fresh and tunnel is up, but packet loss ≥ 2%,
  latency ≥ 250ms, or ≥ 3 disconnects in the last 15 minutes.
- `ONLINE` — fresh heartbeat, tunnel up, none of the degraded conditions.

New endpoint `public/starlink-heartbeat.php` (standalone file, following the
existing convention of keeping new control-plane surfaces out of the
user-facing `v1.php` and `api.php` — see `docs/MULTINODE_API_v1.md`'s own
rationale for why `v1.php` is standalone). Auth: a **per-node secret token**
(`Authorization: Bearer starlink-node-<id>:<secret>`), unrelated to any user
device bearer token, generated once at node-registration time and stored
**hashed** (`password_hash`) in `starlink_nodes.heartbeat_token_hash` — never
committed to Git, never returned by any read endpoint. This endpoint accepts
POSTs from the Starlink gateway only, over plain HTTPS to the VPS's normal
public address (deliberately **not** routed through the WireGuard tunnel
itself — if the tunnel is the thing that's down, the heartbeat still needs a
path to report that).

---

## 6. Security

- Unique WireGuard keypair generated per node (Phase 1: one, for
  `starlink-no-01`); private keys never leave the box that generated them,
  never committed to Git — `deploy/starlink/vps/wg-starlink0.conf.example`
  and the gateway-side config are templates with placeholders, real keys go
  into `/etc/wireguard/` (VPS) and the gateway's own config directory,
  generated by the setup scripts at deploy time.
- WireGuard `AllowedIPs` on both ends restricted to the single /30 tunnel
  subnet — the Starlink peer cannot present itself as a route to anything
  else, and the VPS cannot send anything but the Starlink-tagged traffic
  down the tunnel.
- The dedicated policy-routing table only matches the one `sendThrough`
  source IP used by the `starlink-exit` Xray outbound. No other process,
  including SSH, DNS, the database, or any other Xray outbound, is affected —
  verified by inspecting the routing rule scope in
  `deploy/starlink/vps/setup-starlink-wg.sh` (adds one `ip rule`/`ip route`
  pair in a private table, doesn't touch `main`).
- Firewall: the VPS opens exactly one UDP port for the WireGuard listener,
  least-privilege (no source-IP allowlist is possible given CGNAT, so
  security here is WireGuard's own asymmetric-key handshake, not IP
  filtering — standard and correct for WireGuard's threat model).
- Admin actions (enable/disable, allowlist, force-fallback) go through the
  existing CSRF-protected `admin/api.php` action dispatch and are logged to
  a new `starlink_admin_log` table (actor, action, target node, timestamp) —
  satisfying "log administrative changes and node activation."
- Revocation: disabling a node (`enabled=0`) immediately removes it from
  `/v1/servers` and makes `/config` return 503; a compromised/misbehaving
  gateway's heartbeat token can be independently rotated
  (`starlink-rotate-heartbeat-token` admin action) without touching WireGuard
  keys, and vice versa — either credential can be revoked without the other.
- The Starlink gateway's `AllowedIPs`-restricted tunnel and MASQUERADE-only
  NAT mean it has no route to the VPS's internal services (database, admin
  panel, other nodes) — it only ever sees the one /30 tunnel subnet plus
  whatever the WireGuard peer explicitly routes to it (nothing, in Phase 1;
  the tunnel exists for egress in one direction only, VPS→internet-via-Norway,
  not for the Starlink box to reach anything on the VPS's LAN).

---

## 7. What's NOT solved yet (explicitly out of scope for Phase 1)

- Automatic in-tunnel failover (mid-session) — see §4, this is
  reconnect-based, not seamless.
- Multi-Starlink-node load balancing / volunteer contributor onboarding —
  the schema (`starlink_nodes` is a table, not a single row) and the
  per-node heartbeat token model are designed to extend to N nodes without a
  schema change, but the admin UI and matching logic in Phase 1 only handle
  one node. Extending to volunteers also needs a legal/ToS/vetting process
  this document doesn't address (who is liable for what egresses through a
  volunteer's IP is a policy question, not a code question).
- Xray `balancers`-based automatic health-aware routing — could replace the
  "hand out 503, let the app retry" model with in-Xray failover later; not
  needed at 3-user scale and adds real complexity now.

---

## 8. What was (and wasn't) touched

**Production checkout `/var/www/setalink` was never modified** — verified
`git diff --stat origin/main HEAD` in that checkout showed `public/v1.php`,
`lib/node_intel.php`, and `admin/api.php` are byte-identical to `origin/main`
before this work started, so this branch (based on `origin/main`) applies
cleanly to what's actually deployed. All Starlink work happened in an
isolated `git worktree` at `/root/work/setalink-starlink`, on branch
`feat/starlink-node-phase1`, exactly the pattern already established for the
RealGram work (`PROJECT_STATUS.md` §4).

Every backend change is **additive**: new table, new standalone endpoint
file, new `case` blocks in `admin/api.php`'s existing switch, new functions
appended to `public/v1.php`'s node registry, new nav item + view in
`admin/index.php`. No existing inbound, outbound, routing rule, or endpoint
behavior for `primary` or `fi-hel` changes.

---

## 9. Manual steps required from Khabat (in order)

1. **Confirm/obtain a gateway device** — GL.iNet OpenWrt travel router
   (recommended) or Raspberry Pi 4/5, per §3. Nothing past this point can be
   tested without it.
2. **Review this branch** (`feat/starlink-node-phase1`, currently only in
   the local worktree — tell me if/when to push it to GitHub) and the diff,
   especially `deploy/starlink/`.
3. **Pick the VPS that will host the WireGuard listener** — this should be
   the same VPS already serving as a ReaLink entry (Germany primary, or a
   dedicated box) since it needs the Xray routing-rule change; confirm which
   one before I generate real keys.
4. **Run `deploy/starlink/vps/setup-starlink-wg.sh`** on that VPS (review it
   first — it adds a WireGuard interface, one routing table, one Xray
   outbound/routing-rule pair; it does not touch any existing config file in
   place, it prints a diff to apply manually to `config.json` so you can
   review the Xray change before restarting Xray).
5. **Run the matching gateway setup script** (`deploy/starlink/gateway/setup-openwrt.sh`
   or `setup-raspberrypi.sh`) on the Starlink-side device, pointed at the
   VPS's public IP and the WireGuard public key generated in step 4.
6. **Register the node in the admin panel** (Starlink tab → "Add node") to
   generate the heartbeat token, then paste it into the gateway's heartbeat
   script config.
7. **Confirm heartbeats arrive** (admin panel should show `ONLINE` within
   ~90s) before allowlisting any test device.
8. **Allowlist your own test device only**, run through the test plan in
   §10 of the task brief, and only then decide on wider testing.

I will not perform steps 3-8 myself without your go-ahead at each step —
they involve real VPS firewall/routing changes and a physical device you
control.
