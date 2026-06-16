# Premium Payments — USDT + REAL token (ecosystem discount)

Status: **design + backend/admin build**. Mobile UI prepared, **no APK / OTA / rollout**.
Created 2026-06-16. Companion to the existing quota economy + ads/recovery work.

Goal: let Premium buyers pay with **REAL** (preferred, discounted ecosystem token) or
**USDT** (standard). REAL is the native Realink / SETAEI / Shahnameh ecosystem payment
token and gets a configurable discount (20–30%).

REAL jetton master: `EQDhq_DjQUMJqfXLP8K8J6SlOvon08XQQK0T49xon2e0xU8p`

**Compliance (hard rules):** REAL is a **utility/payment token** for in-ecosystem discounts.
No investment language, no promise of price increase, no "users will profit". Never present
REAL as an asset that appreciates.

**Invariants:** backend is the single source of truth; client payment status is never
trusted; confirmation is **server-side on-chain verified**; grants are **idempotent on
tx_hash**; this is **REAL-specific**, not a generic crypto integration.

---

## 1. Current architecture (verified)

- Mobile `UpgradeScreen.tsx`: hardcoded wallet + USDT jetton + packages, Tonkeeper deeplink,
  "I paid" → `payment_queue` with no tx capture and no verification.
- Backend: `payment_queue` → **manual** admin approval (`payment-approve`) maps package→bytes
  → `qe_credit_purchase` (ledger type `purchase`). No intent / expiry / on-chain check.
- `lib/quota_economy.php` is the ledger (invariant `quota_bytes_total == SUM(ledger)`).
- `public/v1.php` = bearer-`device-<id>` REST router — the home for `/v1/payments/*`.

The new flow **adds** an intent + verification layer; the legacy manual path stays as an
admin fallback (so nothing breaks for in-flight clients).

---

## 2. Data model

### 2.1 `premium_packages` (new table — remote-configurable, admin-editable)

```
package_id          TEXT PRIMARY KEY    -- e.g. 'prem_10gb'
gb_amount           INTEGER             -- GB granted
usdt_price          REAL                -- standard price (USD/USDT)
real_price          REAL                -- discounted REAL-equivalent price
real_discount_percent REAL              -- display badge (derived/cross-checked)
is_recommended      INTEGER DEFAULT 0
is_active           INTEGER DEFAULT 1
display_order       INTEGER DEFAULT 0
created_at / updated_at
```
Seeded with the example ladder (remote-editable, **never hardcoded in the app**):

| package_id | GB | USDT | REAL | discount |
|---|---|---|---|---|
| prem_10gb | 10 | 3.00 | 2.40 | 20% |
| prem_25gb | 25 | 6.00 | 4.80 | 20% |
| prem_50gb | 50 | 10.00 | 8.00 | 20% |

### 2.2 `payment_intents` (new table)

```
payment_id          INTEGER PK
device_id           TEXT
package_id          TEXT
method              TEXT     -- 'USDT' | 'REAL'
amount              REAL     -- token amount due (price)
amount_units        INTEGER  -- amount in smallest units (price * 10^decimals)
token_address       TEXT     -- jetton master (REAL or USDT)
destination_wallet  TEXT     -- recipient
memo                TEXT     -- unique comment 'RLK-<payment_id>-<rand>' (matching key)
status              TEXT     -- pending | confirmed | expired | rejected
tx_hash             TEXT     -- filled on confirm (UNIQUE when non-empty)
gb_amount           INTEGER  -- snapshot at intent time
created_at / expires_at / confirmed_at
UNIQUE(tx_hash) WHERE tx_hash<>''   -- idempotency
```

### 2.3 New ledger credit types

`purchase_real`, `purchase_usdt` added to `QE_CREDIT_TYPES`. Granted via a payment-aware
credit that records `purchased_packages` + a typed ledger row carrying `payment_id` + `tx_hash`.

---

## 3. API (mobile ↔ `public/v1.php`, bearer device id)

### `POST /v1/payments/intent`
In: `package_id`, `payment_method` (`USDT`|`REAL`). Server computes price from
`premium_packages` (client never sets price). Creates a `pending` intent with a unique memo
and `expires_at = now + payment_window_secs`.
Out:
```json
{ "payment_id": 123, "method": "REAL", "amount": 4.80, "amount_units": 4800000000,
  "token_address": "EQDhq_Dj…", "destination_wallet": "UQB…",
  "memo": "RLK-123-a1b2c3", "gb_amount": 25, "expires_at": "2026-06-16 12:30:00" }
```

### `GET /v1/payments/status?id=…`
Returns `pending | confirmed | expired | rejected`. On a `pending` non-expired intent it
**triggers a server-side verification attempt** (poll chain for a matching transfer). Optional
`tx_hash` hint narrows the lookup but is never trusted as proof — the server re-verifies.
Out includes `status`, `gb_amount`, and (on confirm) `new_quota_total`.

> The mobile "I have paid / Check payment" button calls this endpoint. Confirmation is
> entirely server-decided.

---

## 4. On-chain verification (REAL jetton + USDT)

A confirmed payment **must** satisfy ALL of:
1. jetton master == configured token address for the method (REAL = the jetton above).
2. recipient == configured destination wallet.
3. transferred amount ≥ `amount_units` (price in smallest units).
4. transfer comment/memo == the intent's `memo`.
5. tx not already used (UNIQUE tx_hash; idempotent).
6. tx timestamp within `[created_at, expires_at + grace]`.

Implementation: `lib/payments.php :: pay_verify_onchain()` queries a TON indexer
(toncenter/tonapi) for incoming jetton transfers to the destination wallet, matches by memo,
and validates 1–6. **Client proof alone never confirms.** Until the indexer is configured the
function returns "unverified" and the admin manual-approve path remains.

USDT mirrors the same concept; chain not finalized → config placeholders only.

---

## 5. Config keys (settings — remote, no APK update)

| Key | Default | Notes |
|---|---|---|
| `real_token_address` | `EQDhq_Dj…` (the jetton above) | REAL jetton master |
| `real_destination_wallet` | `UQBWAwX1…` (existing) | where REAL is received |
| `real_decimals` | 9 | jetton decimals |
| `real_discount_percent` | 20 | default/display discount |
| `usdt_chain` | `ton` | placeholder |
| `usdt_token_address` | `EQCxE6mU…` (existing) | USDT jetton master |
| `usdt_destination_wallet` | `UQBWAwX1…` | where USDT is received |
| `usdt_decimals` | 6 | |
| `usdt_confirmations_required` | 1 | placeholder |
| `payment_window_secs` | 1800 (30 min) | intent validity |
| `ton_indexer_url` | `https://toncenter.com/api/v2` | verification source |
| `ton_indexer_key` | '' | API key (fill to enable auto-verify) |

---

## 6. Admin (Payments page)

Extend admin with a **Payments** page + `payments-admin` endpoints:
- edit packages (gb, usdt_price, real_price, discount, recommended, active, order)
- edit REAL discount, REAL token address, recipient wallets
- view payment intents (pending), confirmed, failed/expired
- revenue by REAL vs USDT; GB sold by method
- REAL discount cost/value (USDT-equivalent foregone vs REAL volume)

Reuses the Chart.js infra + `save-*-config` pattern.

---

## 7. Mobile (PREPARED — no build/rollout)

Redesigned Premium screen: title **"Upgrade with REAL"**, subtitle *"Pay with REAL and get
more data for less."* Two methods:
- **REAL — Recommended**: gold/royal styling, badges *"Best value"* + *"Ecosystem discount"*,
  shows REAL identity, copy: *"Native token of the SETAEI / Shahnameh / Realink ecosystem."*
- **USDT — Standard**: normal price, no discount.
Flow: pick package+method → `payments/intent` → open Tonkeeper/TON Connect with the returned
wallet/amount/memo → pending screen → "Check payment" (`payments/status`) → success (quota
added, server-confirmed) or expired/retry. Packages + prices come from the server, never hardcoded.

---

## 8. Tests (`scripts/test-payments.php`)

1. REAL package price < USDT price (discount holds)
2. payment intent creation (fields, memo, expiry)
3. expired payment → status `expired`, no grant
4. duplicate tx_hash cannot double-grant
5. wrong token address rejected
6. wrong amount rejected
7. confirmed REAL payment grants correct GB (ledger `purchase_real`)
8. confirmed USDT payment grants correct GB (ledger `purchase_usdt`)

---

## 9. Expert recommendations (REAL-first premium)

- **Anchor on price-per-GB, not token.** Show "$/GB" so REAL's discount is obvious without
  crypto jargon. Lead with value, not the token mechanic.
- **Dynamic discount, conservative default.** Keep `real_discount_percent` server-tunable;
  start at 20%, A/B toward 25–30% only if REAL volume needs a push. Track discount cost/value
  on the admin page so the subsidy is always visible.
- **Memo-based matching > tx_hash trust.** A unique per-intent memo is the robust key; treat
  any client tx_hash as a hint only. Poll the wallet, don't believe the app.
- **Quote REAL in USDT-equivalent** at intent time (snapshot `amount`/`amount_units`) so a
  volatile REAL price never under/over-charges mid-flow; intent expiry bounds the risk window.
- **Grace + partial-payment handling.** Accept amount ≥ due (tip-friendly); for underpayment,
  keep `pending` and surface the shortfall rather than rejecting outright.
- **Compliance phrasing presets** stored server-side so marketing copy can't drift into
  investment language.
- **Scaling:** verification is the bottleneck. 100–1k users: on-demand poll on "Check payment"
  is fine. 10k: add a small cron that reconciles pending intents against wallet history + cache
  indexer responses; consider a dedicated TON indexer key / self-hosted indexer.

---

## 10. Rollback / safety

- Feature is additive (new tables, new `/v1/payments/*`, new ledger types). Legacy
  `payment_queue` + manual approve untouched.
- Kill switch: `is_active=0` on packages hides them; clearing `ton_indexer_key` disables
  auto-verify (manual approve still works). No OTA/version/update interaction.
