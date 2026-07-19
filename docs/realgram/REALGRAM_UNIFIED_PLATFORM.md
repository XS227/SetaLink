# RealGram as the platform, Shahnameh as the engine — architecture + task split

**Status: approved by Khabat, 2026-07-19. Building has started (§B below).**
Supersedes the tentative framing in `POST_REALID_ROADMAP.md` with concrete
contracts — that document's deep-dive research still stands, this is the
build-ready version of it, expanded with Khabat's own 6-point direction.

**The one-sentence version:** RealGram is the platform; Shahnameh is the
game/learning/reward engine running inside it. Everything — identity,
profile, clan, wallet — is the same REAL-ID object, not parallel systems
kept in sync. Priority order, explicit: **A** (entry stability) → **B**
(server-synced tap & earn) → **C** (unified profile/clan) → **D** (Hakim
support) → **E** (skills → Starlink reward). Do not skip ahead — each
later item assumes the earlier ones are real.

**Hard constraint across all five: never break the existing invite flow,
REAL flow, or VPN flow.** Every change below is additive — a new field, a
new endpoint, a new optional path — never a rewrite of something already
live. Where a change *replaces* client behavior (§B's local ZAR counter),
the server-authoritative path must work standalone before the local-only
path is removed, not swapped in one commit.

---

## A. Entry stability (status pointer only — no new contract here)

Tracked in `B→A(23)` / `A→B(24)`: root cause found (Zustand `persist`
rehydration race), fixed (`9b990e6`, build 109/0.9.69, `[REALDBG]`
instrumented). **Blocked on Khabat installing build 109 on a real device**
— nothing else in this document should be treated as "done" until that
confirms `checkAndCacheRealId` actually fires and REAL-ID entry works
end to end. B below can be *built* in parallel (it's server-side +
independent client code), but should not be considered *validated* until
A closes.

---

## B. Server-synced Tap & Earn — contract §8

**Problem:** `zarStore.ts` (mobile-app) is a fully local, Zustand-persisted
counter. It never calls Shahnameh. Two devices, or RealGram vs. the
Shahnameh Mini App itself, can show different ZAR for the same person.

**Principle:** the server is the only source of truth for a ZAR balance.
The client may still increment optimistically for tap-feel (no visible
lag), but every flush reconciles local state to whatever the server
returns — server value always wins, never the other way round.

### Contract §8 — `POST /v1/tap-sync` (shahnameh-backend, `routes/api/ecosystem.js`)

Bearer-authed with `REAL_ECOSYSTEM_API_KEY`, same posture as every other
`/v1/*` contract — the app never calls this directly, the panel proxies it
(same reason as `/v1/sso-token`: the app must never hold `real_api_key`).

```
POST /v1/tap-sync
Authorization: Bearer <REAL_ECOSYSTEM_API_KEY>
{ "account": "<telegram_id or real_id — same field ecosystem.js already
              uses everywhere, resolves via the real_id<->telegram_id
              bridge from REAL-ID Phase 2, zero new identity logic>",
  "taps": 12   // delta since last sync, NOT a cumulative total — batched
               // client-side (same shape as the app's existing
               // track-taps-batch analytics, reused pattern not reinvented)
}

200 { "zar": 1284, "capped": false, "zar_earned": 60 }
```

Server logic (new case in `ecosystem.js`, reusing existing pieces —
nothing here is a new primitive):
1. Clamp `taps` server-side (e.g. max 100 per call — matches the existing
   `track-taps-batch` abuse clamp of 200 items, tap-sync is stricter since
   it's economically meaningful, analytics isn't).
2. `zar_earned = taps * tap_base_zar` — `tap_base_zar` is **already** a
   live `SystemConfig` key (`/user/sync`'s response already exposes it as
   `economy.tap_base_zar`) — no new rate constant, reuse the existing one.
3. **Reuse `/user/sync-balance`'s exact daily-cap anti-abuse pattern**
   (`DAILY_ZAR_CAP`, delta-tracked via `daily_zar_date`/`daily_zar_earned`)
   — same fields, same guard, so a player can't out-earn the cap by mixing
   RealGram taps and in-Mini-App taps; they share one daily ledger.
4. `$inc` on `zar` (delta-based, not `$set` — no prior-read race window).
5. Return the new authoritative `zar` total so the client can reconcile
   immediately, in the same response (no extra round trip).

### Panel proxy — `action=tap-sync` (`public/api.php`)

Same shape as the existing `sso-token` proxy: device_id in, resolves the
device's `account` (linked_real_account, including the REAL-ID
auto-fallback from Phase 2 — a device with no Telegram link still has a
`device:<id>` real_id and can still earn ZAR), forwards to Shahnameh with
Bearer `real_api_key`, returns the result. Fails soft to "queued, will
retry" on the client rather than losing taps — this is a UX nicety, not a
security requirement (worst case a client retries taps AS the same
already-counted event; the server's `taps` param being a client-reported
delta means a naive retry *could* double-count — client MUST NOT resend a
batch it already got a 200 for; standard idempotency-by-not-retrying-
successful-sends, no dedup key needed given the daily cap already bounds
the blast radius of even a duplicated batch).

### Mobile app — `zarStore.ts` rewrite

- Keep instant local `tap()` for feel (no perceptible lag on tap).
- Buffer taps; flush on an interval (e.g. every 10-15s while the screen is
  open, or on N taps, whichever first — mirrors `track-taps-batch`'s
  buffer-and-flush shape) via the panel's `action=tap-sync`.
- On a successful flush response, **overwrite** local `balance` with the
  server's returned `zar` (not add to it) — this is the actual fix for
  "different ZAR on different devices": the next flush from ANY device
  converges to the same number, because the server is authoritative and
  every device eventually asks it.
- Keep the local persisted value as a between-flush cache only (so the UI
  isn't blank on cold start before the first flush completes), not as the
  system of record.

### Anonymous connection-quality signal (Khabat's point 2, second half)

Deliberately **not** a new pipe. `track-taps-batch` (public/api.php,
already live) already receives `device_id` + timestamps for every UI tap,
completely separate from the ZAR-earning flow above (this is
existing generic UX analytics, screen/element, not economically
meaningful). Extend it additively with two optional fields —
`protocol`/`node` — sent alongside a tap batch when the device is
currently VPN-connected (client already knows this from `vpnStore`,
zero new client-side lookup). Nothing needs to change about ZAR-earning
for this: analysts get "tap density and responsiveness correlated with
which node/protocol was active," a real stability signal, entirely
reusing the existing anonymous `tap_events` table plus a join against
`vpn_sessions` — no new identity exposure, no new table.

---

## C. Unified profile & clan — REAL-ID Phase 5, first concrete slice

**Not started tonight** — this is real REAL-ID Phase 5 work
(`resilient-prancing-peach.md`) and per that plan's own sequencing should
follow REAL-ID Phase 3 (backfilling existing telegram_id-only players with
a real_id) so a clan doesn't fracture into "the Telegram half" and "the
RealGram half" of the same friend group mid-migration. Documenting the
shape now so Phase 3→5 has a concrete target, not starting the migration
itself.

**Target shape:**
- `season2_users` stays the profile record (level, role/persona, avatar,
  skills/progression, zar/real/gems) — it does NOT get replaced by a
  RealGram-side profile table. RealGram reads it, doesn't fork it.
  Avatar/handle specifically: `real_profiles` (SQLite, panel,
  `re_save_profile`/`re_get_profile`, already landed) plus
  `pushEcosystemProfile()` (mobile-app, already landed) already push a
  RealGram-side profile outward — the missing piece is Shahnameh reading
  that back in on `/user/sync` instead of maintaining separate
  avatar/handle fields, not the other direction.
- `Clan`/`ClanInvite`/`ClanApplication` (shahnameh-backend) resolve
  membership/leadership through the same seam `/user/sync` already uses
  (real_id ↔ telegram_id bridge) — no schema change needed on the clan
  models themselves if the resolution happens at the identity layer, which
  is exactly what makes this "Phase 5, not a rewrite."
- **Telegram stays fully optional**, per Khabat's point 1: no separate
  Telegram identity requirement anywhere in this — linking Telegram only
  ever *attaches* history to an existing REAL-ID (the account-merge
  question from the original REAL-ID plan: reject if the Telegram account
  already has its own separate progress, don't guess a merge).

**Depends on:** REAL-ID Phase 3 (backfill) shipping first. Not scheduled
yet — this section exists so whoever picks up Phase 3 knows what Phase 5
needs from it.

---

## D. Hakim as RealGram support's first line

**Not started tonight** — needs a real two-way support thread to exist
first (today's `admin_messages` is one-directional system→device only,
per `REALGRAM_NATIVE_MESSAGING_DESIGN.md` §0 — not a conversation).
Documenting the contract shape so building the thread and building Hakim's
hook into it can happen in parallel once someone starts the thread work.

**What Hakim is allowed to know** (Khabat: "REAL-ID-status, quota, node,
spillprogresjon og vanlige feil, uten å eksponere hemmelige data"):
- REAL-ID link status (linked / auto-provisioned / unlinked) — yes.
- Quota remaining, current node/protocol, connection state — yes, this is
  already non-secret operational data the app itself shows the user.
- Game progression summary (level, chapters cleared, clan) — yes.
- Common-error classification (e.g. "no-fill on banner," "CP1 tunnel
  failure," "insufficient balance on redeem") — yes, this is diagnostic,
  not secret.
- **Never**: `real_api_key`/`REAL_ECOSYSTEM_API_KEY`, any HMAC secrets
  (link proofs, SSO signing key), raw device tokens, other users' data.
  Concretely: Hakim's context should be built from a **read-only summary
  endpoint** (new, Bearer real_api_key, server-to-server — same posture as
  every other `/v1/*` contract), never given the secrets themselves or
  direct DB access.

**Escalation:** Hakim marks a support thread `needs_human` (explicit
category list recommended over an AI-judged confidence score — billing,
account security, abuse reports are obvious always-escalate categories);
escalated threads surface in Khabat's existing inbox mechanism (needs the
two-way thread work above to define what "inbox" even is technically).

**Owner split when this starts:** Shahnameh side = the read-only summary
endpoint (Agent B). Panel side = the two-way thread + Hakim's hook into it
+ escalation UI (Agent A / panel session, since `admin_messages` and the
support UI both live there).

---

## E. Skills → Starlink access — contract §9, extends the existing milestone ladder

**Not started tonight** — anti-abuse design needs review before any code,
same discipline `qe_milestones()`'s referral ladder already went through.
Documenting the concrete shape (narrower than the original
`POST_REALID_ROADMAP.md` write-up, per the deep-dive finding that
`stealth_unlocked` already IS "better connection access").

**Principle (Khabat, point 4): additive, not a replacement.** Three
parallel unlock paths for the same reward class, not one path replacing
another:
  a) invite N people (existing, `qe_milestones()`, unchanged)
  b) spend REAL (existing, `/v1/spend` contract 4, unchanged)
  c) **new**: complete specific chapters/quiz tiers/skill thresholds

**Contract §9 — `POST /v1/skill-unlock-check`** (shahnameh-backend →
panel, push direction, matching the plan's own recommendation: Shahnameh
is the source of truth for game state, so Shahnameh reports "this account
cleared requirement X" rather than the panel polling for it):

```
POST /v1/skill-unlock-check   (panel-side, Bearer real_api_key FROM Shahnameh)
{ "account": "<telegram_id or real_id>",
  "unlock_key": "chapter_3_cleared",   // enum, server-defined on BOTH
                                         // sides — never a free string the
                                         // panel has to trust blindly
  "verified_at": "<ISO ts>" }
```

Shahnameh calls this the instant its own server-side verification
confirms the condition (e.g. right after `isChapterQuizCleared` passes in
the existing quiz-answer flow) — the panel never re-derives game state
itself, it just records "Shahnameh vouched for this" the same way
`/v1/spend`'s caller (the panel) already trusts Shahnameh's `/v1/balance`
without re-deriving the ledger.

**Anti-abuse requirements, all must hold before this ships (Khabat's own
words: "anti-misbruk, cooldown og serververifisering"):**
- Every `unlock_key` maps to a genuinely server-verified condition — reuse
  `isChapterQuizCleared`-style checks (already exist, already tamper-
  resistant), never a client-reported `chapters[slug].done` flag.
- Idempotent: replaying the same `unlock_key` for an already-unlocked
  account is a no-op, not a repeated grant (mirrors `/v1/grant`'s
  idempotency-key pattern, though here the natural idempotency key is
  simply `(account, unlock_key)` — a condition is either met or not, no
  need for a caller-supplied nonce).
- Cooldown: even though "clearing chapter 3" isn't repeatable, the reward
  it grants (quota bytes, or a `stealth_unlocked`-style flag) should share
  the SAME daily/velocity caps `qe_milestones()` already enforces for
  referral rewards — one account shouldn't be able to stack skill-based
  grants faster than the existing reward economy already assumes is safe.
- `stealth_unlocked` (or whatever flag this ultimately sets) becomes
  `stealth_unlocked = referral_path OR real_spend_path OR skill_path` —
  genuinely additive, existing paths completely unchanged.

**Open item carried over from the original write-up, still unresolved:**
what `stealth_unlocked` concretely changes in routing/exit-node selection
wasn't traced — confirm this before finalizing the reward design, since
"better connection options" needs to mean something specific technically.

---

## Task split

| Item | Owner | Depends on |
|---|---|---|
| A (entry stability) | Khabat (device test) + Agent A (already fixed, `9b990e6`) | — |
| B (tap-sync contract §8, Shahnameh side) | Agent B (this session) | REAL-ID Phase 2 (done) |
| B (panel proxy + zarStore rewrite) | Agent B (this session, SetaLink repo) | Contract §8 above |
| B (connection-quality fields on track-taps-batch) | Agent B (this session, SetaLink repo) | — |
| C (profile read-back into `/user/sync`) | Agent B, after Phase 3 backfill | REAL-ID Phase 3 |
| C (clan identity resolution) | Agent B, after Phase 3 backfill | REAL-ID Phase 3 |
| D (two-way support thread) | Agent A / panel session | — |
| D (Hakim read-only summary endpoint) | Agent B | D's thread work |
| E (skill-unlock-check contract §9, Shahnameh side) | Agent B | anti-abuse review |
| E (stealth_unlocked wiring, panel side) | Agent A / panel session | Contract §9, anti-abuse review |

Building B now (Shahnameh contract §8 + panel proxy + mobile zarStore) per
Khabat's go-ahead. C/D/E stay documented-only until their stated
dependencies clear.
