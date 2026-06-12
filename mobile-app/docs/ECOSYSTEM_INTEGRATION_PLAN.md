# SetaLink Ecosystem Integration Plan

Status: **planning only — no code yet** · Date: 2026-06-10
Scope: REAL token rewards, Shahnameh promotion, TrustAI referrals.

## Context

SetaLink VPN is one product in a wider ecosystem:

- **REAL** — the ecosystem token.
- **Shahnameh** — companion app where users earn REAL.
- **TrustAI** — referral/trust layer.

The integration goal: VPN quota becomes a sink for REAL, Shahnameh becomes a
source of REAL, and referrals bridge both.

---

## A) REAL token rewards

### Flow

```
Shahnameh activity ──► REAL balance (ecosystem backend)
                            │
                            ▼  redeem
                    SetaLink quota top-up
```

### Backend (panel, `admin/api.php` + SQLite)

1. **Account linking.** Devices today are anonymous (`device_id`,
   optional `user_id`). Add a `linked_real_account` column on `devices`
   plus a `link-real-account` mobile endpoint: app opens Shahnameh /
   wallet deep link, receives a signed proof (account id + signature),
   posts it to the panel.
2. **Redemption ledger.** New table `real_redemptions(id, device_id,
   real_account, real_amount, quota_bytes, tx_ref, status, created_at)`.
   Never mutate quota without a ledger row — quota inflation bugs from the
   2026-06-10 audit showed why double-entry matters here.
3. **Rate config.** `settings` keys: `real_per_gb`, `redeem_min_real`,
   `redeem_daily_cap_bytes`. Editable from the admin Config page.
4. **Redemption endpoint.** `mobile=1&action=redeem-real`: verify the REAL
   spend against the ecosystem backend (server-to-server, not client
   claims), then `UPDATE devices SET quota_bytes_total += ?` + ledger row.
   Idempotency key = `tx_ref` so a retried request can't credit twice.

### Mobile app

- Wallet card on Profile screen: REAL balance, "Redeem for data" button.
- Redeem sheet: slider (1 GB steps), shows REAL cost, confirm → calls
  redeem endpoint → quota refresh via existing entitlement sync.

### Open decisions

- Custody: does the panel hold a REAL hot wallet, or does the ecosystem
  backend settle internally? (Recommend: internal settlement first, no
  on-chain ops inside the VPN panel.)
- Abuse: cap redemptions/day/device; reuse referral risk_score machinery.

### Phasing

| Phase | Deliverable |
|---|---|
| 1 | settings keys + ledger table + admin view (read-only) |
| 2 | account linking + redeem endpoint (server-verified) |
| 3 | mobile wallet UI + redeem sheet |

---

## B) Shahnameh promotion

1. **Ecosystem banner** on Home screen (below the connect button, above
   stats): "Earn REAL with Shahnameh → redeem for free data". Dismissible,
   reappears every 14 days, deep-links to the store listing / app.
2. **Ecosystem section** in Profile: three cards (SetaLink · Shahnameh ·
   TrustAI) with one-line value props and the REAL logo as the visual
   anchor connecting them.
3. **Remote-config driven.** Banner copy, target URL, and visibility come
   from the existing `get-remote-config` endpoint so campaigns don't need
   app releases. Add keys: `ecosystem_banner_enabled`, `_title_fa/_en`,
   `_url`.
4. **Server side**: serve banner config + click telemetry (`app-analytics`
   event `ecosystem_banner_click`) so adoption is measurable in the new
   dashboard.

---

## C) TrustAI referrals

Current state (v0.9.16+): referral code = userId suffix, +1 GB reward,
`referral_uses` table with risk scoring.

1. **Keep quota rewards as the base layer** — they work offline-first and
   are already fraud-checked.
2. **TrustAI enrichment**: send referral events (referrer, invitee,
   device fingerprints, risk_flags) to TrustAI; consume back a trust
   score that replaces the local heuristic `risk_score` when available.
   Local scoring stays as fallback.
3. **Future REAL rewards**: once (A) ships, high-trust referrals can pay
   REAL instead of (or on top of) quota: `referral_reward_mode` setting =
   `quota | real | both`, applied at referral-confirmation time and
   recorded in the same `real_redemptions` ledger (negative = grant).
4. **Anti-abuse invariants** (carry over from the June audit): reward
   only on first VPN connect of the invitee (not registration), one
   reward per device fingerprint, flagged referrals require admin
   approval on the Referrals page.

---

## Dependencies & order

```
A1 (ledger) ──► A2 (redeem) ──► C3 (REAL referral rewards)
B (promotion) — independent, can ship first
C2 (TrustAI scoring) — independent of A
```

Recommended first release: **B + C2** (no token risk), then A behind a
remote-config flag.
