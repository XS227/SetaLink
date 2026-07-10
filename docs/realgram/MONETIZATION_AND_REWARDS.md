# RealGram — Monetization & Rewards

## Principle: reuse, don't rebuild

RealGram does not build its own advertising network or sales portal. It
reuses **AdsGram**, which is already integrated and already paying out in
Shahnameh (`INTEGRATION_MAP.md` §1). Every reward flow below is a new
*client entry point* into the existing `creditAdReward()` pattern
(`lib/adsgram.js` in the Shahnameh backend), not a new reward engine.

## 1. AdsGram — verified facts (as of this assessment, sourced)

- AdsGram is a real, TON-ecosystem-backed ad network — publicly documented
  as having received a $50k TON Foundation grant.
- It already pays Shahnameh out today (mechanism confirmed in code, payout
  volume is negligible so far — see §4).
- Its own published placement categories are **Mini Apps, channels, bots,
  and "alternative clients."** The fourth category is a positive signal for
  RealGram specifically, but it is marketing-copy language, not a confirmed
  technical/contractual spec for the exact in-chat placement described below.
- Primary ad format is rewarded video; it also supports message-styled
  native ads, TMA banner ads, task ads, bot broadcast ads, and 24-hour
  channel post ads.

**Action required before designing the in-chat placement:** contact AdsGram
directly (or read their full integration docs, not marketing pages) and get
explicit confirmation that "alternative clients" covers a native,
non-Mini-App chat UI with locally-rendered sponsored cards. This is tracked
as an open item — see `OPEN_QUESTIONS.md`. **Do not build the in-chat
placement before this is confirmed.**

## 2. Rewarded connectivity — flow

Adapting the existing Shahnameh `watch` tier pattern
(`lib/adsgram.js`) and ReaLink's `Recovery Mode` tiered-inbound concept
(`ARCHITECTURE.md` §5):

```
User is on the free/default connectivity tier
    → RealGram UI offers a reward (copy examples below)
    → User voluntarily watches an AdsGram rewarded ad
    → RealGram backend verifies the reward (client-reported + AdsGram
      server postback, both funnel into one crediting function —
      same pattern as lib/adsgram.js's two entry points)
    → User's connectivity entitlement is updated (short-lived token for
      the "priority" tiered inbound, per ARCHITECTURE.md §5)
```

Example copy (illustrative, not final):

- "Watch a short video and get 2 hours of Priority Connection."
- "Watch ad → faster media for 2 hours."
- "Watch ad → additional ReaLink data."

**Every number in these examples — duration, data amount, eligibility — must
be backend-configurable**, exactly like `ad_reward_bytes`,
`ad_daily_cap`, `ad_cooldown_secs` in `docs/REWARDED-ADS-RECOVERY.md` §8.
Do not hardcode "2 hours" or any other figure as a business rule in the
client. This mirrors the brief's explicit instruction and the existing
codebase's own convention.

Possible reward types to support (config-driven, not all required for v1):
2-hour Priority Route, faster media routing, temporary priority connection,
additional data allowance, temporary access to a faster ReaLink node.

## 3. Ad placement — the in-chat "Sponsored" card

**Strict, non-negotiable constraints** (from the brief, restated as hard
requirements):

- Not a Telegram message.
- Not uploaded to Telegram, not stored in Telegram message history.
- The other chat participant never receives or sees it.
- Never impersonates a contact, Telegram, or a normal message.
- Clearly labelled "Sponsored."
- A local RealGram UI component only — rendered client-side, no protocol
  interaction with Telegram at all.

**Compliant fallback sequence, if AdsGram cannot confirm native in-chat
support (§1):**

1. Move the ad surface to a dedicated **Connectivity** or **Rewards**
   screen — clearly separated from the chat feed. This is unambiguously
   supported by every source found and is the same surface the app-store
   staged release already isolates ads to (`APP_STORE_COMPLIANCE.md`).
2. Alternative: an embedded Telegram Mini App / RealGram bot entry point for
   the reward flow, reusing Shahnameh's existing pattern almost verbatim.
3. Any other AdsGram-supported flow confirmed during the §1 verification
   step.

The dedicated-screen fallback should be the **default assumption for
planning purposes** until AdsGram confirms otherwise — do not plan the v1
build around the unconfirmed native in-chat placement.

## 4. Economics — what can honestly be said right now

**The actual Shahnameh AdsGram sample is ~13 impressions, $0.00 USDT earned,
with country reporting showing Iran/USA/Other.** This is not enough data to
derive a real CPM, fill rate, or reward completion rate. Any number below is
a labelled assumption with a source, not a fact — treat it as a planning
input, replace it with real data as it accumulates.

| Input | Assumption | Source |
|---|---|---|
| AdsGram eCPM | $3.80 – $16.00 | AdsGram's own published range (0.5–2 TON), current at time of research — vendor-stated, unverified at RealGram's actual traffic mix |
| Broader Telegram ad CPM band | $0.36 – $16+ | General market range, used only to bound the worst case lower |
| Ad impressions / DAU / day | 0.3 – 1.2 | Assumption, modelled off the existing 5/day watch-ad cap at low/medium/near-cap engagement |
| Fill rate | 55% – 85% | Assumption, typical rewarded-video range, not AdsGram-specific data |
| Reward completion rate | 70% – 90% | Assumption, typical for opt-in rewarded video |
| Routed data / DAU / day | 40 – 150 MB | Assumption, text-and-media messaging usage, not measured on ReaLink traffic |
| Egress cost / GB | **Check `egress_cost_per_gb_usd` in the settings table before using any placeholder here** | This config key already exists (`docs/REWARDED-ADS-RECOVERY.md` §7) — a real operator-configured value likely already exists; do not guess when you can read it |

### Scenario table (worst / base / best), illustrative

| DAU | Case | Ad revenue/day | Bandwidth/day | Egress cost/day (at $0.01–0.05/GB placeholder) | Nodes needed |
|---|---|---:|---:|---:|---:|
| 1,000 | Worst/Base/Best | $65 / $310 / $1,120 | 150 / 80 / 40 GB | $7.50 / $2.40 / $0.40 | 1–2 |
| 10,000 | Worst/Base/Best | $650 / $3,100 / $11,200 | 1,500 / 800 / 400 GB | $75 / $24 / $4 | 5–20 |
| 100,000 | Worst/Base/Best | $6,500 / $31,000 / $112,000 | 15,000 / 8,000 / 4,000 GB | $750 / $240 / $40 | 50–200 |

**How to read this table:** ad revenue clears bandwidth cost comfortably in
every scenario — egress is cheap relative to rewarded-video CPM. That is
**not** the real constraint. Going from ReaLink's current 2 nodes (1 public,
1 gated test — `docs/MULTINODE_API_v1.md`) to 50–200 nodes at 100k DAU is a
full multi-region operations build-out (provisioning, monitoring, DPI-evasion
maintenance per `docs/CLAUDE_REALINK_RULES.md` Rule 1, support) — not a line
item this table prices. Read "net/day is positive" as "ad revenue is not the
bottleneck," not as "this is funded."

## 5. What NOT to build

- No RealGram-owned ad sales portal or advertiser-facing product.
- No AdMob/ad-network geolocation manipulation via ReaLink exit nodes — see
  `APP_STORE_COMPLIANCE.md` Rule 3 for the full statement of this boundary.
- No hardcoded reward economics anywhere in client code.
