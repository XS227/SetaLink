# Bug backlog — reported against v0.9.33

**Logged:** 2026-06-15 · **Status:** ✅ all three FIXED in source 2026-06-15, folded into the v0.9.34 build. tsc + jest green (133 tests). Not yet built/shipped.

BUG-1 and BUG-2 both touch the Inbox/messaging surface (`mobile-app` Inbox screen, `lib/messaging.php`, `lib/quota_economy.php`) and will probably share a fix pass. BUG-3 is isolated to the Diagnostics screen + a new export service.

## Fix summary (2026-06-15)
- **BUG-1:** `InboxScreen.tsx` — tapping a DM row now opens a **message-detail modal** (full body, sender ID, mark-read on open of received only, Reply prefilled with sender). Distinct from `+ New message`. Sender ID forced LTR for RTL UI. Test: `inboxScreen.test.tsx`.
- **BUG-2:** root cause = Farsi/Arabic keypad digits (`۱۰`) → `parseFloat` NaN → Continue dead. Added `normalizeDigits()` in `quotaEconomy.ts` (used by `validateTransferAmount` + live on the amount input); Continue now reflects real validity. Server `transfer-quota` now pushes Inbox notifications to **both** parties via `push_device_message()` (`public/api.php`). History already covered both sides. Tests: `quotaEconomy.test.ts`.
- **BUG-3:** Issue 1 — `diagnosticsStore.ts` now infers DNS **Healthy** from a confirmed internet probe when no explicit DNS log line exists (kills the false "DNS check pending… / Degraded"); same inference in the Tunnel-Layer row. Issue 2 — Export button wired to `handleExport` → `buildDiagnosticsReport()` (`diagnosticsExport.ts`) with Share-sheet + copy-to-clipboard. Tests: `diagnosticsExport.test.ts`.

---

## BUG-4 — Admin country flag is stale (first-seen forever)
**Severity:** medium · **Status:** ✅ FIXED 2026-06-15 (PHP only — no rebuild needed; lands on next telemetry check-in).

**Root cause:** `touch_ip_geo()` (`public/api.php`) and `touch_device_ip()` (`admin/api.php`) only wrote `country` when it was **empty** (`CASE WHEN country=''…`), so the first-seen country stuck forever.

**Fix:** both now re-geo and **overwrite** `country`/`country_name` whenever the public IP changes (latest-wins); new `first_country` column preserves the original, `country_updated_at` records the change. Geo failure keeps the old country (never blanks). Admin list shows the latest flag or **"Unknown"**; device detail shows flag · "updated <rel>" · first-seen. `countryFlag()` already maps IR / "Iran" / "Islamic Republic of Iran" → 🇮🇷 (verified). Stale users self-correct on their next non-tunneled check-in; the admin "🌍 Fix flags" backfill still covers empties.

## BUG-5 — Direct-message push notifications
**Severity:** feature · **Status:** ⏳ Step 1 (local notifications) implemented 2026-06-15; **native needs the CI build to verify**. FCM = Phase 2.

No FCM/background-fetch in the app. Implemented **option B** (local notification on DM poll), build-safe pieces fully tested:
- **Native (Kotlin, old-arch — no codegen risk):** `NotificationHelper.showMessage()` + a new **"SetaLink Messages"** channel (IMPORTANCE_HIGH, lock-screen PRIVATE). New `DmNotificationModule`/`DmNotificationPackage`, registered in `MainApplication`. Tap → opens app with `setalink_route=inbox` extra.
- **JS:** `dmNotifications.ts` (graceful no-op if native absent) — title-only "New message from SL-…" (never the body), deduped by message id, gated by the existing `pushNotifications` setting. Wired into `dmStore.refresh`; `ensureNotificationPermission()` (POST_NOTIFICATIONS, Android 13+) + tap-routing to Inbox in `AppNavigator`. Test: `dmNotifications.test.ts`.
- **Privacy:** body never enters the notification payload; admin still cannot read message content; messages stay encrypted at rest.
- **Phase 2 (not done):** FCM + per-device push token + WorkManager poll for delivery when the app process is fully killed. This step covers foreground + backgrounded-but-alive.

---

## BUG-1 — Inbox: tapping a message opens compose, not detail
**Severity:** high (received DMs are unreadable)

**Repro:** User receives a DM from `SL-227-62DAC5F0`; it appears in the Inbox list. Tapping the message row opens the **"New message" compose modal** (asking for a recipient SetaLink ID) instead of the message.

**Likely root cause:** the inbox row `onPress` is wired to the same handler as the `+ New Message` button; no message-detail view exists.

**Expected:**
- Tap existing message row → open message detail / conversation view.
- Show decrypted message body.
- Mark message as read (on open of a received message only).
- Allow reply to sender, prefilled with sender ID.

**Fix tasks:**
- [ ] Separate the `+ New Message` action from tapping inbox items.
- [ ] Add/open a message-detail modal or conversation screen for existing messages.
- [ ] Ensure `list-messages` returns enough fields for body preview + detail.
- [ ] Call `mark-message-read` **only** when opening a received message.
- [ ] RTL/Farsi: keep sender ID and message content readable.
- [ ] Regression test: tapping a received message opens detail, **not** compose.

**Constraints:** Do not change backend encryption unless necessary. Do not expose message body in admin.

---

## BUG-2 — Send GB: Continue/Send button inert despite valid input
**Severity:** high (transfers cannot be completed)

**Repro:** "Send Gigabytes" screen. Sender has 106.12 GB available; recipient `SL-227-8547F1F9` entered and validated ✅; amount 10 GB entered. Continue button remains inactive / does nothing.

**Expected flow:**
1. Valid recipient + valid amount → Continue becomes active.
2. Tap Continue → confirm → execute GB transfer.
3. Sender and receiver balances update.
4. Receiver Inbox notification: "User SL-227-62DAC5F0 sent you 10 GB".
5. Sender confirmation message: "You sent 10 GB to SL-227-8547F1F9".
6. Transfer-history entry added for both users.

**Investigate:**
- [ ] Amount parsing under RTL/Farsi keyboard (Persian digits → ASCII), numeric input type / string conversion.
- [ ] Button `disabled` condition vs. validated-recipient state.
- [ ] min/max amount logic.
- [ ] Whether Start Pack GB is excluded from transferable balance.
- [ ] API response/errors not surfaced to user.

**Fix tasks:**
- [ ] Make Continue active when recipient + amount are valid.
- [ ] Wire GB-transfer success into the Inbox/Announcements system (readable notification for both parties).
- [ ] Add transfer-history entries for both users.
- [ ] Surface API errors visibly.

**Regression tests:**
- [ ] valid recipient + amount enables Continue.
- [ ] transfer success creates inbox notification for receiver.
- [ ] invalid amount keeps button disabled.
- [ ] API error shows a visible error message.

---

## BUG-3 — Diagnostics: false "DNS Degraded" + dead Export button
**Severity:** medium

### Issue 1 — DNS Resolution falsely shows Degraded
**Observed:** TLS Certificate, CDN Edge, SNI Consistency, Domain Health all Healthy; Internet test succeeds; Exit IP detected; HTTP 200 received through VPN. Yet DNS Resolution = Degraded / "DNS check pending…".

**Expected:** If hostname resolution succeeds and Internet Test passes, DNS Resolution should become Healthy.

**Investigate:**
- [ ] DNS health-check timeout.
- [ ] async state never updating from "pending".
- [ ] DNS test result not propagated to UI.
- [ ] mismatch between DNS routing test and Internet test.

**Potential false-positive condition:** Internet works but DNS status remains degraded.

### Issue 2 — Export Diagnostic Report button does nothing
**Observed:** Tap "Export Diagnostic Report" → no action.

**Expected:** Generate and export/share a diagnostic report containing: app version, device ID, Android version, tunnel status, exit IP, DNS status, health checks, route trace, protocol status, timestamp. Export options: share sheet / save file / copy to clipboard.

**Verify:**
- [ ] `onPress` handler connected.
- [ ] export service implemented.
- [ ] permission handling.
- [ ] file generation path.
- [ ] share intent launch.

**Regression test:**
- [ ] Press Export Diagnostic Report → report generated successfully.
