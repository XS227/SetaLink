# Bug backlog — reported against live v0.9.34 → fixed in v0.9.35

**Logged & fixed:** 2026-06-15 · `tsc` clean · `jest` 142/142 · `php -l` clean. Server-side pieces already live; client/native ship in the v0.9.35 build.

## #1 — Send GB still broken (Continue disabled)
**Root cause (regression from v0.9.34):** the button was gated on the *full* validity (`amountValid`), which includes the `above_max` check against the **transferable** balance. When the entered amount exceeded transferable, the button went **silently disabled with no feedback**. (Transferable = total − starter − used, so the "105 GB" the user sees is total, not transferable.)
**Fix:** Continue is enabled for any positive parsed amount (Farsi digits already normalized); `handleContinue` surfaces the precise reason via toast, and `above_max` now shows the real max (`… (Max 97.80)`). `TransferScreen.tsx`.

## #2 — Inbox → Telegram-style threads
- `groupDmsByPeer()` (`utils/dmThreads.ts`) collapses the flat list to **one thread per peer** (keyed by peerDevice) — fixes "multiple rows for same user". Inbox shows latest message + unread count per peer.
- Tap peer → **chat thread modal**: full in/out conversation as bubbles, **reply inline**, marks all unread read on open. `InboxScreen.tsx`. Tests: `dmThreads.test.ts`, `inboxScreen.test.tsx`.

## #3 — Message / thread delete (soft, per-user)
- Backend (LIVE): `user_message_deletes` table + `dm_delete_message()` / `dm_delete_thread()` (`lib/messaging.php`), filtered out of `dm_list`/`dm_unread_count`. Per-user **soft-delete** — the other party and the encrypted body are untouched; admin never reads bodies.
- Endpoints `delete-message` / `delete-thread` (`public/api.php`) — verified live.
- UI: long-press a thread → delete chat; trash icon in thread header; long-press a bubble → delete message.

## #4 — Finland server
- The Helsinki node **is live** (`fi.setalink.no:443`) and `/v1` returns `fi-hel` with full Reality config **to allowlisted devices only** (test-only, per [[project_helsinki_node]]).
- **Fix:** the static "Coming soon" placeholder is hidden once a live server for that country exists (`ServersScreen.tsx`), so allowlisted devices see Finland active without the duplicate placeholder.
- **Decision needed (NOT shipped):** promoting Helsinki to **public routing for all users** requires ungating `fi-hel` in `public/v1.php` + confirming the node is production-hardened. Left gated.

## #5 — Biometric "unavailable" with fingerprint enrolled
**Root cause:** androidx.biometric **1.1.0** `canAuthenticate(STRONG or WEAK)` (combined) returns `BIOMETRIC_STATUS_UNKNOWN` on some Android 10 / OEM builds even when enrolled.
**Fix:** check STRONG and WEAK **separately** (`BiometricModule.kt` `bestStatus()`); new `getStatus()` returns a precise code; Settings shows the right message (enroll vs. no hardware). **Native — needs CI build to compile-verify.**

## #6 — Referral flow/admin
**Verified already working — no code change:**
- Onboarding: WelcomeScreen (first launch) has the "Have a friend's code?" Enter field; proceeding = skip. Deep-link/QR auto-claim via `claimPendingReferral()`.
- **Once-only** enforced server-side (`use-referral` → "referral already used").
- Admin shows inviter / new user / country / bonus / status (`admin/index.php`).
- "Only 2 referrals" is **accurate low usage** (live `referral_uses` = 2; 28 devices have their own code), not a tracking bug.
