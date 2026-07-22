# Chat media (images/files + voice messages) — architecture only, not started

**Status: design, no code.** Khabat's 2026-07-22 priority list asked for this
specifically "without implementation yet" — same sequencing Agent A already
proposed when the chat pass shipped (`docs/realgram/TASK_SPLIT.md`,
2026-07-22: "Not building the image/file-attachment or voice-message parts of
the chat ask yet — those need a new native dependency each ... which Khabat
explicitly asked to sequence as a separate, isolated pass after this one
ships and is confirmed stable"). This document is that separate pass's plan,
written so whoever picks up implementation — Agent A, a fresh session, or a
human — doesn't have to re-derive the shape from scratch.

Existing text-DM system this extends: `lib/messaging.php` (schema, encrypt-
at-rest, rate limits, disappearing messages) + `public/api.php` (`send-
message`/`list-messages`/etc.) + `mobile-app/src/services/entitlementService.ts`
+ `mobile-app/src/stores/dmStore.ts` + `mobile-app/src/screens/InboxScreen.tsx`.
Read those first — this doc assumes familiarity with `user_messages`'
shape and the SetaLink-ID addressing convention (device_id | user_id |
referral_code, never phone/email/IP).

---

## 1. Scope

Two message kinds, one storage mechanism:
- **File attachment** — image (photo library or camera) or a generic document
  (per Khabat's "arkitektur for filer", broader than just images).
- **Voice message** — a recorded audio clip, sent like a normal message.

Both are a NEW message *kind* on the existing `user_messages` row, not a
parallel table — a media message is still a message: same thread, same read/
unread, same disappearing-timer, same soft-delete, same rate-limit family.
Only the body differs: instead of (or alongside) encrypted text, it carries
a reference to a stored file.

## 2. Storage: where the bytes actually live

**Filesystem, not inline in SQLite.** `user_messages.body_enc` is a `TEXT`
column holding a short encrypted string — fine for chat text, wrong for a
5 MB voice note: SQLite handles BLOBs fine in principle, but every backup,
`VACUUM`, and ordinary text-message read would now drag multi-MB rows through
the same file `data/analytics.db`-adjacent database all the *other* SetaLink
tables (devices, referrals, monetization...) live in. Keep media out of that
DB entirely.

Proposed layout (mirrors how `public/download/*.apk` already live as plain
files under `public/`, just outside the web-servable tree and access-gated):

```
data/message_media/
  <yyyy>/<mm>/<dd>/<random-128bit-hex>.enc      — encrypted file bytes
```

- Filename is a random token, **never** derived from the sender/recipient
  IDs or original filename (no metadata leakage via the path itself).
- Directory is OUTSIDE `public/` — never directly web-servable. The ONLY way
  to read a file's bytes is the authenticated endpoint in §4, mirroring how
  message bodies are only ever readable through `list-messages`, never a
  static URL.
- One `message_media` DB row (small, metadata-only — see §3) points at the
  path; the row and the file are always created/deleted together.

## 3. Schema addition (`lib/messaging.php`, alongside the existing tables)

```sql
CREATE TABLE IF NOT EXISTS message_media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    INTEGER NOT NULL,              -- FK to user_messages.id
    kind          TEXT    NOT NULL,              -- 'image' | 'file' | 'voice'
    mime_type     TEXT    NOT NULL DEFAULT '',   -- sniffed server-side, never trusted from the client (§6)
    file_path     TEXT    NOT NULL,              -- relative to data/message_media/
    file_size     INTEGER NOT NULL DEFAULT 0,    -- bytes, post-encryption
    duration_secs INTEGER,                       -- voice only; NULL for image/file
    original_name TEXT    NOT NULL DEFAULT '',   -- file kind only, user-facing display name (sanitized, no path chars)
    width         INTEGER,                       -- image only
    height        INTEGER,                       -- image only
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mm_message ON message_media(message_id);
```

`user_messages.body_enc` stays the encrypted TEXT body for a media message
too — either empty string (pure attachment, no caption) or the encrypted
caption text the user typed alongside it. A media message is always both a
`user_messages` row AND exactly one `message_media` row (1:1, enforced by
the unique index) — never a message type that skips `user_messages`,
so every existing code path (`dm_list`, unread counts, disappearing timers,
soft-delete, rate limiting, admin stats) keeps working on media messages
for free without special-casing.

## 4. API surface (extends `public/api.php`, same dispatch pattern as `send-message`)

### `upload-message-media` (POST, multipart/form-data)

```
POST /api.php  action=upload-message-media
  device_id:  string
  recipient:  string          (SetaLink ID — same as send-message)
  kind:       'image'|'file'|'voice'
  caption:    string, optional (plain text, encrypted server-side like a normal body)
  expire_secs: int, optional  (same disappearing-message contract as send-message)
  file:       binary upload
  duration_secs: int, required if kind='voice'
```

Server does, in order:
1. All of `dm_send`'s existing checks first (sender/recipient valid, not
   blocked, not self, not over the per-minute/per-day rate limit) — a media
   message counts against the SAME rate limits as a text one, not a separate
   bucket (one abusive device shouldn't get 10 texts/min AND 10 photos/min).
2. Size cap by kind (§5), rejected before anything touches disk.
3. Sniff the real file type from bytes (§6), reject if it doesn't match an
   allow-listed kind for the claimed `kind`.
4. Encrypt the file bytes with the SAME `dm_key()` this repo already has for
   text (`dm_encrypt()`/`dm_decrypt()` in `lib/messaging.php`) — one key,
   one trust boundary, not a second secret to manage. For files above a few
   MB, chunk the encryption (secretbox has no natural streaming mode, but
   splitting into e.g. 1 MB chunks, each its own nonce+ciphertext, keeps
   memory bounded on a modest server rather than loading the whole file into
   RAM at once).
5. Write to `data/message_media/...`, insert the `message_media` row, then
   `dm_send()`'s existing insert for the `user_messages` row (empty or
   caption body) — reuse `dm_send`, don't duplicate its validation.
6. Return the same shape `send-message` already returns, plus `media_id`.

### `get-message-media` (GET, streamed response)

```
GET /api.php?action=get-message-media&device_id=...&message_id=...
```

- Loads the `user_messages` row, checks `device_id` is sender OR recipient
  (same check `dm_delete_message` already does) — reject anyone else with
  the same generic "not found" `dm_send` already uses for a nonexistent
  recipient, never a distinguishing error that would let someone probe
  which message IDs exist.
- Decrypts, streams the bytes back with the real `mime_type` from
  `message_media` (never trust a client-supplied content-type on the way
  back out either).
- **Never** logged, never cached server-side beyond the encrypted file
  itself, same posture as message bodies.

### `list-messages` — no new action, existing response gains a field

Each message in `dm_list()`'s output gains an optional `media` object
(`{kind, mime_type, file_size, duration_secs, original_name, width, height}`)
when `message_media` has a row for it — metadata only, never the bytes
themselves (those are lazy-fetched via `get-message-media` only when the
user actually opens/plays that specific message, not eagerly for a whole
thread — matters a lot on the throttled/censored connections this app is
built for).

## 5. Size & format caps (server-enforced, not just client-side UX)

| kind  | max size | formats allow-listed              | notes |
|-------|----------|------------------------------------|-------|
| image | 8 MB     | JPEG, PNG, WebP                    | client should downscale/compress before upload (mirrors how the mobile app already treats bandwidth as precious everywhere else) |
| file  | 20 MB    | narrow allow-list, NOT arbitrary — start with PDF/DOCX/XLSX/TXT/ZIP, extend deliberately, never "anything" | never an executable/script MIME type or extension, full stop |
| voice | 5 MB / 5 min | AAC (.m4a) or Opus (.ogg)      | cap duration client-side during recording, server re-validates both size AND `duration_secs` against the actual decoded length before trusting the client's claimed value |

Caps live in `lib/messaging.php` as named constants (`MEDIA_MAX_IMAGE_BYTES`
etc.), same convention as `MSG_MAX_LEN`/`MSG_MAX_PER_MIN` — one place to
tune, never a magic number inline.

**Per-device storage quota**, separate from the per-minute/per-day message
*count* limits: cap total `message_media` bytes per sender device over a
rolling window (e.g. 200 MB/day) so one account can't fill the disk even
while staying under the message-count rate limit (a handful of 8 MB images
back-to-back is nowhere near the count limit but is real disk pressure).

## 6. Content-safety (cheap, real first line of defense — not full AV scanning)

- **Sniff, don't trust the extension or client-supplied MIME type.** Check
  the actual file signature (magic bytes) matches an allow-listed format —
  PHP's `finfo`/`getimagesize()` for images, a signature check for audio/PDF.
  A `.jpg` that's actually an ELF binary gets rejected here, before it ever
  touches disk.
- **Full malware/AV scanning is explicitly out of scope for this pass** —
  worth flagging honestly rather than pretending the above is a complete
  answer. If this becomes a real concern once the feature ships, ClamAV
  (`clamscan`) is the standard cheap local option; not proposing it now
  because it adds a real CPU/memory cost per upload that isn't justified
  until there's evidence of actual abuse, not just the theoretical risk.
- Images: strip EXIF (especially GPS) server-side before storing — the
  privacy posture that already keeps phone/email/IP out of this system
  should extend to "don't accidentally store where a photo was taken."

## 7. Disappearing messages + soft-delete — must cover the file too

The existing `dm_purge_expired()` hard-deletes the `user_messages` row when
a disappearing message's timer runs out. For a media message, it must ALSO:
1. Look up the `message_media` row for that `message_id`.
2. `unlink()` the actual file at `data/message_media/<file_path>`.
3. Delete the `message_media` row.
4. Only then delete the `user_messages` row (or do all four in one
   transaction) — never leave an orphaned encrypted file on disk once its
   message is gone, and never delete the DB row while the file survives
   (that would make it unreachable-but-not-actually-erased, defeating the
   whole point of a disappearing message).

Same ordering applies to a permanent (non-expiring) delete path if one gets
added later (`dm_delete_message` is currently soft-delete-per-viewer only —
it does NOT hard-delete the row or any file, by design, since the other
party's copy must survive; a media message's file must therefore only ever
be `unlink()`'d when BOTH the disappearing-timer fires or, if a true
hard-delete feature is ever built, when both parties' rows are gone).

## 8. Admin visibility — same blind spot as text bodies, on purpose

`dm_admin_stats()` already never selects `body_enc` (requirement #9 in its
own docblock: "message content cannot leak into the admin panel"). Media
messages must get the identical treatment: admin can see that a message HAS
an attachment, its `kind`/`file_size`/`duration_secs` (useful for abuse/
storage monitoring — e.g. "this device uploaded 400 MB today"), but never
a thumbnail, never a preview, never the decrypted bytes. No admin UI for
"view this image" should ever exist.

## 9. Mobile-app native dependencies (the reason this was deferred)

Two new native modules, each with real linking/build-config cost (part of
why Agent A explicitly sequenced this as its own pass rather than folding
it into the chat-reactions build):

- **Image/document picker** — `react-native-image-picker` (camera + photo
  library) and/or `react-native-document-picker` (generic files) — for a
  bare React Native app (this is not Expo), both need native linking on
  Android AND iOS, plus `Info.plist`/`AndroidManifest.xml` permission
  entries (camera, photo library, storage) with real user-facing rationale
  strings (App Store/Play Store review requires these to be honest about
  what they're for — matches the `docs/realgram/APP_STORE_COMPLIANCE.md`
  posture already established elsewhere in this repo).
- **Audio recorder/player** — `react-native-audio-recorder-player` (or
  equivalent) — microphone permission on both platforms, plus a recording
  UI (press-and-hold or tap-to-start/stop, waveform or timer while
  recording, mirrors the interaction pattern most Telegram-like apps use
  so it doesn't need reinventing).

Both should land as **separate PRs/builds** from each other, not one
combined "media" release — an image-picker regression and an audio-recorder
regression are easier to isolate and roll back independently, and this
matches the project's existing discipline of shipping the smallest coherent
slice per build (see how the reactions/typing/search chat pass was already
split from THIS media pass for exactly that reason).

## 10. Suggested build order (once someone picks this up)

1. Backend: schema + `upload-message-media`/`get-message-media` + size/
   format/quota enforcement + disappearing-message file cleanup (§2–§7).
   Fully testable server-side with synthetic file uploads, no native app
   changes needed yet — same `scripts/test-messaging.php`-style PHP test
   approach already proven for the reactions/typing backend.
2. Mobile: image/file attachment UI (picker → upload → render in thread) —
   smaller native-dependency surface than voice, ships first.
3. Mobile: voice message UI (record → upload → playback in thread) —
   ships second, isolated from #2.

Each step should get its own pre-build check + TASK_SPLIT entry, same
coordination pattern this whole project already uses.
