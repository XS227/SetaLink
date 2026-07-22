# Monetization & Ads Reporting — Design

Status: **shipped** (backend + admin UI live on `setalink.no`). Owner: Realink.
Created 2026-07-20.

Goal: one admin page (`/admin` → Monetization) where every AdMob and AdsGram
number carries its real source and trust level, AdMob and AdsGram are never
blended, and no number is presented as "real revenue" unless it actually came
from a provider. See `TASK_SPLIT.md`'s Khabat brief (2026-07-20) for the
original requirements this implements.

---

## 1. Where AdMob numbers come from

| Number | Source | `source_type` |
|---|---|---|
| Rewarded-video completions/GB | `ar_confirm_reward()` (`lib/ads_recovery.php`) — AdMob's own Server-Side Verification (SSV) postback, signature-checked | `PROVIDER_CALLBACK` (SSV-verified) or `LOCAL_SDK_EVENT` (client-confirm path, only live if `dev_allow_client_confirm=1`, which must be `0` in prod) |
| Banner impressions + revenue | `AD_BANNER_IMPRESSION` app_events, from the AdMob SDK's `onPaid` callback, client-reported | `LOCAL_SDK_EVENT` — real value from Google's SDK, but not server-verified |
| Requests / matched requests / impressions / clicks / eCPM (network-wide, not just rewarded) | AdMob Reporting API (`lib/admob_sync.php`), OAuth-connected | `PROVIDER_API` — only once connected, see §5 |
| The old "AdMob revenue" number on the legacy Ads NOC page (`lib/ads_perf.php`) | `confirmed rewarded views × configured ecpm_usd` | `ESTIMATE` — kept for backward compat on that page only; the Monetization page never uses this formula |

**Before this work**, "AdMob revenue" shown in admin was 100% the `ESTIMATE`
formula above — never a real Google number. That's still true of the legacy
Ads NOC page (kept, relabeled "Ads (legacy NOC)"); the new Monetization page
only shows `ESTIMATE` numbers with an `estimated` badge, never bare.

## 2. Where AdsGram numbers come from

The AdsGram reward-callback code (`handleCallback()`, `tierForBlockId()`,
`lib/adsgram.js`, `routes/adminApi/ads.js`) lives in **Shahnameh's Node+Mongo
backend on a different host** (`shahnameh.setaei.com`), owned by Agent B — not
in this repo. Three channels bring AdsGram data into this repo:

1. **`push-adsgram-perf`** (`public/api.php`) — daily aggregate, pushed by
   Shahnameh's cron. Historically revenue/eCPM/fill_rate were pushed as `0.0`
   placeholders (no AdsGram publisher API token existed yet — see
   `TASK_SPLIT.md` A→B(18)/(19)). `source_type = PROVIDER_CALLBACK` (relayed
   through Shahnameh, one hop removed from AdsGram's own dashboard/API).
2. **`push-adsgram-events`** (`public/api.php`, added 2026-07-20) — per-event
   data, forwarded every 15 minutes by Shahnameh's `AdEventLog` (Mongo)
   forwarder. Contract fixed by Agent B, `TASK_SPLIT.md` B→A(56)/A→B(57). Each
   event's `source` field distinguishes:
   - `server_callback` → AdsGram's own postback hit Shahnameh directly →
     `source_type = PROVIDER_CALLBACK`.
   - `client` → Shahnameh's `verify-reward` path (validated server-side by
     Shahnameh, but not itself an AdsGram-confirmed signal) →
     `source_type = LOCAL_SDK_EVENT`.
3. **AdsGram publisher API** (`lib/adsgram_publisher_sync.php`, optional) —
   direct pull from `api.adsgram.ai/publisher/stats` once a token is
   configured. `source_type = PROVIDER_API`. **The exact response field names
   are unverified** — nobody on this side has held a real token yet
   (`TASK_SPLIT.md` A→B(19) documents this). `adsgram_pick()` tries several
   plausible key names defensively; if the shape doesn't match at all, the
   sync fails loudly (`adsgram_last_error` in settings) rather than silently
   parsing garbage.
4. **CSV import** (manual AdsGram dashboard export) — `source_type =
   MANUAL_IMPORT`. Works independently of the publisher API token.

**Known root cause of "AdsGram numbers are near-zero"**: the Reward URL
configured in AdsGram's own dashboard (block `35738`, "watch" tier) is missing
`blockId`+`secret` query params, so real user postbacks fail AdsGram's
signature check and only a test account has ever been credited. This is a
Khabat-only fix (AdsGram dashboard login) — tracked in `TASK_SPLIT.md`
A→B(20), not something either agent can fix from code. **The AdsGram callback
secret referenced there is compromised** (committed in plaintext to this
file's git history) — needs rotation on the AdsGram dashboard + Shahnameh's
`.env` whenever convenient.

## 3. Provider revenue vs. estimated revenue

Every number in the Monetization UI renders with a badge:

| Badge | `source_type` | Meaning |
|---|---|---|
| `verified` | `PROVIDER_API` | Fetched directly from the provider's own reporting API |
| `provider_reported` | `PROVIDER_CALLBACK` | The provider's own signed postback (SSV, AdsGram callback) — real, but not a full-account report |
| `local` | `LOCAL_SDK_EVENT` / `DATABASE_AGGREGATE` | Real signal from our own SDK/server, not provider-confirmed |
| `manual` | `MANUAL_IMPORT` | Hand-imported (CSV) |
| `estimated` | `ESTIMATE` | Locally computed guess (e.g. views × configured eCPM) |

`AM_SOURCE_PRIORITY` (`lib/ad_monetization.php`) ranks these 1 (most trusted)
to 6 (least). `am_daily_metric_upsert()` **refuses** to let a lower-trust
write overwrite a higher-trust one for the same `(date, provider, app,
platform, ad_unit_id)` — a CSV import can never silently clobber a real
`PROVIDER_API` sync, tested in `scripts/test-monetization.php`.

**NOK and USDT are never summed directly.** `am_provider_summary()` groups
revenue by `(source_type, currency)` and returns a `breakdown` array — the UI
renders each currency/source pair separately (`revenueLine()` in
`admin/index.php`). A combined total, if ever added, must go through
`am_to_base()`, which returns `null` (never a guess) when no FX rate is
configured for that currency (`Configuration` tab, spec'd as manual-entry —
no external FX API dependency was added).

## 4. How callbacks are processed / how duplicates are prevented

Every event lands in `ad_events` (`lib/ad_monetization.php`) keyed by
`(provider, provider_event_id)`, a unique index. `am_event_insert()`:

1. Pre-checks whether `provider_event_id` already exists — if so, returns
   `duplicate: true` and does **not** touch the existing row (not even to
   update its payload). A resend after a transient failure, or AdsGram
   retrying its own postback, is a guaranteed no-op.
2. Otherwise runs `INSERT OR IGNORE` — belt-and-suspenders against a race
   between the pre-check and the insert.

`provider_event_id` is built from whatever the source actually guarantees is
unique: AdMob's SSV `transaction_id` (`admob-reward:{device}:{nonce}`),
AdsGram's Mongo `_id` (`adsgram-event:{providerTransactionId}`), or a
synthetic key for aggregate-only sources (`admob-banner:{app_events.id}`).

**AdMob SSV signature verification** (`ar_verify_ssv()`, `lib/ads_recovery.php`)
was already correct before this work — AdMob's reward verifier keys are
fetched from Google, cached 24h, and `openssl_verify()` checks the signature
before any reward is granted. Nothing in this change touches that.

**AdsGram callback signature verification** happens in Shahnameh's backend,
not here (see §2) — cannot be changed from this repo.

## 5. Running syncs

### AdMob (OAuth, one-time setup)

The AdMob Reporting API has **no service-account delegation** (unlike
GA4/GSC, `admin/ga4_sync.php`) — a human must complete an OAuth consent once.

1. Google Cloud Console → a project with the **AdMob API** enabled.
2. Create an **OAuth 2.0 Client ID** (type: Web application), redirect URI
   `https://admin.realgram.no/_setalink-admin/admob_oauth_callback.php`
   (admin.realgram.no is the single public admin surface Khabat uses — it
   reverse-proxies transparently to this codebase, so `/_setalink-admin/` is
   the real live path, matching `admin/index.php`'s own `API` JS constant;
   the old `/admin/...` path used before this fix 404s on the live server).
3. On the server, create `/etc/setalink/admob-oauth-client.json` (root:www-data,
   0640 — **not** 0600 root:root as this doc previously said: PHP-FPM runs as
   `www-data` and needs group-read, confirmed against the working
   `admin.env` file's permissions), containing:
   ```json
   {"client_id": "...", "client_secret": "..."}
   ```
4. In RealGram Admin → Monetization → Configuration → AdMob, click
   **Connect AdMob** and complete Google's consent screen once. The refresh
   token is stored in `/var/www/setalink/data/admob-oauth.json` (0640, same
   permission pattern as `data/gsc-service-account.json`) — never in the
   database, never returned by any `admin/api.php` response.
5. Daily cron: `0 5 * * * php /var/www/setalink/scripts/sync-admob-daily.php`
   (retries with backoff; exits 0 even when not-yet-configured, so it's safe
   to install before step 1–4 are done).

Manual trigger: Configuration tab → "Sync now" (calls
`monetization-admob-sync-now`).

### AdsGram (optional publisher API)

1. `app.adsgram.ai` → Settings → generate a publisher API token.
2. RealGram Admin → Monetization → Configuration → AdsGram → paste the token,
   Save. (Stored in `settings.adsgram_api_token` — masked in every API
   response, only a `configured: true/false` boolean is ever returned.)
3. "Sync now", or cron `lib/adsgram_publisher_sync.php`'s
   `adsgram_publisher_sync()` on your own schedule.

If the response shape doesn't match `adsgram_pick()`'s guesses (nobody has
tested against a real token yet), `adsgram_last_error` in `settings` will say
so — fix the field-name mapping in `lib/adsgram_publisher_sync.php`, not the
data (already-imported CSV/callback data is unaffected).

### CSV import (no token needed)

Monetization → AdsGram → "Import AdsGram CSV". Expected columns
(case-insensitive, any order): `date`, `block_id`, `impressions`, `clicks`,
`completions`, `revenue`, `currency`. Every row is tagged `MANUAL_IMPORT` and
logged in `ad_csv_imports` (Logs tab) + `monetization_admin_log`.

## 6. Backfill

`scripts/backfill-ad-events.php` (idempotent, safe to re-run):

```bash
php scripts/backfill-ad-events.php --dry-run   # report only
php scripts/backfill-ad-events.php             # write
```

Populates `ad_events`/`ad_daily_metrics` from the pre-existing
`ad_reward_events` / `ad_perf_daily` / `app_events` tables, labeled with their
**real historical `source_type`** — not re-estimated. Existing tables are
never modified or deleted; the backfill only adds rows to the new tables.

## 7. Environment / files

| Path | Contents | Owner |
|---|---|---|
| `/etc/setalink/admob-oauth-client.json` | AdMob OAuth `client_id`+`client_secret` | root:www-data, 0640 |
| `/var/www/setalink/data/admob-oauth.json` | AdMob refresh token (post-consent) | www-data, 0640 |
| `settings.adsgram_api_token` (DB) | AdsGram publisher API token | masked in all API responses |
| `settings.mon_*` (DB) | Base currency, reward valuation, FX rates | non-secret, shown in Configuration |

No secrets are ever returned by `admin/api.php` — `admob_sync_status()` /
`adsgram_sync_status()` expose only `configured`/`connected` booleans and
timestamps (tested in `scripts/test-monetization.php`).

## 8. Reconciliation

Monetization → Reconciliation compares, per ad unit/block:
`provider_impressions`, `provider_rewards_granted` (from `ad_daily_metrics`,
`PROVIDER_API`/`PROVIDER_CALLBACK` rows only) against `local_rewards_granted`/
`local_rejected` (from `ad_events`). A non-zero `difference` is flagged. This
is `am_reconciliation()` in `lib/ad_monetization.php` — see
`scripts/test-monetization.php` for worked examples, including the "provider
reports more completions than we granted locally" and "we granted more than
the provider confirmed" cases.

## 9. Troubleshooting

- **AdMob iOS shows requests but 0 impressions** → surfaced as an alert on
  Overview (`am_alerts()`). Historically this traced to a DNS/routing issue
  (`googleads.g.doubleclick.net` resolving to a private IP while VPN-tunneled)
  rather than a fill-rate problem — see `TASK_SPLIT.md` A→B(55) for the
  `app_events` diagnosis. Not something this admin page can fix (client/tunnel
  routing, not reporting).
- **AdsGram revenue stuck at ~0** → see §2's root cause (Reward URL missing
  `blockId`+`secret` in AdsGram's dashboard).
- **A sync shows "not configured"** → check §5's setup steps; `settings.
  admob_last_error` / `adsgram_last_error` hold the last failure message.
- **Reward cost shows "not configured"** → Configuration tab's
  `mon_value_per_real_usd` / `mon_value_per_gem_usd` are `0` by default
  (`mon_value_per_gb_usd` defaults to the existing `egress_cost_per_gb_usd`
  convention) — set a real value to get an estimate.

## 10. Testing

`scripts/test-monetization.php` — run via `php scripts/test-monetization.php`,
exit 0 = all pass. Covers idempotency (repeated `providerTransactionId` /
different payload for the same ID never double-grants), the
`push-adsgram-events` field mapping, source-priority protection, currency
non-mixing, CSV import (including refusing to overwrite a higher-priority
source), reconciliation math, reward valuation, and secret-masking.

## 11. What's NOT built here (cross-repo / access boundary)

- AdsGram's callback signature/secret handling, block config, and per-event
  `AdEventLog` — all in Shahnameh's Node+Mongo backend, a different host.
  `push-adsgram-events` defines the receiving contract; Shahnameh's
  `scripts/push_adsgram_events.js` (Agent B) is the sender.
- No role-based access control was added — this admin panel has always been
  single-operator, gated by HTTP Basic Auth (nginx) for the whole panel, not
  per-page. Adding RBAC just for this page would be inconsistent with every
  other view and out of scope for this brief.
- No automatic FX-rate fetching — deliberately manual-entry only (see §3), to
  avoid an unnecessary external dependency for financial reporting.
