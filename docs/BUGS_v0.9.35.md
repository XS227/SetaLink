# v0.9.35 live regressions → diagnosis + v0.9.36 fixes

**Logged:** 2026-06-15. User tested v0.9.35/build 52 after OTA; confirmed on-device that the shipped bundle is v0.9.35 (extracted `index.android.bundle` contains `0.9.35`, `groupDmsByPeer`, `Delete chat`; not `0.9.34`). So these are real, not a stale-build artifact.

`tsc` clean · `jest` 147/147 · `php -l` clean. **Not published** — v0.9.36 APK is built for on-device verification before any rollout (per the user's instruction).

---

## #1 — DM bubble body blank — ROOT CAUSE FOUND (server), FIXED & LIVE
The thread UI was fine; the **server returned `body: ""`**. `dm_decrypt()` returned empty for every message.

**Exact cause:** `data/.message_key` was `-rw------- ubuntu:www-data` (0600, owner ubuntu) → the web user **www-data could not read it**, so `dm_key()` generated a *fresh ephemeral key on every request*. Messages were encrypted in one request and decrypted in another with different keys → all bodies lost.

**Evidence (exact API payload, no admin content):**
```
# before fix — list-messages over HTTP:
{ "id": 6, "direction": "in", "peer_user_id": "SL-227-…", "body": "", "read": false }
# after fix — sent "hello world test" then read back:
{ "ok": true, "data": { "messages": [ { "id": 7, "direction": "in", "body": "hello world test", "read": false } ] } }
```
**Fix:** `chmod 640` + group `www-data` on the key file (now `-rw-r-----`); cross-process decrypt as www-data verified. Hardened `dm_key()` to persist new keys 0640 (was 0600). **Server-side — live now, no APK needed.** The 6 old test messages stay blank (their ephemeral keys are unrecoverable).

## #2 — Send GB Continue disabled — ROOT CAUSE (client), FIXED in v0.9.36
**Exact disabled condition that shipped in v0.9.35:** `disabled={!canContinue}` where `canContinue = !!recipient && isFinite(amountNum) && amountNum > 0`. `recipient` is the **resolved object**, only set by pressing the separate ✓ verify button. A user who typed an ID + amount but didn't successfully resolve via ✓ saw a disabled button with **no explanation**. (`resolve-recipient` works live — verified.)

**Fix:** enable on **typed recipient + positive amount** (`transferFormReady()`), resolve the recipient **on Continue** (no separate ✓ needed), and show a visible reason when disabled ("Enter a recipient ID / amount to continue"). Test added: `transferFormReady('SL-227-8547F1F9','10') === true`.

## #3 — Biometric "unavailable" with biometric enabled — FIXED + DEBUG, v0.9.36
Can't read the device's status code from here, so v0.9.36 (a) adds the fix and (b) surfaces the raw codes for confirmation.
- **Fix:** availability + the unlock prompt now accept **DEVICE_CREDENTIAL** (PIN/pattern) as a fallback, in addition to STRONG/WEAK biometrics (version-safe: avoids the WEAK|DEVICE_CREDENTIAL crash pre-API30).
- **Debug readout:** `getStatusDetail()` returns the raw `canAuthenticate()` code per class + SDK; the "App Lock Unavailable" alert now appends `status=…, strong=…, weak=…, cred=…, sdk=…` so the exact device codes show in a screenshot.

## Push notifications (background) — added in v0.9.36
WorkManager periodic poll (`DmPollWorker`, ~15 min, `androidx.work`) calls `list-messages` and posts a title-only local notification for new DMs **even when the app is killed** — the "Phase 2" without FCM. Gated by the push-notifications setting (`setBackgroundPolling`). True instant push still needs a Firebase project (not available here).

## Admin nodes health panel — added
Dashboard → **🛰️ VPN Nodes** card renders `admin/api.php?action=node-health` (status/RTT/TLS/edge/checked per node, stale warning).
