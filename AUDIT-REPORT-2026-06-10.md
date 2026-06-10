# SetaLink Production Audit — 2026-06-10

Scope: OTA update flow, quota/traffic accounting, admin dashboard, payment system, referral system, plus a UI/UX redesign proposal and ecosystem integration plan. Findings first; **no fixes applied except the two explicitly requested actions** (payment wallet replacement + payment flow test).

Severity legend: 🔴 critical (breaks a core flow) · 🟠 high · 🟡 medium · 🟢 low / informational.

---

## 1. OTA Update — why the app still reports v0.9.25 (35)

### Root cause 🔴
The app's version is read from **two independent sources that have drifted apart**:

| Source | File | Value |
|---|---|---|
| Native APK | `mobile-app/android/app/build.gradle` | versionCode **36**, versionName **0.9.26** ✅ |
| JS runtime `APP_VERSION` | `mobile-app/package.json` → `src/utils/version.ts` | **0.9.25** ❌ |
| JS runtime `APP_BUILD` | `src/utils/version.ts` (hardcoded) | **'35'** ❌ |

The release commit (`b8d548c`) bumped `build.gradle` but **never bumped `package.json`**, and `APP_BUILD` is a hardcoded string literal that the release script does not touch at all. I confirmed this by extracting the JS bundle from the shipped APK:

```
$ unzip -p setalink-v0.9.26.apk assets/index.android.bundle | grep -c '0.9.25'  → 1 (present)
```

`updateService.ts` computes `hasUpdate = compareVersions(targetVersion, APP_VERSION) > 0`, i.e. `0.9.26 > 0.9.25 = true`. So:
- The installed APK **is** genuinely 0.9.26 at the OS level (Android Settings would show 0.9.26 / 36).
- But every in-app screen that displays "current version" reads `APP_VERSION` = **0.9.25**, and the update checker therefore **always reports an update available** — even immediately after installing 0.9.26. This is a permanent false-positive update loop, not a download/install failure.

### Verified OK
- Symlinks: `public/download/setalink-latest.apk` and `public/releases/stable/setalink-latest.apk` both → `setalink-v0.9.26.apk`.
- `version.json` (live) serves 0.9.26 / versionCode 36 / correct sha256 / size 53382088.
- nginx serves APKs directly (no CDN cache layer to poison); download verified byte-identical end-to-end.

### Recommended fix
1. In `scripts/release.sh`, after the `npm version` call, the script *does* update `package.json` — but the v0.9.26 release was cut **without** running it (it was a manual symlink/version.json edit). Re-run the proper release pipeline, or:
2. **Bump `package.json` to 0.9.26** and **make `APP_BUILD` derive from `build.gradle` versionCode** instead of a hardcoded literal. Best: generate `version.ts` at build time from `build.gradle` so the three sources can never drift.
3. Add a CI check: fail the build if `package.json` version ≠ `build.gradle` versionName.

---

## 2. Quota / Traffic Accounting — the 3221.2 GB anomaly

### What the numbers actually are 🔴
The reported figures decode exactly to a **base-10 / base-2 unit confusion plus a single corrupt write**:

- Total "3221.2 GB" = **3,221,225,472,000 bytes** in the DB = exactly **3 GiB × 1000** = `3221225472 × 1000`.
- Used "2325.38 GB" = **2,325,381,970,568 bytes** = **2165.68 GiB**.
- App displays bytes ÷ `1e9` (decimal GB) on Profile, but the DB value itself is already inflated.

The device's actual logged traffic is tiny. Summing every `vpn_sessions` row for this device (`sl-85ff1772…`):

```
22 sessions, total bytes = 1,064,053,117  (0.99 GiB)
```

So real usage is ~1 GB, but `quota_bytes_used` shows 2,325 GB — a **~2,184× inflation**. The session table cannot have produced this via accumulation. The value `3,221,225,472,000` for total is a smoking gun: someone/something wrote `3 GiB` worth of bytes but **multiplied by 1000** (decimal-GB math applied to a byte count), then `quota_bytes_used` got similarly corrupted by repeated `+=` writes.

### Accounting design issues found
1. 🔴 **`report-usage` is a cumulative `+=`, but the app sends a cumulative total.** In `vpnStore.ts:174`:
   ```ts
   reportUsage(user.deviceId, useAuthStore.getState().user!.quotaBytesUsed)
   ```
   It passes the **running cumulative `quotaBytesUsed`**, but `public/api.php` `report-usage` (line 600) does `quota_bytes_used = quota_bytes_used + ?`. So each report **adds the entire lifetime total again** → runaway exponential-ish growth on every disconnect. This is the inflation mechanism. (Note `admin/api.php`'s `report-usage` at line 423 does `SET quota_bytes_used = ?` (absolute) — the two endpoints disagree on semantics.)
2. 🟠 **Double counting:** on disconnect the app calls *both* `report-usage` (adds cumulative) *and* `report-session` (`api.php:741` adds `bytes_sent+bytes_recv` again). Two writers increment the same counter for one session.
3. 🟡 **No reconnect/session-dedup key.** `report-session` has no idempotency token; a retried request double-books.
4. 🟡 **Unit inconsistency:** `formatBytes` (utils) uses 1024; Profile/Home screens use `/1e9`; admin uses `/1073741824`. Pick one (binary GiB) everywhere.

### Recommended fix
- Make `report-usage` semantics **absolute** in `public/api.php` (`SET quota_bytes_used = MIN(quota_bytes_total, ?)`) to match what the client sends and what `admin/api.php` already does — or change the client to send a per-session delta and keep `+=`. Do **one** of these, not both.
- Remove the double write: have disconnect call **either** `report-usage` **or** `report-session`-drives-quota, not both.
- Add a session idempotency key (`device_id`+`started_at`) with `INSERT OR IGNORE`.
- Standardize on GiB (1024³) across app + admin.
- **Data repair:** recompute `quota_bytes_used` for affected devices from `SUM(vpn_sessions.bytes_sent+bytes_recv)` and reset `quota_bytes_total` to its intended tier. (Not done — audit only.)

---

## 3. Admin Dashboard

### Findings
1. 🟠 **Stale "online" devices.** `status` is set to `online`/`offline` by client pings but **never expires server-side**. 7 of 9 real devices show `status=online` with `last_seen` 160–500 hours ago. The dashboard's online count and the green dot (`index.php:1400`) are therefore false. **Fix:** treat a device as online only if `last_seen >= now-'X minutes'` in the SQL/serializer, not the stored flag.
2. 🟡 **Diagnostics data is stale/sparse.** `test_results` holds 7 rows, all from 2026-05-18 — the protocol-success table renders month-old data with no "as of" warning. Probe buttons (protocol-health, nat-health) are live/on-demand and look correct.
3. 🟢 **Protocol-health probe** logic is sound: checks edge WS/XHTTP/HTTPUpgrade via curl with sensible accepted status codes, and checks Reality indirectly via the local SOCKS5 port (10808) to avoid "failed to read client hello" log spam — good design.
4. 🟢 **NAT diagnostics** correctly detect egress iface, ip_forward, and MASQUERADE with copy-paste fix hints; repair path is gated behind a confirm and the sudoers-whitelisted CLI wrapper.
5. 🟡 **`last_failure_category` never clears on success.** A device that failed once keeps showing the failure badge (`catBadge`) indefinitely until it fails differently. Consider clearing it when `internet_ok=1`.
6. 🟢 Refactor from the prior session (hoisting `catBadge`) is in place and `php -l` clean.

---

## 4. Payment System

### Actions completed (explicitly requested)
- ✅ **Wallet replaced** in `mobile-app/src/screens/UpgradeScreen.tsx`:
  `UQBWUvIAvNpzjAR4BB1kjQFHXCLA1bSRPb_7B-ZMcRy65nIJ` → **`UQBWAwX1khMYZm3RobKKOm3460I6vLCA1c0wgb_68zdfBj5g`** (committed). Feeds both the Tonkeeper deep link and web-transfer link.
- ✅ **Payment flow tested end-to-end** against live API: register → submit-payment (10GB) → admin approve → entitlement verified (plan=premium, 10 GiB, valid 30 days). Test data cleaned up afterward.

### Findings
1. 🔴 **Package catalog mismatch — 2 of 3 in-app packages cannot be purchased.** The app sells `10GB / 20GB / 30GB` (`UpgradeScreen.tsx:26-28`), but the backend `VALID_PKGS` = `['7days','30days','unlimited','5GB','10GB','15GB']`. Submitting **20GB** or **30GB** returns `{"ok":false,"error":"invalid package"}` (verified live). Only the 10GB button works. **Fix:** reconcile the two lists — add `20GB`/`30GB` to `VALID_PKGS` and `pkg_map` (with byte amounts + price), or change the app's package keys.
2. 🟡 **No on-chain verification.** `submit-payment` records a user-claimed `tx_hash`/amount with no TON chain check; approval is fully manual in admin. Acceptable for now but flag for the ecosystem phase (auto-credit via chain watcher).
3. 🟢 Approval crediting math is correct and resets `quota_bytes_used=0` + sets `valid_until` properly.

---

## 5. Referral System

### Root cause 🔴 — every code shared from the app is rejected
The app **shares the wrong code**. Two distinct identifiers exist per device:

| Field | Generator | Example |
|---|---|---|
| `referral_code` | `generate_referral_code` → 7 hex chars | `4D2CA28` |
| `user_id` | `generate_user_id` → `SL-227-` + 8 hex | `SL-227-62DAC5F0` |

`ProfileScreen.tsx:139` derives the shared/displayed code as the **8-char user_id suffix** (`62DAC5F0`) and builds the invite link `https://setalink.no/?ref=62DAC5F0`. But the backend `use-referral` (`api.php:505`) looks up `WHERE referral_code = ?` — the **7-char** column. The two never match. Proven live against a real device:

```
code app would share (62DAC5F0):  {"ok":false,"error":"invalid referral code"}
code backend stores  (4D2CA28):   {"ok":true, bonus_bytes:1073741824, ...}
```

So **no referral entered through the app UI can ever credit** — the entire referral growth loop is dead.

### What works (when the correct code is used)
- ✅ Both sides credited +1 GiB (`new_total_bytes` correct).
- ✅ Double-use blocked ("referral already used").
- ✅ Self-use blocked ("cannot use own referral code").
- ✅ Fraud scoring fires: `same_ip` +50, `rapid_signup` +30, `same_device` (android_id_hash) +80; ≥75 → `flagged` status (credited but marked). Recorded in `referral_uses.risk_score/risk_flags`.
- ✅ Landing page (`public/index.php`) captures `?ref=` / `?start=` and threads it into the APK download link.

### Recommended fix
Make the app share the **real `referral_code`** (already returned by `register-device`/`sync-entitlement` as `referral_code`), not the user_id suffix. I.e. in `ProfileScreen.tsx`, set `referralDisplayCode = user.referralCode`. Alternatively, make the backend accept **either** the referral_code **or** a user_id suffix in `use-referral` (look up by both columns). The first is simpler and removes the ambiguity.

Note 🟡: fraud `same_ip` will false-positive heavily because all traffic arrives via the edge/CF proxy — confirm `client_ip()` is reading the real client IP (`CF-Connecting-IP`/`X-Forwarded-For` are honored, but nginx must pass them; the landing vhost should set `proxy_set_header CF-Connecting-IP`).

---

## 6. UI/UX Redesign Proposal (proposal only — not built)

Current navigation: 5-tab bottom bar (Home · Servers · AI · Activity · Profile) + Splash/Onboarding/Auth/Welcome. Logo assets already exist: `logo_mark.png`, `logo_connected.png`, `logo_disconnected.png`.

### Design direction: "Calm shield" — minimalist, logo-forward, gold connected state

**Branding & logo**
- Promote the REAL logo to a **primary hero element**, ~2× current size, **horizontally centered** on Splash, Auth/Login, Home (idle), and Connected.
- **State-driven logo swap:** `logo_disconnected.png` (muted) when idle → `logo_connected.png` rendered in **gold (#FFB800 / REAL gold)** when the tunnel is up, with a soft gold glow ring around the connect button. This makes "connected" unmistakable at a glance and ties the connected state to REAL branding.
- Splash: centered logo on solid dark canvas, single subtle fade-in; no text clutter.

**Navigation simplification (5 → 3 tabs)**
- Collapse to **Home · Activity · Profile**. Move **Servers** into a sheet opened from the Home connect card (server picker is contextual to connecting, not a top-level destination). Fold **AI/Smart** into Home as a one-tap "Auto-optimize" toggle rather than a separate tab.
- Net effect: fewer tabs, the primary action (connect) dominates Home.

**Home (the 90% screen)**
- Large centered logo + a single large circular **Connect** button (the hero). Below it: current server chip (tap → server sheet), live throughput, and a compact quota ring.
- Idle = neutral/grey; Connecting = pulsing; **Connected = gold logo + gold ring + "Protected" label**.

**Onboarding (easier)**
- 3 cards max: (1) what SetaLink is, (2) you get 1 GB free + earn more via invites/REAL, (3) one-tap connect. Skippable. Auto-register silently in the background (already implemented) so the first screen after onboarding is a working Home with a live free quota.

**Modern VPN UX touches**
- Connect button shows elapsed session time + live ↑/↓ inline (no separate stats screen needed for the basics).
- Quota presented as a ring with "X GB left," tappable → earn-more (referral) and buy-more (Upgrade).
- Honest update banner only when a *real* update exists (after fixing §1).

*(Mockup is descriptive; no code changed. Ready to turn into a component spec on approval.)*

---

## 7. Ecosystem Integration Plan (architecture only — do not build)

Products: **SetaLink** (VPN), **Shahnameh** (content/engagement app), **REAL** (token/credit), **TrustAI** (AI services), **3REAL Exchange** (token ↔ fiat/crypto on/off-ramp).

### Core idea: REAL is the shared credit unit
REAL is **earned** through engagement and **spent** on services (starting with VPN quota). One ledger, many apps.

```
        EARN REAL                         SPEND REAL
  ┌────────────────────┐           ┌──────────────────────┐
  │ Referrals (SetaLink)│          │ VPN quota (SetaLink)  │
  │ Shahnameh activity  │  ──REAL──▶│ TrustAI credits      │
  │ 3REAL on-ramp (buy) │           │ Premium features     │
  └─────────┬───────────┘          └──────────┬───────────┘
            │                                  │
            ▼                                  ▼
   ┌─────────────────────────────────────────────────────┐
   │           REAL Ledger Service (single source)         │
   │  balances · signed transactions · idempotency keys    │
   └───────────────────────┬───────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  │ 3REAL Exchange     │  (TON-based; on/off-ramp,
                  │ on-chain settlement│   matches existing Tonkeeper flow)
                  └────────────────────┘
```

### Architecture
1. **REAL Ledger Service** (new, central): authoritative balances + an append-only, idempotent transaction log. Every credit/debit carries a source app, reason, and dedup key. This is the one component all apps integrate with. Build this first.
2. **Identity:** the existing `user_id` (`SL-227-XXXXXXXX`) becomes the cross-app account key. Shahnameh/TrustAI authenticate the same identity (shared auth/SSO).
3. **Earn adapters:**
   - SetaLink referrals → emit `+N REAL` to the ledger (replaces today's direct `quota_bytes_total += 1GB`; quota becomes a *purchase* of REAL).
   - Shahnameh → emits REAL for defined engagement events (reading, streaks, contributions) with strict server-side rate limits + anti-fraud (reuse the referral risk-scoring pattern).
4. **Spend adapter (VPN quota):** a `redeem-real-for-quota` endpoint: debits REAL, credits `quota_bytes_total`. Define a **fixed REAL→GB rate** in settings (admin-editable), e.g. 100 REAL = 1 GB.
5. **3REAL Exchange:** TON-settled on/off-ramp; reuses the existing USDT-on-TON payment rail (Tonkeeper deep links already in the app). Buying REAL with USDT and redeeming for quota replaces the current per-package purchase, unifying payments.
6. **TrustAI:** spends REAL for AI credits; can also *power* features inside SetaLink (the existing "AI optimizer" / Smart screen) and Shahnameh.

### Earn-from-referrals/Shahnameh → buy-VPN flow (concrete)
```
User invites a friend (SetaLink)            ──▶ +50 REAL  (ledger)
User reads N chapters in Shahnameh          ──▶ +10 REAL  (ledger, rate-limited)
User buys REAL on 3REAL with USDT (TON)     ──▶ +1000 REAL (on-chain settled)
                                                   │
User taps "Get more data" in SetaLink       ──▶ redeem 100 REAL → +1 GB quota
```

### Migration & sequencing (no build yet)
1. Stand up the REAL Ledger Service + cross-app identity (SSO on `user_id`).
2. Re-platform SetaLink referral rewards to mint REAL (fixes §5 at the same time — share the correct code, credit REAL not bytes).
3. Add `redeem-real-for-quota`; keep the existing GB packages working in parallel during transition.
4. Integrate 3REAL on/off-ramp (extends current TON/Tonkeeper rail).
5. Onboard Shahnameh + TrustAI as earn/spend adapters.

**Hard requirements before any of this ships:** idempotent ledger writes (the §2 double-count bug must not be repeatable with money-like credits), server-authoritative balances (never trust client-sent totals — the §2 root cause), and anti-fraud on every earn path.

---

## Priority fix list (recommended order)

| # | Severity | Issue | Fix location |
|---|---|---|---|
| 1 | 🔴 | Referral codes shared by app never match backend | `ProfileScreen.tsx:139` — share `user.referralCode` |
| 2 | 🔴 | Quota inflation: `report-usage` double-`+=` of cumulative total | `public/api.php:600` semantics + `vpnStore.ts:174` |
| 3 | 🔴 | 20GB/30GB packages unpurchasable | `admin/api.php` `VALID_PKGS`/`pkg_map` |
| 4 | 🔴 | OTA false-positive loop: `package.json`/`APP_BUILD` not bumped | `package.json` + `version.ts` build-time gen |
| 5 | 🟠 | Stale "online" devices in admin | online = `last_seen >= now-Xm` |
| 6 | 🟡 | Double-count via report-usage + report-session both writing quota | pick one writer |
| 7 | 🟡 | Unit inconsistency (1024 vs 1e9) | standardize on GiB |
| 8 | 🟡 | Data repair: recompute inflated `quota_bytes_used` from sessions | one-off migration |

**Nothing in this list has been applied** except the two requested payment actions (wallet swap + flow test). Awaiting your go-ahead on which fixes to implement.
