# SetaLink Messaging MVP (v0.9.33)

Turns the existing **admin-announcement Inbox** into a user-to-user chat surface.
Users message each other using only a **SetaLink ID** (`user_id` like `SL-227-XXXXXXXX`,
or `device_id` / referral code). No phone number, email or IP is involved anywhere.

## Server

**`lib/messaging.php`** — shared helper (mirrors `lib/quota_economy.php`), `dm_*` prefix
(the `msg_*` prefix collides with PHP's built-in sysvmsg `msg_send()`).

Tables in `data/analytics.db`:
- `user_messages` — `id, sender_device, sender_user_id, recipient_device,
  recipient_user_id, body_enc, status (sent|read), created_at, read_at`
- `user_blocks`, `user_reports` — **created but unused**; structure ready for the
  block/report feature (the single chokepoint is `dm_is_blocked()`).

**At-rest encryption** — bodies stored via libsodium `secretbox` (`v1:`) with AES-256-GCM
fallback (`v2:`). Key: `data/.message_key` (32 bytes, `0600`, gitignored — `data/` is in
`.gitignore`). **Not E2E**: the server decrypts to deliver. True E2E would need per-device
keypairs — deferred. The admin path never decrypts.

**Endpoints** (`public/api.php`, token-gated like the rest):
| Action | Method | Notes |
|---|---|---|
| `send-message` | POST | `device_id, recipient, body`. Validates recipient exists (`qe_resolve_device`), rejects self/blocked, rate-limits, encrypts. |
| `list-messages` | GET | `device_id`. Returns decrypted thread (in+out) + `unread`. |
| `mark-message-read` | POST | `device_id, message_id`. Only the recipient can mark their own. |

**Validation / anti-spam** — recipient must exist; no self-send; body 1–2000 chars
(UTF-8 codepoints, mbstring-independent so Persian isn't over-counted); rate limit
**10/min and 300/day per sender device** (`MSG_MAX_PER_MIN` / `MSG_MAX_PER_DAY`).

**Admin** (`admin/api.php`, CSRF-protected) — `user-messages-stats`: total / delivered
(unread) / read / last-24h / sender & recipient counts + recent activity **metadata only**
(`dm_admin_stats()` never selects `body_enc`). UI wiring into `admin/index.php` is **not**
done yet — the endpoint is ready for a card to call.

## Mobile (React Native)

- `services/entitlementService.ts` — `sendMessage`, `listMessages`, `markMessageRead`, `DM_MAX_LEN`.
- `stores/dmStore.ts` — poll-based store (server is source of truth), unread count, toast on new.
- `screens/InboxScreen.tsx` — **Messages / Announcements** tabs, **＋ New message** compose
  modal (recipient ID + body + char counter), unread dots, tap-to-read.
- `navigation/AppNavigator.tsx` — DM poll added to the existing foreground inbox poll.
- i18n — `dm.*` keys (English + Persian).

## Verification
- `lib/messaging.php` unit-exercised on a throwaway DB (encryption-at-rest, validation, rate
  limit, mark-read, admin-stats-has-no-body).
- HTTP smoke test against real `api.php` (router pointing `DB_PATH` at a temp DB): send →
  decrypted delivery (emoji + Persian) → mark-read → unread=0; token gate, recipient-not-found,
  self-send all rejected correctly.
- Mobile: `tsc --noEmit` clean, jest 120/120 (incl. new `directMessages.test.ts`).

## Not done / deferred
- End-to-end encryption (needs device keypairs).
- Block / report UI + writes (schema ready).
- Admin panel UI card (endpoint ready).
- Real push (FCM) — delivery is poll-based, same as announcements.
- No version bump / Android build run.
