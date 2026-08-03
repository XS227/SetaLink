# Higgsfield $100K App Contest — RealGram Repository Audit

**Date:** 2026-08-03
**Scope:** Phase 1 of the "RealGram AI Workspace" contest-prototype brief. Read-only
investigation — nothing in this document changes production behavior.
**Repo:** `/home/ubuntu/SetaLink` (this box is `vps-5348441` / `5.249.252.221` /
`setalink.no`, the production VPS — see `docs/CLAUDE_REALINK_RULES.md` and
`PROJECT_STATUS.md` §4, "do not touch `/var/www/setalink` directly").

---

## 1. Framework & versions

- **Mobile app** (`mobile-app/`, package name `setalink`, version `0.9.135`):
  bare **React Native `0.75.4`** (no Expo — native `android/`/`ios/` projects),
  **React `18.3.1`**, **TypeScript `5.6.3`**.
- **Navigation:** `@react-navigation/native` `^6.1.18` + `native-stack` + `bottom-tabs`.
- **State:** `zustand ^5.0.1` — 17 stores in `mobile-app/src/stores/`
  (`authStore`, `callStore`, `dmStore`, `inboxStore`, …).
- **Design system:** no component library (no NativeBase/Tamagui/Paper) — a
  custom token system at `mobile-app/src/design/tokens.ts` (322 lines) +
  `mobile-app/DESIGN_SYSTEM.md`.
- **Calling stack:** `react-native-webrtc ^124.0.8`, `react-native-video
  6.17.0`, `react-native-incall-manager ^4.2.2`.
- **No web frontend exists anywhere in this repo.** Only two `package.json`
  files outside `node_modules`: `mobile-app/package.json` (RN app) and
  `calling-relay/package.json` (a bare Node `ws` server, no framework). No
  `next.config.*` / `vite.config.*` / `vue.config.*` anywhere. The repo-root
  site (`index.html`, `style.css`, `app.js`) is a hand-written static/PHP
  marketing page — not a JS app, not a scaffold worth extending.

**Contest implication:** the "AI Workspace" must be a **brand-new web app**,
not an addition to an existing one.

## 2. Backend

RealGram's live backend is **PHP + SQLite**, not Node/Express:

- **`public/api.php`** (2525 lines) — the primary surface, `setalink.no/api.php`,
  action-dispatch via `?mobile=1&action=<name>` (~60 actions, listed in §7),
  gated by a static bearer-style app token (`MOBILE_TOKEN`, checked with
  `hash_equals`).
- **`public/v1.php`** (938 lines) — a secondary, path-based REST surface
  (`api.setalink.no/v1/...`), `Authorization: Bearer device-<id>` /
  `Bearer anon-token-<ts>`.
- **Shared PHP libs** in `lib/*.php` — `messaging.php` (667 lines, DMs),
  `globalChat.php` (97 lines), `calling.php` (527 lines, call auth/vouchers),
  plus quota/economy/ads/payments/node-intel modules.
- **DB: SQLite via PDO** (`data/analytics.db`, WAL mode), tables created
  inline per lib file (`call_sessions`, `user_messages`,
  `global_chat_messages`, `devices`, …). Not Mongo/Postgres.
- Message bodies encrypted at rest with libsodium `secretbox`
  (`lib/messaging.php:137-171`) — server-decryptable, **not end-to-end**.
- The **admin panel** (`admin/*.php`) is a separate, VPN/ops-focused PHP
  surface sharing the same SQLite DB — out of scope for this contest work.
- A **third, external** backend exists for the Shahnameh game integration
  (`https://shahnameh.setaei.com/api/season2/*`, Node/MongoDB, lives outside
  this repo — see `docs/realgram/INTEGRATION_MAP.md`). Irrelevant here.

## 3. Authentication

No credential-based login exists for RealGram chat/calling. Concretely:

- `mobile-app/src/services/api/auth.api.ts` defines a REST `AuthAPI`
  (`/auth/login`, `/auth/register`, `/auth/me`, `/auth/logout`) — **these
  routes do not exist in the PHP backend** (grepped `api.php`/`v1.php`, zero
  matches). Dead/unwired scaffolding.
- **Real identity is an unsigned device ID.** `authStore.ts`:
  `loginWithInvite()` mints `token: anon-token-${Date.now()}`;
  `loginWithDevice()` sets `token: device-${device_id}`. `v1.php`'s bearer
  parser (`v1_bearer()`) only pattern-matches those literal string shapes —
  **no cryptographic signature is verified.**
- **RS256 JWT exists, but only for ecosystem SSO into the Shahnameh game
  WebView** (`mobile-app/src/services/ssoService.ts` →
  `public/api.php?action=sso-token` → `re_sso_token()` in
  `lib/real_economy.php`). Not RealGram's session/messaging auth mechanism.
- **Calling auth** is a separate HMAC-SHA256 voucher scheme
  (`lib/calling.php` `call_sign_voucher()`/`call_verify_voucher()`,
  explicitly documented in-code as "not a full JWT library"), authorizing
  WebSocket connections to `calling-relay/`.

**Contest implication:** there is no OAuth/login flow worth reusing. The
contest prototype should use its own simple, self-contained demo-session
concept (see §"Safest implementation plan" below) rather than integrating
with this device-ID scheme.

## 4. Video calling

`calling-relay/` is a **stateless Node.js WebSocket signaling relay**
(plain `http` + `ws`, no Express/Socket.IO, no SFU) — it relays offer/answer/
ICE messages between two `react-native-webrtc` peers; it does not touch
media itself.

- `calling-relay/server.js` (318 lines): public WS on `CALLING_RELAY_PORT`
  (default 8095) + an internal-only `POST /internal/push` (8096) for PHP to
  push `call:incoming` events; 30s heartbeat (added 2026-07-30) for
  zombie-connection detection.
- Deployed via `pm2 calling-relay`, proxied at `wss://vpn.setalink.no/ws/call`.
- **TURN/STUN:** `lib/calling.php` `call_ice_servers()` — Google STUN
  always included; coturn on `fi-hel` (`65.109.183.7`) via REST HMAC-SHA1,
  falling back to STUN-only if unconfigured. Per recent notes (07-30/08-01),
  real-device ICE/TURN media-flow issues were still being actively debugged
  as of that writing.
- **Client:** `mobile-app/src/services/callService.ts` (1099 lines) —
  `RTCPeerConnection`, `mediaDevices.getUserMedia`. Signaling via
  `callSignalingClient.ts` (one persistent WS + REST actions on `api.php`).
  UI: `CallScreen.tsx` (834 lines), `callStore.ts`.
- Feature-flagged on: `featureFlags.ts` → `CALLING_ENABLED = true`.

## 5. Messaging

- **Transport is plain HTTPS request/response (polling), not WebSocket** —
  stated directly in `lib/calling.php`'s own header comment: "This PHP
  backend (api.php) is stateless request/response — it can't hold an open
  connection to push 'you have an incoming call'..." Only *calling*
  signaling gets a real WebSocket; text messaging does not.
- **Schema:** `lib/messaging.php` — `user_messages` (encrypted body, `sent`/
  `read` status, disappearing-message TTL), `user_message_deletes`,
  `user_blocks`, `user_reports`, `message_reactions` (fixed emoji set),
  `user_typing_status` (6s TTL). Rate limits: 10/min, 300/day per device.
- **Global chat** is a separate, simpler, plaintext (non-encrypted) system:
  `lib/globalChat.php`.
- **Client:** `dmStore.ts`, `inboxStore.ts`, `InboxScreen.tsx`.

## 6. Screen sharing

**Already fully implemented in the mobile WebRTC layer — currently
feature-flagged OFF by default.**

- `callService.ts` lines 413-496: `startScreenShare()` calls
  `mediaDevices.getDisplayMedia({})` (RN WebRTC's Android
  `MediaProjection`-backed API), adds the screen track **alongside** the
  camera track (simultaneous camera+screen), renegotiates the peer
  connection with an 8s timeout guard for peers on old app versions.
  `stopScreenShare(reason)` tears it down; `track.onended` auto-stops on
  OS-initiated capture end.
- Signaling: `{kind: 'screen-share-state', active, trackId}`, relayed
  opaquely by `calling-relay/server.js` (no server-side awareness of
  screen-share semantics).
- **Gated off:** `featureFlags.ts` → `isScreenShareEnabled()` reads
  `realtime_screen_sharing_enabled` from remote config, with an explicit
  in-code note citing Khabat's 2026-08-01 spec: "don't publish directly to
  all users; build an internal test version first."
- No screen-share code exists anywhere else (no web surface to have it on).

**Contest implication:** the pattern (separate track, renegotiate, handle
OS-initiated stop) is proven and can be mirrored in the new web app using
the standard browser `navigator.mediaDevices.getDisplayMedia()` API — but
the *mobile* implementation itself is not reachable from a web prototype
and should not be touched.

## 7. API structure

No path-prefix router (`/api/auth`, `/api/chats`, …) — two flat PHP
entrypoints instead:

- **`public/api.php`** — `?mobile=1&action=<name>`. ~60 actions across:
  bootstrap/entitlement, referrals, RealGram identity/handles
  (`handle-lookup`, `handle-reserve`, `realgram-profile-summary`, …),
  SSO/ecosystem, **direct messaging** (`send-message`, `list-messages`,
  `react-message`, `get-typing`/`set-typing`, `block-user`, …), **global
  chat**, **calling** (`call-initiate`, `call-ice-servers`,
  `call-callee-voucher`, `call-accept/decline/end`, `call-history`),
  payments/energy, telemetry.
- **`public/v1.php`** — path-based, bearer-gated: `/servers`,
  `/starlink/unlock-status`, `/payments/*`, `/quota/*`, `/ads/reward/*`,
  `/telemetry/connect`.

**Contest implication:** none of this is worth calling directly from the
prototype — it's device-ID-coupled and production-live. The prototype's own
lightweight demo backend (proposed below) is simpler and safer.

## 8. Existing RealGram branding/assets — and a real conflict to resolve

- `brand/BRAND.md` (B-15, closed, "final for this round") defines RealGram's
  canonical mark as **purple `#C77DFF`** ("chat bubble + spark"), already
  live in `EcosystemFooter.tsx`. Gold `#D4AF37` is explicitly **Shahnameh's**
  brand color in the four-app ecosystem system, not RealGram's.
- **However**, gold is *separately* the established **in-app premium/value
  UI language for RealGram itself** — `mobile-app/src/design/tokens.ts`
  defines a full `Colors.gold` scale and `Gradients.coinGold`/`goldButton`,
  with the in-code rule "GOLD = owned / connected / just tapped / just
  converted." `GoldButton.tsx` is a real, shipped component used in
  `RealWalletCard`, `StarlinkBanner`, `InboxScreen`. This is the shipped
  "gold-theme" chrome (branch `feat/realgram-gold-theme`, merged into the
  current `feat/b97-experience` branch this repo is on).
- **Resolution used for this contest prototype:** treat these as two
  different things, not a contradiction. The RealGram **logo mark stays
  purple**, unmodified, per the brief's own "preserve existing RealGram
  logo" instruction. The **surrounding premium UI chrome** (buttons,
  glass surfaces, AI-panel accents) uses the **already-shipped gold
  language**, which is real, proven, and exactly matches what "black,
  charcoal and premium gold" is asking for — it is not a new color
  invented for the contest. No open question for Khabat here; both source
  docs agree once read together.
- SVG assets available: `brand/realgram.svg`, `brand/wordmark-realgram.svg`,
  `brand/lockup-realgram.svg`, `brand/app-icon-realgram.svg` (+ generated
  PNGs in `brand/generated/`).

## 9. Web app scaffold — none exists

Confirmed by exhaustive search: no Next.js/Vite/React web project anywhere
in this repo. The contest prototype is a **from-scratch web app.**

## 10. `docs/realgram/` — mostly superseded planning docs

24 markdown files. The two most load-bearing are both **stale**:
`AGENT_HANDOFF.md` (2026-07-11) describes a "no RealGram code exists yet"
planning phase, and `ARCHITECTURE.md` proposes a TDLib-based design that
**was not what got built** — actual RealGram is the bespoke PHP+SQLite +
custom RN UI described in §2-7 above. `INTEGRATION_MAP.md` documents the
separate Shahnameh/TrustAI repos, not needed for this contest scope.
Nothing in `docs/realgram/` blocks or informs the contest build further
than what's captured in this audit.

## Repo hygiene note (unrelated to the contest, flagged not fixed)

`git status --short` on `feat/b97-experience` showed: modified
`mobile-app/package-lock.json` (trivial, a dependency bump) and three
modified binary APKs under `public/download/` (uncommitted local build
artifacts) — pre-existing, not touched by this audit. An untracked,
0-byte, `root`-owned file literally named `.schema call_sessions` sits at
repo root — almost certainly a stray artifact from an unquoted
`sqlite3 db ".schema call_sessions"` command run outside a shell context
that could handle the space. Harmless, safe to delete, left alone here
since it's untracked and owned by `root` rather than the repo's normal
`ubuntu` user.

---

## Safest implementation plan

**Isolation strategy:** per the brief's own fallback clause ("if `/ai-workspace`
is unsafe, create `apps/realgram-ai-workspace`") — since **no existing web
app exists to add a route to**, the only viable option is a **new top-level
directory**, not a route inside anything existing:

```
apps/realgram-ai-workspace/
├── src/            # React + TypeScript + Vite SPA
├── server/         # small Node/Express demo backend (own process, own port)
├── .env.example
└── package.json    # own, independent from mobile-app/ and calling-relay/
```

This guarantees:
- **Zero changes to production routes.** Nothing in `public/*.php`,
  `mobile-app/`, `calling-relay/`, or `admin/` is touched.
- **Zero changes to production data.** The prototype does not read/write
  `data/analytics.db` or call `api.php`/`v1.php` at all.
- **Independently deployable/buildable** — its own `package.json`, own dev
  server port, own build output — cannot break the mobile app's build or
  the PHP site's runtime.

**Demo backend, not production integration:** the brief's guided demo
(scenes 1-9, works without two real users) does not need RealGram's real
device-auth/messaging/calling backend at all. `server/` will be a minimal
Node/Express service that: (a) serves the scripted demo transcript/
participant data, (b) proxies Higgsfield MCP generation calls so the
Higgsfield API key/session never reaches the browser, (c) has no
dependency on SQLite, device IDs, or any production table.

**Real screen sharing:** implemented directly in the browser via
`navigator.mediaDevices.getDisplayMedia()` — a standard web API, requires
no RealGram backend involvement at all. Mirrors the proven pattern already
in `callService.ts` (separate track, explicit stop, handle OS-initiated
end) but is a clean, independent browser implementation.

**Branding:** reuse `brand/realgram.svg` (purple mark, unmodified) +
`mobile-app/src/design/tokens.ts`'s gold scale, ported as plain CSS custom
properties/Tailwind tokens (not importing RN code into a web app).

## Open blocker: Higgsfield MCP is not connected

The brief assumes "the Higgsfield MCP server should already be connected."
It is not — no Higgsfield MCP tools are available in this environment as of
2026-08-03. Per the brief's own rule 5 ("if authentication is required,
pause and provide the exact login step"): this needs a one-time OAuth
connect, run by the account owner, not something that can be scripted
around:

```
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
```

This opens a browser OAuth flow against your Higgsfield account (no API key
needed). Once connected, `claude mcp list` (or `/mcp`) should show it, and
the exposed tools are: `generate_image`, `generate_video`, `create_character`,
`get_generation_status`, `list_characters`.

Phase 2 (UI + guided demo) does not depend on this and can proceed now with
a clearly-labeled fallback/mock generation path; Phase 3 (real Higgsfield
generation) is blocked until the MCP connection exists.
