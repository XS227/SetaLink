# RealGram — Architecture

Companion to `mobile-app/docs/ARCHITECTURE.md` (the existing ReaLink mobile
app's architecture — read that first; this document only covers what's
different or new for RealGram) and `mobile-app/architecture.md` (an earlier,
pre-implementation planning doc — dated 2026-05-15, superseded by
`docs/ARCHITECTURE.md` for anything the two disagree on).

## 1. The existing transport, reused

ReaLink's Android app already runs this stack (`mobile-app/docs/ARCHITECTURE.md`):

```
App traffic → TUN (VpnService) → tun2socks → 127.0.0.1:10808 (Xray SOCKS5 inbound) → Xray-core → VLESS+REALITY → VPN server
```

Key fact: **Xray-core already exposes a local SOCKS5 proxy at
`127.0.0.1:10808`** as an intermediate step in that chain, before tun2socks
and the system TUN interface get involved.

On iOS, the equivalent system-VPN mechanism is a **Network Extension /
Packet Tunnel Provider** — see `mobile-app/ios/PacketTunnelExtension` and
bundle ID `no.setalink.realink.tunnel` (`mobile-app/ios/*/project.pbxproj`).
Apple's Packet Tunnel API is architecturally different from Android's
`VpnService` but serves the same "capture all device traffic" purpose — the
same reasoning in §2 below (avoid it if not needed) applies to both platforms.

## 2. Recommended RealGram transport: skip the VPN layer entirely

**TDLib (Telegram's official client library, the correct foundation for a
Telegram-compatible client) has a native SOCKS5 proxy setting.** Point
RealGram's TDLib instance directly at Xray-core's existing
`127.0.0.1:10808` SOCKS5 listener.

```
RealGram (TDLib) → SOCKS5 (Xray-core, existing, reused) → VLESS+REALITY → VPN server → Telegram network
```

This needs:
- Xray-core running as a background process/service exposing local SOCKS5
  (the binary and its invocation already exist — see
  `mobile-app/docs/APK_COMPATIBILITY_REPORT.md` for the exact binaries in use:
  `libxray.so`, arm64-v8a and armeabi-v7a).
- TDLib configured with that proxy at startup (`setProxy`/`addProxy` in
  TDLib's API — config only, not protocol work).

This does **not** need:
- A second `VpnService` (Android) or Packet Tunnel Provider (iOS).
- A second TUN interface or tun2socks instance.
- A duplicated Xray-core binary bundled into RealGram — if RealGram ships as
  its own app (not a mode inside the existing app, see §3), it still needs
  *a* copy of Xray-core, but only one, and only the SOCKS5 inbound, not the
  full VPN-service wrapper around it.
- Full-device VPN permission from the OS, unless the product later decides
  full-device tunnelling is actually wanted (it currently isn't — see
  `PRODUCT_VISION.md` non-goals).

**This is unverified and is exactly what the technical spike
(`IMPLEMENTATION_PLAN.md` §Spike) exists to confirm** — specifically: does
TDLib's SOCKS5 proxying hold up reliably through Xray's VLESS+REALITY under
real Iranian DPI conditions, the same way the full VPN-service path is
already proven to.

## 3. One app or two? (Unresolved — needs a decision, see `OPEN_QUESTIONS.md`)

Two structurally different options, both compatible with the transport in §2:

**Option 1 — RealGram as a new screen/mode inside the existing ReaLink app.**
Reuses the existing app shell, Xray-core lifecycle management, quota ledger,
and design system (`mobile-app/DESIGN_SYSTEM.md`) directly. Smaller surface,
faster to ship, but couples RealGram's release cadence and app-store risk
profile (see `APP_STORE_COMPLIANCE.md`) to the existing ReaLink app's — a
store enforcement action against "a Telegram-compatible client" could put the
core VPN product at risk too if they ship as one binary.

**Option 2 — RealGram as a separate app/repo, sharing backend and Xray-core
as a library/binary, not sharing the app shell.**
Isolates app-store risk from the core ReaLink product. Larger new surface
(new RN project or new native shell), but cleaner separation of "VPN utility"
and "Telegram-compatible client" as products, which also reads more honestly
in store listings (see `APP_STORE_COMPLIANCE.md` — combining VPN + messaging
+ crypto + game + ads in one first release is explicitly flagged as a risk to
avoid).

**Recommendation: Option 2.** The store-risk isolation argument outweighs the
convenience of Option 1, and it matches the staged release strategy in
`APP_STORE_COMPLIANCE.md`. This is a recommendation, not a decision — record
the actual decision in `DECISIONS.md` once made.

## 4. Data model touchpoints (what RealGram needs from ReaLink's backend)

RealGram does not need its own quota/entitlement ledger. It should call the
same backend surfaces the mobile app already uses:

- Quota / entitlement: same pattern as `public/api.php` `quota-status` (see
  `docs/REWARDED-ADS-RECOVERY.md` §3) — RealGram reads remaining
  data/priority entitlement the same way the existing app does.
- Redemption (REAL → quota): the ledger design in
  `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §A — not yet built, see
  `INTEGRATION_MAP.md`.
- Rewarded connectivity (ads → quota/priority): generalises the existing
  `ad_reward_events` / `recovery_sessions` pattern in
  `docs/REWARDED-ADS-RECOVERY.md` §2–3 — see §5 below.
- Referral: TrustAI pattern already live in this repo (`referral_uses`
  table) — see `INTEGRATION_MAP.md` §TrustAI.

**Do not create parallel tables or a parallel ledger for RealGram.** Extend
the existing quota ledger and existing reward tables. The core invariant
(`quota_bytes_total == SUM(ledger)`, stated in `docs/REWARDED-ADS-RECOVERY.md`
§2) must hold for RealGram-originated grants exactly as it does for the
mobile app's.

## 5. Priority/entitlement tiers — reuse Recovery Mode's pattern, don't build per-user routing

Documented, verified constraint (`docs/REWARDED-ADS-RECOVERY.md` §1): **all
current mobile devices share a single Reality UUID**, and quota is tracked
server-side by ledger, not by per-device routing on the shared inbound. The
server cannot force-disconnect or differentially route one mobile device on
the main inbound.

`Recovery Mode` (`docs/REWARDED-ADS-RECOVERY.md` §5) already solves an
equivalent problem — "grant a temporary, different connectivity tier without
per-user routing" — with a **dedicated inbound**, a **global** (not per-user)
allow-list/throttle, and a session TTL. Notably, its allow-list already
includes Telegram's own domains and DCs.

**Recommendation for "2 hours of Priority Route" (or any RealGram-specific
entitlement tier): generalise this into a small number of named inbounds**
(e.g. `free`, `recovery`, `priority`) rather than attempting true per-user
routing. A user's app requests a short-lived token for the tier it's
currently entitled to (same `recovery-enter`-style flow), connects to that
tier's inbound while the token is valid, and falls back to `free` on expiry.
This is new work, but it's an extension of an existing, working pattern —
not a new architecture.

## 6. Technical spike — see `IMPLEMENTATION_PLAN.md` for the full plan

Do not start full implementation before the spike answers:

1. Can TDLib connect and hold a stable session through Xray's local SOCKS5
   endpoint under real Iranian DPI conditions?
2. What's the actual binary/size cost of adding TDLib to a mobile build
   (see `BUILD_SIZE_BUDGET.md`)?
3. Does Option 1 vs Option 2 (§3) change the answer to either of the above?

## 7. Explicitly out of scope for v1 architecture

- Full-device VPN inside RealGram (unless a future decision reverses
  `PRODUCT_VISION.md`'s non-goals).
- A second, RealGram-specific Xray/REALITY node fleet — RealGram is a client,
  it uses ReaLink's existing/planned node infrastructure
  (`docs/MULTINODE_API_v1.md`).
- Anything that duplicates work already designed in
  `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md`, `docs/PREMIUM-REAL-PAYMENTS.md`,
  or `docs/REWARDED-ADS-RECOVERY.md` — extend those, don't re-design them.
