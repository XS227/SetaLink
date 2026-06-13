# v0.9.31 — Quota Economy & Social Sharing — Migration Notes

Full-stack implementation of the server-side quota ledger, GB transfers, referral
milestones, package foundation, marketplace prep, and Persian localization.

> **Not built / not released.** Per instructions, `release.sh` was NOT run and no
> APK was built. App version remains 0.9.30 (versionCode 43). Bump + build is a
> separate step the maintainer runs.

---

## 1. Database migrations

New shared library: **`lib/quota_economy.php`** (included by both `public/api.php`
and `admin/api.php`). It creates and owns these tables (idempotent, created lazily
on first DB open via `qe_init_tables()`):

| Table | Purpose |
|---|---|
| `quota_transactions` | The ledger. `id, device_id, type, bytes (signed), created_at, metadata`. |
| `quota_transfer` | GB transfers. `id, sender_device, receiver_device, bytes, status, created_at, metadata`. |
| `purchased_packages` | `id, device_id, package_name, bytes, purchase_date, payment_reference, created_at`. |
| `milestone_claims` | One row per granted milestone (idempotency). `device_id, milestone, bytes, claimed_at`. |
| `devices.ledger_backfilled` | New column flagging a device whose ledger has been reconstructed. |

**Transaction types:** `starter_bonus`, `referral_reward`, `referral_level2`,
`purchase`, `transfer_in`, `transfer_out` (negative), `admin_adjustment` (signed),
`promotion` (milestone/campaign).

### Core invariant
For every backfilled device: `devices.quota_bytes_total == SUM(quota_transactions.bytes)`.
`quota_bytes_total` stays the single number the VPN quota enforcement
(`check-quotas.sh`) reads — the ledger is just the breakdown behind it.

### Run the migration
```bash
php scripts/migrate-quota-economy.php           # uses data/analytics.db
php scripts/migrate-quota-economy.php /path/db   # explicit path
```
Idempotent (skips already-backfilled devices). Verified on a copy of the live DB:
25/25 devices backfilled, 0 errors, 0 invariant mismatches.

### Backfill strategy (legacy devices)
- `starter_bonus = min(1 GiB, total)` (non-transferable)
- `referral_reward` = capped sum of approved `referral_uses.bonus_bytes` (either side)
- `admin_adjustment` = remainder so the ledger sums exactly to the historical total
- Already-reached milestones are recorded as **claimed with `bytes = 0`** — i.e.
  **no retroactive milestone quota is granted** to existing users (avoids a one-time
  inflation). New milestone rewards only apply to milestones crossed after launch.

---

## 2. API endpoints (`public/api.php`, mobile)

| Method | Action | Notes |
|---|---|---|
| GET | `quota-summary` | `{quota, milestones, packages}` — breakdown + progress + packages. |
| GET | `get-packages` | Purchased packages list. |
| GET | `get-transfers` | Transfer history (sent + received, newest first). |
| GET | `resolve-recipient` | Resolve `recipient` (device_id / user_id / referral_code) before sending. |
| POST | `transfer-quota` | `device_id, recipient, bytes` — atomic, audited transfer. |
| GET | `sync-entitlement` | Now also returns `quota`, `milestones`, `packages` and lazily grants milestones. |

`quota.transferable_quota = max(0, min(remaining, total - starter))` — **starter is
never transferable**, and you can't send data already used.

Transfer rules enforced server-side (`qe_transfer`): min 100 MB, max = transferable,
no self-transfer, blocked devices rejected, **anti-fraud daily caps** (10 transfers/day,
50 GiB/day per sender). Each transfer writes two ledger rows + one `quota_transfer`
row inside a single SQLite transaction (rolls back on any failure).

`use-referral` now credits both parties through the ledger (`referral_reward`) and
evaluates the referrer's milestones.

---

## 3. Admin support (`admin/api.php`)

| Method | Action | Notes |
|---|---|---|
| POST | `credit-package` | Manually credit a data package (`device_id, package_name, bytes, payment_reference`). Additive. |
| POST | `transfer-reverse` | Claw back a completed transfer (best-effort, clamped to receiver balance). |
| POST | `transfer-flag` | Flag a transfer for review (no quota movement). |
| GET | `quota-transfers` | Recent transfers + `same_ip` anti-fraud signal. |
| GET | `device-ledger` | Per-device breakdown + ledger + packages + transfers. |

- `payment-approve`: data SKUs (10/20/30 GB) now credit **additively** via the ledger
  and record a purchased package; time-based subscriptions keep the replace-quota +
  premium-plan behaviour but call `qe_reconcile()` so the invariant holds.
- `device-set-quota`: calls `qe_reconcile()` after the direct write.

> No admin **UI** was added for transfers/ledger (P5 = "backend foundation only").
> The endpoints are ready for a future admin panel section.

---

## 4. Mobile integration

- **`services/entitlementService.ts`** — new types (`QuotaSummary`, `MilestoneProgress`,
  `PurchasedPackage`, `TransferRecipient`, `TransferResult`, `TransferRecord`) and
  functions (`getQuotaSummary`, `getPackages`, `getTransfers`, `resolveRecipient`,
  `transferQuota`). `MIN_TRANSFER_BYTES = 100 MiB`.
- **`stores/authStore.ts`** — `AuthUser` gains `quota`, `milestones`, `packages`;
  new `applyQuotaSummary()` action for snappy post-transfer updates.
- **`screens/TransferScreen.tsx`** (new) — Send GB flow: Device-ID/User-ID entry,
  recipient verification, amount with Max, **confirmation (review) step**, success,
  "my receive code" QR (generated), and transfer history. Routed as `Transfer` stack
  screen; entry card added to ProfileScreen.
- **`screens/ProfileScreen.tsx`** — all package/quota/milestone cards now read the
  **server ledger** (`user.quota` / `user.milestones` / `user.packages`); 7-step
  milestone ladder (3·5·8·13·21·34·55); purchased packages listed separately;
  transferable balance shown.
- **`utils/quotaEconomy.ts`** (new) — pure `computeTransferable()` /
  `validateTransferAmount()` helpers (unit-tested).
- **i18n** — `tr.*` (transfer screen), new `pr.*` keys (sendGb, transferable,
  msBonus13, msElite, plan labels, share message). EN + FA parity verified (359/359).

### QR scanning caveat
QR **generation** (receiver shows their code) works now via the existing
`react-native-qrcode-svg`. Live **camera scanning** requires a native scanner
dependency this build does not bundle; the "Scan QR" button shows a localized
"enter ID manually" message. Wiring an actual scanner needs a dependency + native
rebuild (out of scope here — no APK build).

---

## 5. Tests

- **`scripts/test-quota-economy.php`** — 46 assertions: backfill + invariant,
  ledger writes, transfers (min/max/self/starter-not-transferable/atomicity),
  milestones (grant/idempotent/no-retroactive/pending-excluded), packages,
  recipient resolution. `php scripts/test-quota-economy.php` → 46/46.
- **`src/__tests__/quotaEconomy.test.ts`** — 13 Jest tests for the client helpers.
- Existing: `scripts/test-bugfixes.php` (21), Jest suite now 115 tests total.

All green: `tsc --noEmit` clean, `jest` 115/115, `php -l` clean, PHP suites pass.

---

## 6. Design decisions worth knowing

- **Milestone reward amounts** (Fibonacci GiB): 3→1, 5→2, 8→3, 13→5, 21→8, 34→13,
  55→21. Each also unlocks stealth + a cosmetic badge slug. Reserved room for future
  rewards is implicit in the per-milestone metadata.
- **Only approved referrals count** for milestones (`status IN ('credited','approved')`);
  pending/rejected never count (verified by test).
- **Usage depletes the transferable balance** (remaining caps transferable) so a user
  can never send data they've already consumed.
- The ledger is **append-only**; corrections are new signed rows, never edits.
