# Post-REAL-ID Roadmap — Hakim support, Clan/profile unification, Chapter→Starlink rewards

**Status: documented only, NOT started.** Explicit gate from Khabat
(2026-07-19): wait until build 108 (or whichever build carries the REAL-ID
auto-fallback, `feat/b97-experience@28ba3b5`+) is tested and the no-Telegram
entry flow is confirmed working on a real device, before starting any of
this. "Vi bygger én stabil grunnmur først, så legger vi disse oppå" — one
stable foundation first, then build on top.

## Why this roadmap exists

Khabat's framing (2026-07-19, paraphrased): Hakim can be RealGram's AI
support — first line of response in the RealGram support thread, escalating
to Khabat's inbox only when needed. Clan and profile should be the same
object in Shahnameh and RealGram, not two things kept in sync — a warrior
who learns, plays, answers quizzes, builds their clan, earns, etc. Shahnameh
itself becomes the learning material + play layer: completing chapter X in
the book grants Starlink access, as an alternative reward path alongside
(not instead of) inviting N people or spending self-earned REAL. Game
mechanics, VPN usage, and the user become one blended thing rather than
three separate systems that happen to share a login.

This is a direct, natural continuation of the REAL-ID work
(`B→A(18)`–`B→A(20)`, shahnameh-backend `main@272d17b`): once REAL-ID is the
one identity across every app, "the same clan" and "the same profile" stop
being an integration problem and become the default — there's only one
account to have a clan or a profile on. Chapter→Starlink is the first case
where a *game achievement* becomes a *VPN economy grant*, which is new
territory (existing grants are referral-based or REAL-spend-based, both
already server-verified) and needs its own anti-abuse design before any code.

## Priority order (Khabat, 2026-07-19)

1. **Hakim as RealGram support's first line**
2. **Clan/profile unification** (RealGram identity = Shahnameh identity)
3. **Chapter → Starlink access** as a reward mechanism

## 1. Hakim as RealGram support's first line

**What exists today:**
- Shahnameh backend already has a Hakim AI companion: `routes/api/hakimAI.js`
  (`/ai/*`), admin-configurable via `routes/adminApi/hakimConfig.js`
  (`/admin/hakim/*`, JWT-protected).
- RealGram/SetaLink's support surface today is `admin_messages` (panel
  SQLite) — per `REALGRAM_NATIVE_MESSAGING_DESIGN.md` § 0, this is
  **one-directional system → device only**: no threading, no read state, no
  peer-to-peer, written by `push_device_message()`. That design doc already
  earmarks it as "the seed data for each profile's single Support
  conversation" once real messaging ships (§ 3) — it is NOT yet a real
  two-way thread today.

**What this needs, roughly:**
- A real two-way support thread has to exist first (or this rides in on
  whatever minimal two-way channel ships) — Hakim answering into a
  one-directional system→device log isn't a support conversation.
- A bridge: panel-side support message → Shahnameh's Hakim endpoint (probably
  via the existing `/v1/*` ecosystem contract pattern, Bearer-authed,
  server-to-server) → Hakim's response → posted back into the thread.
- Escalation logic: Hakim needs a way to say "I can't handle this" (low
  confidence, explicit user request for a human, certain topic categories —
  billing/abuse/account-security are obvious candidates) and hand off to
  Khabat's own inbox, not silently fail or loop.
- Decide identity: does Hakim see the user's REAL-ID/profile context (so it
  can answer "what's my clan" style questions), or is it scoped to
  general support only at first? Recommend scoping to general support only
  for v1 — pulling live account state into a support AI's context is a
  bigger trust/scope decision worth its own sign-off, not a default.

**Open questions to resolve before coding:** what counts as "needs a human"
(explicit list vs. AI-judged confidence threshold), what Khabat's inbox
actually is technically (email? a panel admin view? both?), rate/cost
control for AI-answered support at scale.

## 2. Clan/profile unification

**What exists today (Shahnameh side):** `model/clan.js`, `model/clanInvite.js`,
`model/clanApplication.js` — all keyed on `telegram_id` (`leader_id`,
`invitee_id`, `inviter_id`), per the REAL-ID migration plan's own
consequence table (`resilient-prancing-peach.md`). Shahnameh's player
profile (`season2_users`) is likewise telegram_id-keyed today, with the
REAL-ID bridge (real_id ↔ telegram_id) as of tonight making a REAL-ID-only
account playable but not yet the *primary* key everywhere.

**What "same clan, same profile" actually requires:** this is Phase 5 of the
existing REAL-ID migration plan (`resilient-prancing-peach.md`) — the
"gradual internal cleanup" phase, now with clan/profile explicitly named as
the first concrete slice of that cleanup rather than an abstract someday.
Concretely: `Clan`/`ClanInvite`/`ClanApplication` need to resolve
membership/leadership through the same identity-resolution seam
`/user/sync` already uses (real_id ↔ telegram_id bridge), so a clan doesn't
silently fracture into "the Telegram half" and "the RealGram half" of the
same friend group. Profile unification (avatar, handle, persona) has a
head start: `real_profiles` (SQLite, panel side, `re_save_profile`/
`re_get_profile`, landed on `feat/b97-experience` alongside tonight's other
panel work) and `pushEcosystemProfile()` (mobile-app) already push a
RealGram-side profile outward — the missing piece is Shahnameh reading that
same profile back in, instead of maintaining its own separate
avatar/handle fields on `season2_users`.

**Sequencing note:** this is naturally *after* REAL-ID Phase 3 (backfill
existing telegram_id-only players with a real_id) — unifying clan/profile
before every existing player has a real_id would mean some clan members
have one and others don't, splitting the exact thing this is meant to fix.

## 3. Chapter → Starlink access as a reward mechanism

**What exists today:** `model/chapterProgress.js` tracks per-player chapter
completion (telegram_id-keyed, same caveat as above). VPN quota grants today
come from two server-verified paths only: referrals (`qe_milestones()`,
anti-fraud limits already enforced) and REAL-spend (`/v1/spend` →
`re_spend()`, idempotent, ledgered). Both already have real anti-abuse
design behind them.

**Why this is the highest-risk of the three, and needs design before code:**
- Chapter completion is currently a client-reported/server-recorded game
  event with no economic value attached — turning it into "grants VPN
  quota" makes it a new attack surface for the first time (farming chapters
  for free bandwidth, replaying completion, multiple accounts racing through
  the story). The referral and REAL-spend paths both got real anti-fraud
  design (daily caps, idempotency keys, server-side verification) *before*
  they went live — this needs the same treatment, not a shortcut because
  it's "just a game reward."
- Needs a decision on economics: how much quota per chapter, is it
  one-time-per-chapter-per-account or repeatable, does it compete with or
  stack alongside the referral/REAL paths, does it interact with the daily
  redemption cap (`redeem_daily_cap_bytes`) that already governs REAL-based
  redemption.
- Needs a decision on where the check lives: Shahnameh reports "chapter X
  done" to the panel (new contract, server-to-server, same Bearer-auth
  pattern as the existing `/v1/*` contracts) vs. the panel querying
  Shahnameh — recommend Shahnameh-reports-to-panel (push), matching the
  existing pattern where Shahnameh is the source of truth for game state
  and the panel is the source of truth for quota.

**Recommended first step when this is greenlit:** a written contract (same
"contract-first" convention as `DECISIONS.md`'s §1-§7) covering exactly
these anti-abuse questions, reviewed *before* any code — same discipline the
existing reward paths went through.

## Explicit non-goals of this document

This is a roadmap, not a plan for any of the three items — none of them has
gone through the same design-then-approve process the REAL-ID migration did
(`resilient-prancing-peach.md`). Do not start Phase-1-style additive
implementation on any of these without that step happening first, per
Khabat's explicit sequencing above.
