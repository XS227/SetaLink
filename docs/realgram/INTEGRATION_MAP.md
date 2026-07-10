# RealGram — Integration Map

What exists today, exactly where, and how RealGram reuses it. Everything in
this file was read directly from code/config during the assessment session
(2026-07-10) — nothing here is inferred from naming alone.

**Important:** Shahnameh and TrustAI are **separate repositories/projects**,
not part of this SetaLink repo. This doc records their locations as known
from the VPS they currently run on (`/var/www/...` — a shared ops host, not
this repo) so a future agent — possibly working from a different machine —
knows where to look or what to ask for.

---

## 1. Shahnameh — REAL economy + AdsGram rewards

**Location (as of 2026-07-10):** Node/MongoDB backend at
`/var/www/backend/backend` (systemd service `shahnameh-backend`, port 3000);
Telegram bot at `/var/www/shahnameh_demo` (Django, systemd service
`shahnameh-bot`, **currently used only for its `telegram_bot.py` polling
process** — the Django REST API itself is paused, see its own README);
static/Angular frontend at `/var/www/shahnameh` (systemd-fronted via nginx,
domain `shahnameh.setaei.com`). Git remotes: frontend →
`git@github.com:XS227/REALShahnameh.git`; backend has its own `.git` at
`/var/www/backend/backend` (remote not confirmed during this session — check
before assuming write access).

### What's live and directly reusable

- **AdsGram reward engine** — `lib/adsgram.js` in the backend repo. Four
  tiers (`bronze`, `silver`, `gold`, `watch`), each with `real` (REAL token
  amount), `gems`, `minCooldownSec`, and (for `watch`) a `dailyLimit` +
  `gemOnFifth` bonus. Block IDs come from env vars
  (`ADSGRAM_BLOCK_ID_BRONZE/SILVER/GOLD/WATCH`), not hardcoded. Crediting is
  **server-authoritative** with an optimistic-lock write (matches on the
  previous `last_ad_watch` timestamp) so concurrent/duplicate claims can't
  double-pay — this pattern should be copied exactly for any RealGram
  reward, not reinvented.
- **Client-side integration reference** — `season2/adsgram.js` in the
  frontend repo. Shows the actual `window.Adsgram.init({blockId}).show()`
  call, cooldown/daily-cap UI state, and the round-trip to the backend's
  verify-reward endpoint. Useful as a working example even though RealGram's
  client is a different stack (mobile, not web).
- **Server routes** — `routes/api/season2.js` (client-reported
  `POST /season2/ads/verify-reward`) and `routes/adminApi/ads.js` (AdsGram's
  own server-side postback callback). Both call the same `creditAdReward()`
  in `lib/adsgram.js` — **one authoritative crediting function, two entry
  points**. RealGram's rewarded-connectivity flow should follow the same
  shape: a client-reported path plus a server-verified postback path,
  both funneling into one crediting function.
- **REAL balance ledger** — `model/season2User.js`, field `real_balance`,
  incremented via MongoDB `$inc` inside the optimistic-lock update.

### What's designed but not live

- On-chain REAL token: real jetton exists on TON (listed on DYOR), but the
  market is in **pre-listing / Season 2 growth phase** — `api/market/real.php`
  in the frontend repo explicitly documents that its price data is
  *simulated* pending a real DEX listing. Do not treat REAL as having a
  reliable on-chain price yet.

### AdsGram real-world sample (as reported by the user, not independently verified)

Approximately 13 impressions, $0.00 USDT earned, country breakdown showing
Iran/USA/Other. **This sample is too small to derive a real CPM or fill rate
— do not use it as a revenue assumption.** See `MONETIZATION_AND_REWARDS.md`
for how the economic model handles this.

### RealGram's Shahnameh integration — access points to evaluate

Per the product vision, Shahnameh is reused as-is, not rebuilt, as RealGram's
Play/Earn surface. Candidate access points (pick one for v1, don't build all):

- A **Play** or **Earn** tab in RealGram.
- A card on RealGram's profile/reward screen.
- A Mini App / WebView entry point (Shahnameh's frontend is already a web
  app — this is the lowest-effort integration).
- Non-intrusive promotional cards at natural moments (matches the existing
  "ecosystem banner" concept already planned in
  `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §B).

**Hard requirement carried over from the brief:** do not bundle Shahnameh's
game assets inside RealGram's app package. Load it remotely (WebView/Mini
App) or fetch assets on demand. See `BUILD_SIZE_BUDGET.md`.

---

## 2. ReaLink / SetaLink — this repository

Already covered in depth in `ARCHITECTURE.md`. Summary of what's reusable:

- Xray-core binary + local SOCKS5 inbound (`mobile-app/docs/ARCHITECTURE.md`).
- Quota ledger + invariant (`docs/REWARDED-ADS-RECOVERY.md` §2).
- `Recovery Mode` tiered-inbound pattern (`docs/REWARDED-ADS-RECOVERY.md` §5).
- REAL/USDT payment intent + on-chain verification design
  (`docs/PREMIUM-REAL-PAYMENTS.md`) — designed, not shipped to mobile yet.
- Multi-node API (`docs/MULTINODE_API_v1.md`) — built, not public; only 2
  nodes exist today.

---

## 3. TrustAI — referral system

**Location:** `/var/www/trustai` (separate repo — check remote before
assuming write access). Two things exist here, and they are different in
scope:

- **TrustAI's own ambassador program** — `ambassador-signup.html`,
  `ambassador-dashboard.html`, `api/ambassador*`, `api/referrals.php`,
  `api/track-referral-click.php`. A broader signup → approval → dashboard →
  click-tracking program, not VPN-specific.
- **The referral pattern already live inside *this* repo (SetaLink)** —
  per `mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md` §C: referral code =
  userId suffix, **+1 GB reward per successful referral**, `referral_uses`
  table with risk scoring, live since **v0.9.16**. This is the one RealGram
  should extend — it already grants real quota and already has fraud
  scoring, so there's no reason to route through TrustAI's separate program
  for this.

### RealGram referral model (adapted from the existing pattern)

The brief asks for `inviter → RealGram user → Telegram activation →
qualified activation → reward`, mapped onto the existing
`ambassador → store → click → sale` shape. Concretely, adapting the
**already-live** SetaLink referral flow:

| Existing SetaLink referral | RealGram equivalent |
|---|---|
| Referral code = userId suffix | Same mechanism, same ID format |
| Reward: +1 GB, on first VPN connect of invitee (not registration) | Reward: configurable (see below), on **qualified activation**, not install |
| `referral_uses` table, risk-scored | Same table, extended with a `source` or `channel` field for `'realgram'` vs the existing mobile-app channel |
| One reward per device fingerprint | Same anti-abuse rule, unchanged |
| Flagged referrals require admin approval | Same admin review queue, unchanged |

**Qualified activation must be defined precisely before implementation** —
this is listed as open in `OPEN_QUESTIONS.md`. Candidate definitions from the
brief, in increasing order of strictness:

1. Invited user installs RealGram (weakest — easiest to farm).
2. Invited user successfully logs into Telegram through RealGram.
3. Invited user remains active for a qualification period (e.g. 24–72h).
4. Invited user sends/receives normal Telegram activity in that period.
5. Invited user watches a rewarded ad (ties activation to a monetizable event).

The existing SetaLink rule — reward on **first VPN connect**, not
registration — suggests the team's existing bias is toward option 2 or 3
(a real usage signal, not just an install). Follow that precedent unless a
decision says otherwise.

**Reward amount:** the brief's example ("5 GB ReaLink data" for a qualified
Telegram activation) and the existing milestone ladder **3 / 5 / 8 / 13 / 21**
(Fibonacci-shaped, already used elsewhere in ReaLink's reward design per the
brief) should both be treated as **starting points, not fixed values** — make
this backend-configurable exactly like `ad_reward_bytes` and the other reward
constants in `docs/REWARDED-ADS-RECOVERY.md` §8, not hardcoded in the client.

---

## 4. What this means for build order

Nothing in RealGram's reward/referral/economy layer requires new backend
architecture — it requires **extending three already-working systems**
(Shahnameh's AdsGram engine, SetaLink's quota ledger + referral table,
SetaLink's Recovery Mode pattern) with a new client channel (`realgram`) and,
where the Ecosystem Integration Plan's §A redemption ledger doesn't exist
yet, building that one specific piece. See `IMPLEMENTATION_PLAN.md` for
sequencing.
