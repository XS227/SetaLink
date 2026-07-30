# RealGram / REAL economy — balance model (2026-07-30 pass)

> Started per Khabat's direct ask: review the economy "basert på Dr. Nasrin
> Dadashi's vurdering" (her assessment of the Shahnameh economy strategy —
> content not available to this session, see §6), include the Daily Luck
> Wheel, check REAL's current market value, and recalculate the full player
> journey (cards, taps, quota, referrals) so players never get soft-locked
> but also never "overtjene cash." This doc is the working model — numbers
> below are grounded in what's actually configured live (`settings` table,
> `/var/www/setalink/data/analytics.db`) as of 2026-07-30, not guesses.

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

## 4. Proposed AdMob revenue split (doesn't exist in code yet)

Khabat's ask: "admob som inntekt base... en god del % skal tilbake til
liquidity og airdrop + server kostnader." Nothing in this repo currently
splits ad revenue into buckets — it just funds quota grants indirectly via
the eCPM/egress relationship in §1. A concrete starting proposal (not
implemented, needs a real settings key + admin UI + ledger, same shape as
every other rate here):

- **Server/egress costs first, off the top** — this isn't really a
  "split" decision, it's covering real cash outlay (the $0.02/GB number).
  Given §1's finding that ad-rewarded quota is *already* running slightly
  net-negative on raw egress vs. ad revenue, there may currently be little
  or nothing left over for the other two buckets from the ad-reward flow
  specifically — the split more likely applies to *general* AdMob
  impressions (banners, interstitials shown outside the reward flow),
  which have no matching egress cost at all and are pure margin.
- **Liquidity reserve** — a portion set aside toward eventually seeding
  REAL's first DEX pool (relevant directly to §0 — REAL can't have a real
  price until *someone* provides that liquidity).
- **Airdrop reserve** — REAL set aside for the eventual GRAM/USDT
  conversion event Khabat described, funded from ad margin rather than
  minted arbitrarily, so the airdrop has real backing behind it instead of
  being pure inflation.

Actual percentages are a Khabat decision, not something to pick unilaterally
here — flagged as open in §6.

## 5. "Not stuck, not overearning" — where the real risk actually is

Based on what's visible from this repo, the quota side is already
reasonably bounded (see §2) — the bigger open risk is the **uncapped
referral-REAL path** combined with an **undefined REAL "book value"** for
the eventual airdrop. If REAL has no ceiling on how much a heavy inviter can
accumulate, and the airdrop conversion rate to GRAM/USDT isn't itself
capped or scaled to the actual liquidity/reserve available, a small number
of very effective inviters could claim a disproportionate share of whatever
gets set aside in §4 — not because anyone "overearned" by gaming the
system (TrustAI's referral risk-scoring already guards against fake
invites), but because the mechanism itself has no ceiling. Worth deciding,
before the wheel or the airdrop math gets built out further: is there a
per-account cap on total accumulated REAL, or a diminishing-returns curve
past some referral count (mirroring how the Fibonacci quota-milestone
curve already *does* taper in absolute terms even though it grows), rather
than the current flat 500-REAL-per-referral-forever shape?

## 6. What's blocking a fully authoritative model — needs input, not guessed

- **Dr. Nasrin Dadashi's actual assessment content** — Khabat referenced
  this as the basis for this whole review; nothing by that name exists
  anywhere in this repo or its docs. Whatever her assessment actually says
  should shape §3-§5 above, not the other way around — this doc is a
  starting model to react to, not a replacement for it.
- **Shahnameh's own Zar/Gem/Farr economy** — genuinely zero visibility
  from this repo (no SSH, no DB, confirmed multiple times elsewhere in
  `TASK_SPLIT.md`, e.g. around the "migrate Shahnameh" discussion). Every
  number in §3 for those three currencies is a placeholder gap, not a
  proposal — whoever has access to `shahnameh-backend` needs to supply
  real earn/sink rates before the wheel can be balanced against the rest
  of the game's economy, not just against this repo's VPN-quota numbers.
- **AdMob revenue split percentages** (§4) — a real policy decision for
  Khabat, not something to set unilaterally.
- **Referral-REAL ceiling** (§5) — same, a real product decision.

Posted to `TASK_SPLIT.md` for agent B's Shahnameh-side input; the market-
price and quota-side sections above are usable now regardless of the open
items.
