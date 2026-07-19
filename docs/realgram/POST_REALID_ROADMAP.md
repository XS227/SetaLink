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

---

## Deep-dive: what "migrate Shahnameh into RealGram" actually touches

**Added 2026-07-19, study only, nothing implemented.** Khabat asked to
study further: rewards, functionality, skills, more access, better
connection options, the tap & earn button, and REAL's role across the
ecosystem. Read through `season2.js` (shahnameh-backend, ~2400 lines, 40+
endpoints) and SetaLink's `lib/quota_economy.php`/`lib/real_economy.php`
end to end to ground this in what actually exists today, not assumptions.

### What Shahnameh already has (all telegram_id-keyed today, REAL-ID bridge
makes it playable but not yet primary — Phase 5 territory per the REAL-ID
plan)

- **Heroes** (`UserHero`, `HERO_CATALOG`): owned per-account, leveled up
  with REAL, each level scales `zar_per_hour` (passive income). Buying and
  leveling are both server-price-checked (client-supplied cost is never
  trusted — fixed 2026-06-23 after exactly that hole existed).
- **Chapters + quizzes** (`ChapterProgress`, `QUIZ_CATALOG`, three tiers
  easy/medium/hard, ≥60% correct to pass): this IS the "skills" system —
  mastery-gated, server-verified (`isChapterQuizCleared`), can't be spoofed
  by a client claiming `chapters[slug].done`. `grant-hero` already gates
  certain heroes on a chapter's quiz being cleared — chapter completion
  already unlocks *something* today, just not VPN access yet.
  `reconcile-chapter-rewards` exists as a one-time-catch-up pattern —
  directly reusable shape for a future chapter→Starlink reward.
- **Daily loop**: check-in streaks (`/earn/checkin`, escalating REAL +
  gem-every-7th-day), one-time social/partner tasks (`/earn/complete-task`,
  `EARN_TASKS` — note `partner_tonkeeper` already exists as a task, i.e.
  Shahnameh already rewards a RealGram-ecosystem action today), AdsGram
  rewarded ads (bronze/silver/gold/watch tiers).
- **Clan**: full clan system (create/browse/apply/invite/accept/contribute/
  members), `telegram_id`-keyed exactly like the rest — this is what
  `POST_REALID_ROADMAP.md`'s item 2 (clan/profile unification) is about.
- **Currencies**: `zar` (in-game, earned by tap/heroes), `real_balance`
  (the ecosystem currency, spendable ecosystem-wide via contracts §1-§7),
  `gems` (cosmetic/premium currency), `farr` (a third, less-used currency —
  origin/purpose not traced here, flagging as an open question rather than
  guessing). `zar`→`real` conversion is a real, live, rate-configurable
  endpoint (`/user/zar-swap`, rate from `SystemConfig economy.zar_to_real_rate`).

### What RealGram/SetaLink already has (parallel, not yet joined)

- **Referral milestone ladder** (`qe_milestones()`, Fibonacci: 3/5/8/13/21/
  34/55 referrals): each tier grants quota bytes, a cosmetic badge
  (scout→connector→builder→influencer→champion→legend→icon), AND
  `stealth_unlocked` — a **better-connection unlock**, gated purely on
  referral count today. This is the exact mechanism `POST_REALID_ROADMAP.md`
  item 3 (chapter→Starlink) would extend, not invent from scratch — the
  reward *type* (unlock better connectivity) already exists, just needs a
  second unlock path.
  - **What "stealth" concretely unlocks** wasn't traced in this pass — the
    quota_economy.php code sets the flag but the actual routing/protocol
    consequence lives elsewhere (likely the exit-node selection logic).
    Worth confirming before designing a chapter-gated version of it.
- **REAL spend/redemption**: `/v1/spend` (contract 4) already lets a linked
  REAL account convert REAL → VPN quota, idempotent, ledgered
  (`real_redemptions`). This is the CONSUMPTION side of REAL in the
  ecosystem — already fully built and live.
- **Quota transfer** (device-to-device gifting, anti-fraud capped) — social
  layer that has no Shahnameh equivalent today (Shahnameh has no "gift your
  hero-income to a clanmate" concept).
- **Tap & earn button** (`zarStore.ts`, mobile-app): **this is the one
  concrete gap worth fixing first, independent of the 3-item roadmap.** It
  is a **fully local, on-device counter** — its own code comment says so
  explicitly ("balance lives on-device... pre-backend balances honest
  enough to migrate [later]"). It does NOT call Shahnameh's real
  `season2_users.zar` field, `/user/zar-swap`, or
  `SystemConfig economy.tap_base_zar` at all. Two consequences:
  1. A RealGram user's ZAR from tapping and a Shahnameh player's ZAR from
     playing are **two disconnected numbers today**, even for the same
     REAL-ID once REAL-ID Phase 2 ships — tapping in RealGram earns nothing
     that Shahnameh, heroes, or the zar→real swap ever sees.
  2. This was already flagged once (Live panel session, B-23 wallet work,
     2026-07-19) as an open reconciliation question nobody has decided yet:
     which number wins, is there a migration, does the local counter retire.

### Where this points, without picking anything yet

The pattern across all three roadmap items PLUS this new finding is the
same: **RealGram already has the reward/unlock *shapes* (badges, stealth
unlocks, a tap button, a wallet card) — Shahnameh has the real, server-
verified *substance* behind similar shapes (heroes, chapters, quiz mastery,
zar/real economy) that isn't wired to them yet.** REAL-ID (already shipped)
is what makes "wired to them" even possible — before REAL-ID Phase 2 there
was no single identity to hang a unified reward ledger off of.

**Suggested additions to the existing priority list (not reordering
Khabat's 1-2-3, just flagging what's now visible):**

- **Tap & earn ↔ Shahnameh zar bridge** looks like the smallest, most
  self-contained piece of all of this — one endpoint (`/user/zar-swap`
  already exists), one client-side change (call it instead of only
  incrementing local state), no new anti-abuse surface (the swap endpoint
  is already rate-safe via `SystemConfig`-driven rate + atomic `$gte`
  guard). Worth considering alongside or even before item 1 (Hakim
  support), purely on effort-vs-value grounds — not overriding Khabat's
  stated order, just naming it since it wasn't visible before this dive.
- **Chapter→Starlink (item 3)** has a closer analogue than initially
  written up: `stealth_unlocked` already IS "better connection options,"
  already reward-gated, already has a badge ladder UI. The design work
  narrows from "invent a new reward type" to "give `stealth_unlocked` (and
  maybe the badge ladder itself) a second unlock path keyed on chapter/quiz
  mastery instead of only referral count" — same anti-abuse questions
  from the original write-up still apply (this doesn't reduce that need).
- **Clan/profile (item 2)** is unchanged by this dive — still Phase 5
  territory, still waiting on REAL-ID backfill first.

Still nothing to build here — same gate as the rest of this document.
