# Rewarded Ads + Hidden Recovery Quota — Design

Status: **design + backend/admin build** (no mobile build, no CI, no rollout this round).
Owner: Realink. Created 2026-06-16.

Goal: let users who can't pay unlock VPN quota by watching **real** rewarded ads, and
guarantee that a user at **0 GB is never deadlocked** — they can always reach the few
endpoints needed to watch an ad, pay, or recover, via a throttled **Recovery Mode**.

Compliance is non-negotiable: **no** manipulation of Google/AdMob signals, Advertising ID,
device identity, or location. Real users, real impressions, transparent rewards, server-side
validation, anti-abuse caps. The server is the **single source of truth** for all quota.

---

## 1. Architecture constraints (why the design looks like this)

Verified from the repo (see also memory `project_quota_enforcement_arch`):

1. **All mobile users share ONE Reality UUID.** xray cannot tell mobile devices apart.
2. **Mobile quota is client-reported.** `devices.quota_bytes_used` only grows when the app
   calls `report-session` on disconnect (`public/api.php`, delta model, idempotent on
   `session_id`). The server cannot force-disconnect or per-user-route a single mobile device
   on the existing tunnel.
3. Cron enforcement (`check-quotas.sh` → `disable-user.sh`) only affects named `users.json`
   users, never the shared mobile UUID.

**Therefore Recovery Mode cannot be a per-user routing toggle on the current inbound.**
It must be a **dedicated recovery inbound** whose routing allowlist is **global** (the same for
everyone connected to it) — so no per-user distinction is required inside xray.

---

## 2. Data model

All quota stays in the existing ledger (`lib/quota_economy.php`, invariant
`quota_bytes_total == SUM(quota_transactions.bytes)`). We extend, not replace.

### 2.1 `devices` new columns (added via lazy `ALTER TABLE` migrations)

| Column | Meaning |
|---|---|
| `hidden_recovery_total_bytes` | size of the hidden reserve (default from config, e.g. 512 MB). **Never** surfaced as normal balance. |
| `recovery_used_bytes` | bytes consumed in Recovery Mode (metered separately from `quota_bytes_used`). |
| `device_fingerprint` | stable hash already partly present (`android_id_hash`); reused for fraud consistency. |

> **Visible quota** = existing `quota_bytes_total - quota_bytes_used` (unchanged semantics).
> Hidden reserve is a *separate* pair of counters and is **excluded** from every
> user-facing "remaining GB" calculation.

### 2.2 New ledger type

`quota_transactions.type = 'ad_reward'` — a credit type, added to `QE_CREDIT_TYPES`, granted
only by a confirmed rewarded-ad event. Surfaces in `qe_summary()` as `ad_reward_quota`.

### 2.3 `ad_reward_events` (new table)

```
id              INTEGER PK
device_id       TEXT
nonce           TEXT     -- client-generated at init; idempotency key
status          TEXT     -- 'pending' | 'confirmed' | 'rejected' | 'review'
reward_bytes    INTEGER  -- granted on confirm (0 until then)
ad_unit         TEXT
ssv_verified    INTEGER  -- 1 if AdMob SSV signature validated
source          TEXT     -- 'ssv' | 'client' (client only if SSV unavailable & allowed)
client_ip       TEXT
risk_score      INTEGER
risk_flags      TEXT
created_at      TEXT
confirmed_at    TEXT
UNIQUE(device_id, nonce)   -- makes confirm idempotent
```

### 2.4 `recovery_sessions` (new table)

```
id              INTEGER PK
device_id       TEXT
token           TEXT     -- short-lived recovery token (random, hashed at rest)
issued_at       TEXT
expires_at      TEXT     -- issued_at + recovery_session_secs
bytes_used      INTEGER  -- metered from report-session with recovery=1
status          TEXT     -- 'active' | 'expired' | 'revoked'
```

---

## 3. API contracts (mobile ↔ `public/api.php`)

All responses keep the existing envelope `{ok:bool, data|error}`.

### `GET quota-status` (`?action=quota-status&device_id=…`)
Returns the full picture the empty-quota UX needs:
```json
{ "visible_remaining_bytes": 0,
  "visible_total_bytes": 1073741824,
  "in_recovery_eligible": true,
  "recovery_remaining_bytes": 536870912,
  "ads": { "watched_today": 1, "daily_cap": 4, "reward_bytes": 262144000,
           "cooldown_secs_remaining": 0, "daily_reward_cap_bytes": 1073741824 },
  "config_version": 7 }
```
**Hidden reserve is reported only as `recovery_remaining_bytes`, never folded into
`visible_*`.**

### `POST ads-reward-init`
In: `device_id`, `nonce` (client UUID). Checks daily cap + cooldown + fraud *before* the ad
is shown. Creates `ad_reward_events(status='pending')`. Out: `{accepted:true, nonce, ssv_userid}`
where `ssv_userid = device_id` (passed to AdMob as the SSV `user_id` custom param) or
`{accepted:false, reason}` if capped/cooling-down.

### `POST ads-reward-confirm`
The **fallback / client path**. In: `device_id`, `nonce`. **Idempotent**: if the nonce is
already `confirmed`, returns the same result without re-granting. Grants `reward_bytes` via
`qe_ledger_add(...'ad_reward'...)`. Used only when SSV is not configured (see §4) or as a
client-side hint that is reconciled against SSV.

### `GET/POST ssv-callback` — **AdMob Server-Side Verification endpoint**
AdMob calls `https://setalink.no/api/ssv?...` with signed query params
(`ad_network`, `ad_unit`, `reward_amount`, `reward_item`, `timestamp`, `transaction_id`,
`user_id`, `signature`, `key_id`). We:
1. Fetch & cache AdMob's public keys (`https://gstatic.com/admob/reward/verifier-keys.json`).
2. Verify the ECDSA signature over the unsigned query portion.
3. Map `user_id → device_id`, `transaction_id → nonce` (idempotent), grant reward, set
   `ssv_verified=1, source='ssv', status='confirmed'`.
SSV is the **trusted** path — the client cannot forge it.

### `POST recovery-enter`
In: `device_id`. Only succeeds when `visible_remaining == 0` and reserve > 0 and not abusing.
Creates `recovery_sessions(status='active')`, returns a **recovery profile** (separate
UUID/port/host from config) + `token` + `expires_at`. App connects to the recovery inbound.

### `report-session` (extended)
New optional field `recovery=1`. When set, bytes are metered against `recovery_used_bytes`
(and the active `recovery_sessions.bytes_used`) instead of `quota_bytes_used`. Still idempotent
on `session_id`.

---

## 4. AdMob SSV preparation (IDs are MISSING — placeholders shipped)

The repo has **no AdMob account/SDK/IDs**. We ship the SSV verifier + config keys with
placeholders and document exactly what to fill in. **Nothing grants real rewards until these
are set** (until then `ads-reward-confirm` can run in a `dev_allow_client_confirm` mode behind
an explicit settings flag, default OFF).

**To activate, fill these `settings` keys (admin → Config):**

| Key | What | Where to get it |
|---|---|---|
| `admob_app_id` | AdMob App ID | AdMob console → App settings |
| `admob_rewarded_unit_id` | Rewarded ad unit ID | AdMob console → Ad units |
| `admob_ssv_enabled` | `1` to require SSV | set after testing |
| `ssv_keys_url` | verifier keys URL | default `https://www.gstatic.com/admob/reward/verifier-keys.json` |
| `dev_allow_client_confirm` | `1` only for staging | **MUST be 0 in prod** |

In AdMob console: Ad unit → **Server-side verification** → callback URL =
`https://setalink.no/api/ssv` (final path TBD by routing); set custom data `user_id={deviceId}`.

---

## 5. Recovery Mode (xray) — config artifact, NOT deployed

A dedicated inbound on a **config-selectable exit host** (default = Helsinki
`65.109.183.7`, but `recovery_exit_*` settings override — never hardcoded).

- **Allowlist** via xray `sniffing` (extract SNI/domain) + `routing`:
  allow apex domains only — `setalink.no`, `setalink.net`, Realink API/OTA,
  Google ad/AdMob (`googleads.g.doubleclick.net`, `googlesyndication.com`,
  `google.com`, `gstatic.com`), TON (`tonkeeper.com`, `toncenter.com`,
  `bridge.tonapi.io`), Telegram (`telegram.org`, `t.me`, `core.telegram.org`, Telegram DCs),
  plus SETAEI/Shahnameh domains if provided. **Everything else → `blackhole`.**
- **Throttle** ≤ `recovery_throttle_kbps` (default 512).
- **TTL**: session valid `recovery_session_secs` (default 1200 = 20 min); app must re-`recovery-enter`.
- Metered against the hidden reserve; when reserve hits 0, recovery also stops (user must
  watch an ad / pay / get a referral — all reachable through the allowlist).

Allowlisting is **DNS/SNI-based**, so user traffic is never decrypted — compliant.

---

## 6. Fraud controls (suspicious → review, never instant ban)

Enforced in `ads-reward-init` and at SSV/confirm:
- `ad_daily_cap` videos/day/device (default 4).
- `ad_cooldown_secs` between ads (default 300).
- `ad_daily_reward_cap_bytes` total/day/device (default 1 GB).
- Per-IP /24 velocity: many devices/one IP → raise `risk_score`.
- Device-fingerprint consistency (`android_id_hash`); new device first-24h reduced cap.
- High risk → `status='review'` (reward HELD), surfaced in admin, mirroring the existing
  referral risk-review pattern. **No automatic bans.**

---

## 7. Admin metrics (new "Ads & Revenue" page)

Reuses the Chart.js infra from the Analytics page (`admin/vendor/chart.umd.min.js`,
`views.*` pattern, `dash-*` endpoints). New endpoint `ads-metrics`:
- ads watched today / 7d / 30d (+ trend chart)
- estimated ad revenue (`ads × ecpm/1000`, eCPM from config)
- GB granted from ads vs GB actually used from ad rewards
- recovery GB used; **users saved from zero-data deadlock** (distinct devices that entered
  recovery then recovered visible quota)
- suspicious reward events (review queue)
- revenue/GB and cost/GB estimate (cost/GB from `egress_cost_per_gb` config)

---

## 8. Remote config keys (settings table — no APK update to tune)

| Key | Default |
|---|---|
| `ad_reward_bytes` | 262144000 (250 MB) |
| `ad_daily_cap` | 4 |
| `ad_cooldown_secs` | 300 |
| `ad_daily_reward_cap_bytes` | 1073741824 (1 GB) |
| `hidden_recovery_bytes` | 536870912 (512 MB) |
| `recovery_throttle_kbps` | 512 |
| `recovery_session_secs` | 1200 |
| `recovery_exit_host` / `recovery_exit_port` / `recovery_exit_uuid` / `recovery_exit_pbk` / `recovery_exit_sni` / `recovery_exit_sid` | Helsinki defaults, overridable |
| `ecpm_usd` / `egress_cost_per_gb_usd` | for revenue/cost math |
| `admob_*`, `ssv_keys_url`, `dev_allow_client_confirm` | see §4 |

---

## 9. Mobile (DEFERRED — not this round)

Empty-quota screen, watch-video flow, reward success/fail/retry, recovery switch, event logs
(`AD_REWARD_INIT/LOADED/COMPLETED/CONFIRMED/REJECTED`, `RECOVERY_MODE_ENTERED/BLOCKED_TRAFFIC`),
`react-native-google-mobile-ads`. Server is source of truth — **no local grants**. Built via CI,
shipped via OTA only when explicitly approved. Must not break OTA/version/update flow.

---

## 10. Test matrix (`scripts/test-*.php`)

1. quota>0 → normal mode, recovery not offered
2. quota==0 → recovery eligible
3. ad reward grants from recovery state
4. duplicate ad callback (same nonce) does **not** double-grant
5. daily ad cap enforced
6. hidden reserve never appears in visible/remaining
7. repeated suspicious ad events → `review`
8. recovery allowlist blocks non-whitelisted destinations (routing-config unit assertions)

---

## 11. Rollout checklist (DEFERRED — do not run without explicit approval)

- [ ] Fill AdMob IDs + SSV callback (§4)
- [ ] Deploy recovery inbound to exit host (§5)
- [ ] Set `recovery_exit_*` settings
- [ ] Build mobile via CI, QA, OTA
- [ ] `dev_allow_client_confirm = 0`
