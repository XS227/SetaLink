# RealGram / REAL economy — balance model (2026-07-30 pass)

> Started per Khabat's direct ask: review the economy "basert på Dr. Nasrin
> Dadashi's vurdering" (her assessment of the Shahnameh economy strategy).
> **2026-07-30, later same day — dropped as a dependency on her direct
> instruction** ("glem dadashi bregning"): nothing by that name ever
> surfaced anywhere in this repo, and she'd rather move forward with what's
> here than keep waiting on content neither of us has. Kept the earlier
> §6 note for the record, no longer blocking anything below.

## North star, stated directly by Khabat: liquidity first, then free internet for everyone

Two decisions from the same message, in order, and they connect directly:
**§4's revenue split is decided — liquidity first** (not "lean toward,"
decided), and the reason that matters beyond just "REAL gets a price
faster" is the actual end goal she named: **eventually, VPN access itself
should be free for everyone**, funded by the REAL economy rather than
gated by GB quotas. That only works if REAL is worth something real first
— a token with no liquidity can't subsidize anything, it's just a number.
Liquidity-first isn't only the safer bootstrap choice from §4's original
crash-risk analysis, it's the actual precondition for the bigger goal.

**Not pretending the full mechanism is designed** — "free internet for
everyone" is the stated destination, not a spec. Genuine open questions
for later, not this pass: does "free" mean the quota system goes away
entirely once REAL/liquidity/node-operator revenue covers egress costs
outright, or does it mean the *effort-based* paths (ads, referrals,
`§7`'s future node-operator network) become generous enough that hitting
a real ceiling stops mattering in practice even though the mechanism
stays? Both get to the same place for a user; they're different builds.
Flagging so whoever designs that phase doesn't have to guess what "free
for everyone" was supposed to mean — ask her which shape before building
either.

## 0. REAL token — no live market price exists yet

Checked `ston.fi`'s asset API directly against the real contract
(`EQDhq_DjQUMJqfXLP8K8J6SlOvon08XQQK0T49xon2e0xU8p`, from
`settings.real_token_address`): tagged **`no_liquidity`** — no trading pool,
no USD/TON price to check. Every "REAL" token that shows up on
CoinMarketCap/Coinbase/Crypto.com is a different, unrelated project with the
same ticker — not this one. **There is nothing to "check today's value" of
yet.** The only real exchange rate that exists anywhere in this system today
is the *internal, admin-set* one: `real_per_gb = 100` (100 REAL buys 1GB of
VPN quota via `re_redeem()` in `lib/real_economy.php`). Every calculation
below uses that as the only grounded reference point for what a REAL is
"worth" inside the app, since there's no external market to anchor to. Once
liquidity exists (post-airdrop, presumably), this section needs revisiting —
until then, treat REAL amounts below as internal accounting units, not cash.

## 1. What's actually configured today (verified against live `settings`)

| Mechanism | Value | Source |
|---|---|---|
| Starter grant | 5 GiB (one-time, free) | `QE_STARTER_BYTES`, `quota_economy.php` |
| Referral quota | 5 GiB **per referral, both sides** | `QE_REFERRAL_BYTES` |
| Referral REAL | 500 REAL per referral (mode=`both`, additive to the quota above) | `referral_real_reward` setting |
| Referral milestones | Fibonacci-shaped bonus at 3/5/8/13/21/34/55 invites → 1/2/3/5/8/13/21 GB + a badge | `QE_CREDIT_TYPES`, `quota_economy.php` |
| Ad-rewarded quota | 250 MB/ad, max 4 ads/day, capped 1 GB/day total | `ad_reward_bytes`/`ad_daily_cap`/`ad_daily_reward_cap_bytes` |
| REAL → quota redemption | 100 REAL = 1 GB, min 50 REAL/redemption, max 10 GB/day | `real_per_gb`/`redeem_min_real`/`redeem_daily_cap_bytes` |
| Ad revenue (eCPM) | $3.00 / 1000 rewarded views → **$0.003/view** | `ecpm_usd` setting |
| Egress cost | **$0.02/GB** | `egress_cost_per_gb_usd` setting |
| Referral fraud gate | `trustai_score_referral()` risk-scores every referral before it pays out | `lib/trustai.php` |
| Daily Luck Wheel | 5 equal-weight prize types (GB/Zar/Gem/Farr/REAL), **UI-only preview, no amounts, no server grant yet** | `DailyLuckWheel.tsx`, `TASK_SPLIT.md` B→A(~242) |

**A real finding worth flagging on its own**: at today's configured rates, one
ad-rewarded action is already running at a *loss* on raw unit economics,
before any liquidity/airdrop/server-cost split is even carved out — 250MB of
ad-earned quota costs 0.25 × $0.02 = **$0.005** in egress, against **$0.003**
in ad revenue from the view that earned it. That's not a "players are
overearning" situation on the VPN-quota side; if anything the opposite —
worth knowing before assuming the fix here is "reduce payouts." The actual
lever that needs adjusting first is more likely the ad video's fill/eCPM
(still recovering per `[[realgram-admob-monetization-status]]`) than the
reward size.

## 2. Player journey — quota side (fully modelable, no unknowns)

A player who never watches an ad, never refers anyone, never redeems REAL:
**5 GiB, once.** That's the actual floor — not "stuck" in the sense of a
dead end (the app is still fully usable, just rate-limited by whatever the
5GB affords), but it is the bottom of the curve by design.

A player who watches ads every day: **+1 GB/day**, uncapped duration — this
alone means nobody is ever truly "stuck" for more than a day at a time
regardless of referrals, as long as ads are available to watch. This is the
actual anti-softlock mechanism already in place — worth confirming Khabat's
"ikke sitte fast" concern is about something *beyond* this (e.g., ad fill
being unreliable right now, a real, separate, already-tracked bug — see
`[[realgram-admob-monetization-status]]` — rather than the reward math
itself).

A player who refers others: 5GB + 500 REAL per referral, **linear**, no cap
found on total referral count or total referral REAL — this is the one path
with no ceiling. 10 referrals = 50GB quota + 5,000 REAL (=50GB worth via the
redemption rate, so 100GB-equivalent total from 10 referrals) + whatever
Fibonacci milestone bonuses land along the way (34 or 55 referrals territory
for the biggest single-milestone bonus, 13-21GB in one shot). This is
*intentionally* the highest-leverage path — matches Khabat's exact ask
("spes tilfelle om de inviterer mange så kan de få en del mer REAL") — the
mechanism for it already exists, just uncapped. Whether "uncapped" is a
problem depends entirely on how big the eventual airdrop pool is meant to
be — flagged in §4, not decided here.

## 3. Daily Luck Wheel — first concrete numbers (currently undefined)

The wheel exists as UI only — `Math.random()`-picked client-side, no
amounts, explicitly built that way for Khabat's visual review first
("lag bare ui... etterpå kan kobles til økonomi"). Proposing first real
numbers here, calibrated against §1's actual rates so a wheel spin doesn't
outclass the *deliberate* effort-based paths (ads/referrals) above:

| Prize (rarity) | Proposed range | Rationale |
|---|---|---|
| GB Quota (common) | 50–200 MB | Below a single ad-watch (250MB) — a free daily spin shouldn't beat the effort of watching one ad |
| Zar (rare) | Shahnameh currency — **no rate visible from this repo**, see §6 |
| Gem (epic) | Shahnameh currency — same gap |
| Farr (legendary) | Shahnameh currency — same gap |
| REAL (mythic) | 10–40 REAL | Below `redeem_min_real` (50) on its own — a single lucky spin shouldn't immediately unlock a redemption; several spins or a REAL-mode day should |

**Not proposing equal 20% odds for all five** (today's placeholder is
uniform `Math.random()` across 5, fine for a visual preview, wrong for a
real economy) — rarity should mean rarity. A reasonable first pass:
common 45%, rare 25%, epic 15%, legendary 10%, mythic 5%, tunable server-side
once real usage data exists (same `settings`-table pattern as every other
rate in this doc, not hardcoded).

## 4. AdMob revenue split — DECIDED: Scenario A, liquidity-first

**Khabat's decision, 2026-07-30: liquidity first.** Scenarios B and C
below are kept for the record (why A was the right call, not live
options anymore) — this section used to present three options; it's now
one decision plus the reasoning that led there. Starting split: **70%
liquidity / 30% airdrop** (post-server-cost margin, before §8's founder
cut), matching the "North star" section above — REAL needs to be worth
something real before its economy can fund anything, including the
eventual "free internet for everyone" goal.

Original framing, for context on how the three scenarios compared before
one got picked: don't pick a percentage for her —
model 2–3 concrete scenarios and what each actually implies for (a) how
fast REAL gets a real market price and (b) how big the eventual airdrop
pool ends up being. Framing first, since this matters for reading the
numbers below correctly: **this is a different flow from §5's referral-REAL
curve.** This section is a cash waterfall (real USD from ad revenue, split
into reserve buckets); §5 is a token-emission schedule (REAL minted/granted
for user actions). They both eventually fund/interact with the same REAL
supply, but they're governed separately — don't conflate "how much REAL do
we mint for referrals" with "how do we split the cash that backs REAL's
price."

**Can't attach real dollar figures yet** — this repo has unit economics
(§1: $3 eCPM, $0.02/GB egress) but not aggregate revenue, because the
AdMob *reporting* OAuth sync is currently broken (`admob_last_error`:
token expired/revoked, separate from the serving pipeline which does
work — see `[[realgram-calling-audio-bug]]`'s AdMob section from earlier
today). Scenarios below are expressed as percentages of whatever margin
remains after server/egress costs (§1's finding: the ad-*reward* flow
specifically is near break-even or slightly negative on raw egress, so
this margin is overwhelmingly from banner/interstitial impressions
outside the reward flow, which carry no matching egress cost).

| Scenario | Split (after server costs, before founder cut — see §8) | Price-discovery speed | Airdrop pool size | Real risk |
|---|---|---|---|---|
| **A — Liquidity-first** | 70% liquidity / 30% airdrop | Fastest — a deeper pool from day one means real price discovery and less slippage on the first trades | Smallest of the three | Airdrop feels stingy if the community's been waiting a while by launch |
| **B — Airdrop-first** | 30% liquidity / 70% airdrop | Slowest — thin liquidity means REAL's first price is fragile | Biggest of the three | **The dangerous one given §0**: REAL has *zero* liquidity today. A big airdrop hitting a thin/empty pool is the textbook setup for an immediate crash the moment recipients try to sell — could tank REAL's credibility in its first week rather than build it |
| **C — Even split** | 50% liquidity / 50% airdrop | Middle | Middle | Safest default given REAL's current zero-liquidity starting point — genuinely no dominant strategy, but avoids both A's "airdrop feels thin" and B's "no floor to sell into" |

**Confirms the decision above**: given §0's finding that REAL is starting
from *literally zero* liquidity — not "thin," zero — Scenario B's crash
risk isn't hypothetical, it's close to guaranteed with any airdrop of
meaningful size. A stays a *starting* split, not necessarily forever —
**rebalancing toward more airdrop-weighted once there's a real trading
floor and volume** is still the plan, worth revisiting once REAL actually
has price history to look at, not something to lock in permanently
today.

## 5. Referral-REAL — diminishing curve proposal (not a hard cap)

Khabat's answer: diminishing-returns curve, same *shape* as the existing
Fibonacci quota-milestone taper (§2) — grows forever in absolute terms,
flattens hard on the marginal rate, no wall anyone suddenly hits. Concrete
proposal, reusing the exact same milestone breakpoints the quota system
already uses (3/8/21/55 invites) so the "feel" matches something a player
already recognizes rather than inventing a second curve language:

| Referral # | REAL per referral in this band | Cumulative REAL at band end |
|---|---|---|
| 1–8 | 500 (unchanged — today's rate, no regression for the typical inviter) | 4,000 |
| 9–21 | 300 | 4,000 + 13×300 = 7,900 |
| 22–55 | 150 | 7,900 + 34×150 = 13,000 |
| 56+ | 75 (floor — never zero, invitations always mean *something*) | grows 75/referral forever |

Compare to today's flat rate at the same milestones: 8 referrals = 4,000
either way (**zero change for most users** — the taper only bites past
the point where someone's already a serious inviter). Past that: at 21
referrals, 10,500 flat vs. 7,900 on this curve (25% less), at 55, 27,500
flat vs. 13,000 (53% less), at 100, 50,000 flat vs. 16,375 (67% less).
The curve doesn't punish normal inviters at all and tames the
extreme tail hard — matches "avtagende, ikke et hardt tak" exactly: nobody
stops earning, the 200th referral still pays 75 REAL, but the runaway
growth from §2's finding is gone.

## 6. What's still genuinely open (Dr. Dadashi and §4's split are resolved, see top of doc)

- **Shahnameh's own Zar/Gem/Farr economy** — genuinely zero visibility
  from this repo, independently re-verified 2026-07-30 rather than just
  repeating the earlier claim: read `zarSyncService.ts`, `zarStore.ts`,
  `re_tap_sync()`/`re_zar_swap()` in `lib/real_economy.php`, and
  `ChapterBattlePanel.tsx` directly. **Zar** is a pure passthrough — taps
  get relayed to Shahnameh's `/v1/tap-sync`, and the Zar→REAL swap rate
  comes back from Shahnameh's `/v1/zar-swap` response; this repo never
  computes or stores a rate, only audit/idempotency records. **Gem**
  doesn't appear anywhere in this repo at all, client or server — not a
  missing rate, a missing currency. **Farr** only exists as a number
  received from elsewhere and used to gate chapter unlocks
  (`ChapterBattlePanel.tsx`) — never earned or spent through any code
  here. So: not a documentation gap, an architectural one — whoever has
  `shahnameh-backend` access needs to supply real earn/sink rates before
  the wheel can be balanced against the rest of the game's economy.
  **Built the config mechanism anyway**, per Khabat's ask (2026-07-30,
  "du og a bygger opp det som trengs rundt zar gem farr"): added
  `WHEEL_SETTING_DEFAULTS`/`re_wheel_settings()` in `lib/real_economy.php`
  — same `settings`-table pattern as `real_per_gb` etc., all three
  defaulted to `'0'` (not a guessed positive number — a `0` default means
  the wheel literally can't pay these out by accident until someone sets
  a real value). Also flagged in that same code comment: even once real
  numbers exist, there's still no write path from this repo to actually
  grant Zar/Gem/Farr to a user — `re_zar_swap()` only converts an
  *existing* Zar balance, it doesn't create Zar, and Gem/Farr have no
  endpoint here at all. Two separate blockers, not one: the rate, and the
  grant channel.
- **§5's referral-REAL curve** — proposed, not yet confirmed by Khabat.
- **§7's node-operator rate and §8's founder-cut number** — both first
  drafts, same "propose, don't decide for her" rule as §5.
- **The "free internet for everyone" end-state shape** (see North star
  section) — quota removed entirely vs. effort-paths generous enough to
  not matter in practice. Ask before building either.

## 7. Future: Starlink/exit-node operator rewards (new, per Khabat's ask)

New ask, not previously scoped anywhere in this doc or `TASK_SPLIT.md`:
when someone contributes their own node (framed around Starlink
specifically, presumably tied to `[[starlink-exit-node-phase1]]`'s
infrastructure work — currently a single company-run exit node, not yet
a community node marketplace) to actually carry traffic for other users,
they should earn REAL for it, with a slice redirected back to the
community pool — "alle som bidrar må få noe tilbake" extended from
referrals/ads to infrastructure contribution as a third earning path.

**Grounding the rate**: §1 established the one real cost number this
whole system has — egress costs the company $0.02/GB. A node operator
*providing* that GB instead of the company's own servers is a genuine
supply-side contribution, arguably more valuable than a demand-side
referral, so anchoring node-operator REAL/GB at or above the existing
100 REAL/GB redemption rate (§0's only real internal exchange rate) is
defensible rather than arbitrary. First-draft proposal:

- **100 REAL per GB of verified traffic actually relayed** through the
  operator's node (not a flat per-node/per-day rate — ties the reward to
  real contribution, not just having a node listed, which matters for
  the same reason `trustai_score_referral()` exists for referrals: a
  self-reported "I ran a node" claim with no traffic behind it shouldn't
  pay out).
- **20% of that redirected to the community pool** Khabat asked for
  (same reserve system as §4/§8, not a separate one) — operator nets 80
  REAL/GB, 20 REAL/GB flows to community.
- **Real, unresolved blocker, not glossed over**: none of this can
  actually ship without a trust-verified bandwidth-metering mechanism —
  measuring GB *actually relayed* through a specific operator's node,
  server-side, the same way `trustai_score_referral()` verifies a
  referral is real rather than trusting a client claim. That
  infrastructure doesn't exist yet as far as this repo shows (Starlink
  Phase 1 is a single company-operated exit node per
  `[[starlink-exit-node-phase1]]`, not a multi-operator system with
  per-node accounting). This section is the reward-rate design for
  *when* that infrastructure exists, explicitly marked "i fremtid" in
  Khabat's own message — not something to start building today.

## 8. Full REAL allocation — the piece that was missing: founder/dev/investor

Khabat, correctly: every bucket above (liquidity, airdrop, community,
node operators) was accounted for except the person who owns, builds, and
funded this whole thing. Real gap, not a joke to wave off. Every
comparable token project (this is completely standard, not unusual to
ask for) carves out a founder/team/investor allocation alongside
community/ecosystem/liquidity buckets — typically 10–20% of total
supply or of ongoing treasury flow, often vesting-locked to show
long-term commitment rather than an instant cash-out.

Folding this into §4's cash waterfall as a third bucket rather than a
separate pool (keeps one governance surface, not two):

| Bucket | First-draft % (of post-server-cost margin) |
|---|---|
| Liquidity reserve | 45% (scenario-dependent per §4 — this is scenario C's 50 shaved by 5 to make room below) |
| Airdrop/community reserve | 40% |
| **Founder/dev/investor (Khabat)** | **15%** |

15% sits in the normal range for a solo founder who's also the sole
investor and the only person actually shipping code across this entire
ecosystem (VPN core, RealGram, the economy layer itself) — not
maximalist, not token. Entirely her call to move up or down; the point
of this section is that the bucket now *exists* in the model at all,
which it didn't before she flagged it.

Posted to `TASK_SPLIT.md` for agent B's Shahnameh-side input; the market-
price, quota-side, and revenue-split sections above are usable now
regardless of the open items.
