# RealGram Native Messaging — Data Model, ID Merge, Migration Plan, Wireframes

Written 2026-07-17 per `DECISIONS.md`'s same-date entry and
`ADMIN_NOC_ROADMAP.md` § 6.12 (pre-coding gate for § 6, REALGRAM COMMUNITY
& MESSAGING). **This is a design document for review — no code has been
written from it.** Fase 1 coding stays blocked until Khabat approves this
document (§ 6.12 row 6).

Everything below was grounded by reading the actual current schema
(`public/api.php`, `lib/quota_economy.php`) rather than assumed — see
§ 0 for exactly what was verified vs. what's still an open question for
Agent B / the Shahnameh backend (separate repo, not readable from here).

---

## 0. What already exists — read this before designing anything "new"

Verified directly in this repo, 2026-07-17:

- **`devices`** (SQLite, `public/api.php` ~L79): `device_id` (TEXT PRIMARY
  KEY, the `SL-227-xxxx`-style anonymous ID Khabat flagged), `user_id`
  (TEXT, friendlier ID, added later), `referral_code` (TEXT UNIQUE),
  `quota_bytes_total`/`quota_bytes_used`, `plan`, `platform`, `status`
  (online/offline), `country`, `language`, `last_seen`.
- **Quota transfer already fully built and live**: `quota_transfer` table
  + `qe_transfer()` (`lib/quota_economy.php:370`), called from
  `POST action=transfer-quota` (`public/api.php:1207`), with a real mobile
  screen already shipped (`mobile-app/src/screens/TransferScreen.tsx`).
  Atomic, audited, **anti-fraud limits already enforced**:
  `QE_MIN_TRANSFER` = 100 MiB, `QE_DAILY_MAX_BYTES` = 50 GiB/day,
  `QE_DAILY_MAX_COUNT` = 10/day, starter quota excluded from transfer.
  Recipient resolves by `device_id | user_id | referral_code`
  (`qe_resolve_recipient`, `quota_economy.php:352`).
  **`ADMIN_NOC_ROADMAP.md` § 6.6 is wrong to mark this "Not started" for
  the backend — fixed in § 4 of this doc.** What's actually missing is
  the *chat-integrated* UX (§6.6's flow: pick from a conversation, system
  message in-thread) and the admin-visible history panel, not the ledger.
- **Today's "Inbox" = `admin_messages`** (`target_device_id, title, body`,
  written by `push_device_message()`, `public/api.php:185`). This is
  **one-directional system → device**, no threading, no read state, no
  peer-to-peer. This is the thing Khabat means by "support-ticketliste
  med SL-227-xxxx" — it's not a messaging system at all, just a
  notification log. It becomes the seed data for each profile's single
  Support conversation (§ 3), not something to build peer messaging on
  top of.
- **`referral_uses`**: referrer/new device rows, risk-scored, feeds the
  milestone ladder (`qe_milestones()`).
- **TrustAI linkage**: `sso-link.php`/`sso-login.php` (see `DECISIONS.md`
  2026-07-12/14 entries) — an RS256 JWT `sub` claim maps to a TrustAI
  `real_account`. This is the **existing, live** device↔TrustAI link —
  reuse it, don't design a new one.
- **Telegram↔device linkage**: Shahnameh's Telegram bot already handles
  `/start linkvpn_<deviceId>` server-side (see `DECISIONS.md` 2026-07-16
  B-22 entry, `GameScreen.tsx`'s unlinked-state CTA). This is the
  **existing, live** bridge between a Telegram account and a `device_id`
  — reuse it for § 6.1's Telegram identity link, don't invent a second
  mechanism.

**RESOLVED 2026-07-17** (was an open question — Shahnameh backend turned
out to be directly readable from this VPS at `/var/www/backend/backend`,
same box, no separate-repo blocker after all): read
`model/season2User.js` directly.

- **Shahnameh's player-identifying field is `telegram_id`** (`String,
  required, unique, index`) — Shahnameh has **no separate internal player
  ID**; Telegram identity *is* the primary key. `season2_users` also
  carries `clan_id`, `referral_code`, `referred_by`, `zar`, `real_balance`,
  `gems`, `farr`, `level`, `xp` directly on the same document.
- **An ecosystem-wide `@handle` already exists and is already live** —
  `season2_users.handle` (unique, sparse), exposed via a real,
  Bearer-authed API (`routes/api/ecosystem.js`, task B-14, contract §7 in
  `docs/realgram/DECISIONS.md`):
  - `GET /v1/handle-lookup?handle=...` → `{available: true}` or
    `{available: false, account: "<telegram_id>"}`.
  - `POST /v1/handle-claim {account, handle}` → claims/changes a handle,
    atomic via the schema's unique sparse index, `409 handle_taken` on
    conflict.
  **This changes § 1.1 below: RealGram's `@handle` must not be a second,
  independent handle namespace — it should read/write through this
  existing contract, not reinvent one.** Fixed in § 1.1 and § 2.
- **The REAL balance API is a full, already-live contract**, not just a
  raw DB field — `routes/api/ecosystem.js`, Bearer-auth'd with
  `REAL_ECOSYSTEM_API_KEY` (`docs/realgram/TASK_SPLIT.md` §API contracts
  2–5):
  ```
  GET  /v1/balance/:account                              — contract 3
  POST /v1/verify-spend {account, amount, tx_ref}         — contract 2
  POST /v1/spend  {account, amount, purpose, idempotency_key}   — contract 4
  POST /v1/grant  {account, amount, reason,  idempotency_key}   — contract 5
  POST /v1/sso-token {account, device_id?}                — contract §6
  GET  /v1/sso/jwks.json                                  — public, no auth
  ```
  `account` is always `season2_users.telegram_id`. `/v1/spend` and
  `/v1/grant` are claim-first idempotent (unique index on `(account,
  idempotency_key, kind)` in `real_ecosystem_tx`) — same double-submit
  protection pattern as `qe_transfer()` in this repo, independently
  arrived at on the other side of the ecosystem. `/v1/spend`,
  `/v1/verify-spend`, `/v1/grant` are **user↔system only** — confirms
  § 4's "Send REAL/ZAR has no p2p path today" finding; nothing here
  does account-to-account transfer.
- **`real_ecosystem_tx`** (Mongo, `model/realEcosystemTx.js`) is already a
  real transaction ledger — one document per spend/grant attempt, fields
  `account, idempotency_key, tx_ref, kind ('spend'|'grant'), amount,
  purpose, status, balance_after, created_at`. **This is a second,
  separate transaction log from this repo's own `quota_transactions`** —
  relevant to § 9's "unified history" requirement (`ADMIN_NOC_ROADMAP.md`
  § 9.1.1): a unified REAL Wallet history has to merge rows from *at least*
  `real_ecosystem_tx` (Shahnameh side) and `quota_transactions`/
  `quota_transfer` (this repo), not read from one table.

---

## 1. Data model

New tables only — nothing below touches `devices`, `quota_transactions`,
`quota_transfer`, `referral_uses`, or `admin_messages`. Written in the
same style as `lib/quota_economy.php` (SQLite, `CREATE TABLE IF NOT
EXISTS`, PDO). Suggested new file: `lib/realgram_identity.php` +
`lib/realgram_messaging.php`, following the existing one-file-per-concern
pattern.

### 1.1 Identity

```sql
-- The one durable, permanent RealGram identity. Everything else links to this.
CREATE TABLE IF NOT EXISTS realgram_profiles (
    id              TEXT PRIMARY KEY,   -- new UUID, generated at profile creation
    handle          TEXT UNIQUE,        -- @handle — MIRROR of season2_users.handle (ecosystem-wide,
                                         -- already live via /v1/handle-lookup + /v1/handle-claim),
                                         -- not an independently owned namespace. Write-through: a
                                         -- claim here must call /v1/handle-claim, not just insert
                                         -- locally. Nullable until set.
    display_name    TEXT    DEFAULT '',
    avatar_url      TEXT    DEFAULT '',
    language        TEXT    DEFAULT '',
    online_status   TEXT    DEFAULT 'offline',  -- online|offline|away, mirrors devices.status
    created_at      TEXT    DEFAULT (datetime('now')),
    last_active_at  TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rgp_handle ON realgram_profiles(handle);

-- One profile can have many linked identities (multi-device, future re-link).
-- system: 'device' | 'shahnameh' | 'trustai' | 'telegram'
CREATE TABLE IF NOT EXISTS realgram_identity_links (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      TEXT    NOT NULL REFERENCES realgram_profiles(id),
    system          TEXT    NOT NULL,
    external_id     TEXT    NOT NULL,   -- devices.device_id | shahnameh season2_users.telegram_id | trustai real_account | telegram user id
    linked_at       TEXT    DEFAULT (datetime('now')),
    UNIQUE(system, external_id)         -- one external identity maps to exactly one profile
);
CREATE INDEX IF NOT EXISTS idx_ril_profile ON realgram_identity_links(profile_id);
```

**Why a link table instead of columns on `realgram_profiles`:** a device
can in principle re-link (new phone, same person), and not every profile
will have every link (Telegram is optional per the product decision).
`UNIQUE(system, external_id)` is the actual anti-duplicate-account
constraint — this is where "does this Telegram account already belong to
a profile" gets enforced, same shape as TrustAI's existing
`account_linked_elsewhere` (409) check in `sso-link.php`.

### 1.2 Messaging

```sql
CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,   -- UUID
    type            TEXT    NOT NULL,   -- 'dm' | 'clan' | 'group' | 'support'
    clan_id         TEXT    DEFAULT NULL REFERENCES clans(id),  -- set only for type='clan'
    title           TEXT    DEFAULT '',              -- group/clan display name; unused for 'dm'
    created_at      TEXT    DEFAULT (datetime('now')),
    last_message_at TEXT    DEFAULT (datetime('now'))  -- denormalized, for list sort
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT    NOT NULL REFERENCES conversations(id),
    profile_id      TEXT    NOT NULL REFERENCES realgram_profiles(id),
    role            TEXT    DEFAULT 'member',  -- owner|commander|moderator|member (clan/group only)
    muted           INTEGER DEFAULT 0,
    pinned          INTEGER DEFAULT 0,
    joined_at       TEXT    DEFAULT (datetime('now')),
    last_read_at    TEXT    DEFAULT (datetime('now')),   -- drives unread badge + read receipts
    PRIMARY KEY (conversation_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_cp_profile ON conversation_participants(profile_id);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT    PRIMARY KEY,  -- UUID (client-generated, idempotency key — see §1.3)
    conversation_id TEXT    NOT NULL REFERENCES conversations(id),
    sender_id       TEXT    NOT NULL REFERENCES realgram_profiles(id),
    kind            TEXT    NOT NULL DEFAULT 'text',  -- text|system|quota_transfer|image
    body            TEXT    DEFAULT '',
    reply_to_id     TEXT    DEFAULT NULL REFERENCES messages(id),
    metadata        TEXT    DEFAULT '',     -- JSON: e.g. {"quota_transfer_id": 123} for kind='quota_transfer'
    edited_at       TEXT    DEFAULT NULL,
    deleted_at      TEXT    DEFAULT NULL,   -- soft delete, keeps moderation audit trail
    created_at      TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

-- Per-recipient delivered/read state (needed for group chats where "read"
-- isn't a single timestamp on the conversation).
CREATE TABLE IF NOT EXISTS message_receipts (
    message_id      TEXT    NOT NULL REFERENCES messages(id),
    profile_id      TEXT    NOT NULL REFERENCES realgram_profiles(id),
    delivered_at    TEXT    DEFAULT NULL,
    read_at         TEXT    DEFAULT NULL,
    PRIMARY KEY (message_id, profile_id)
);
```

**Live updates (§6.3's WebSocket requirement):** this repo has no
WebSocket server today (verified — `public/api.php` is plain
request/response PHP). Two realistic options, to be decided at
implementation time, not in this doc:
1. A small dedicated WebSocket process (Node, matching Shahnameh's stack)
   fed by the same SQLite DB via polling or a message queue.
2. Long-poll / SSE from PHP as a lower-risk first cut, upgraded to real
   WebSocket in Fase 2 if it doesn't feel live enough.
Flagging this as an **open implementation decision**, not resolved here —
it affects hosting cost and the 1GB-RAM constraint this VPS already
operates under, so it needs its own sign-off, not a default pick.

### 1.3 Clans and groups

```sql
CREATE TABLE IF NOT EXISTS clans (
    id                TEXT PRIMARY KEY,
    name              TEXT    NOT NULL,
    avatar_url        TEXT    DEFAULT '',
    owner_profile_id  TEXT    NOT NULL REFERENCES realgram_profiles(id),
    invite_code       TEXT    UNIQUE,
    created_at        TEXT    DEFAULT (datetime('now'))
);
-- Membership/roles reuse conversation_participants on the clan's chat
-- conversation (type='clan') rather than a separate table — one less
-- place for role state to drift out of sync with who's actually in the chat.
```

### 1.4 Data-quota transfer — chat integration only (backend reused, §0)

```sql
-- Links an existing quota_transfer row (lib/quota_economy.php) to the
-- chat message that displays it. Does NOT duplicate the ledger.
CREATE TABLE IF NOT EXISTS realgram_quota_transfer_messages (
    quota_transfer_id  INTEGER NOT NULL,  -- FK to existing quota_transfer.id
    message_id         TEXT    NOT NULL REFERENCES messages(id),
    PRIMARY KEY (quota_transfer_id, message_id)
);
```

`POST action=transfer-quota` (existing, `public/api.php:1207`) stays the
only place a transfer is ever written to `quota_transfer`/
`quota_transactions` — the chat UI calls it exactly as `TransferScreen.tsx`
does today, then additionally inserts a `messages` row (`kind =
'quota_transfer'`) in the DM's `conversation_id` and a row here linking
the two. This satisfies § 6.6's "atomic transaction, no double-spend, rate
limiting, min/max, anti-fraud" requirements **for free**, because that
code already has them — new work is only the chat-thread rendering.

### 1.5 Moderation

```sql
CREATE TABLE IF NOT EXISTS blocks (
    blocker_profile_id TEXT NOT NULL REFERENCES realgram_profiles(id),
    blocked_profile_id TEXT NOT NULL REFERENCES realgram_profiles(id),
    created_at          TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_profile_id, blocked_profile_id)
);

CREATE TABLE IF NOT EXISTS reports (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_profile_id TEXT    NOT NULL REFERENCES realgram_profiles(id),
    reported_profile_id TEXT    DEFAULT NULL REFERENCES realgram_profiles(id),
    message_id          TEXT    DEFAULT NULL REFERENCES messages(id),
    reason               TEXT    NOT NULL,
    status               TEXT    DEFAULT 'pending',  -- pending|reviewed|actioned|dismissed
    created_at           TEXT    DEFAULT (datetime('now')),
    reviewed_at           TEXT    DEFAULT NULL
);
```

Feeds an admin moderation queue — same review-queue pattern already used
for `ad_reward_events.status='review'` (`REWARDED-ADS-RECOVERY.md` §6) and
flagged referrals — reuse that admin UI pattern, don't invent a new one
(`ADMIN_NOC_ROADMAP.md` § 1's shared design system applies here too).

---

## 2. User-ID system merge plan

Four systems, verified state per § 0:

| System | Identifier | Status |
|---|---|---|
| SetaLink/ReaLink (this repo) | `devices.device_id` (anonymous, `SL-227-xxxx`-shaped) | **Always present** — every existing user has one |
| SetaLink/ReaLink (this repo) | `devices.user_id` | Present for some devices (added by later migration) |
| TrustAI | `real_account` (via SSO JWT `sub`) | Present only for devices whose owner explicitly linked TrustAI |
| Shahnameh | `season2_users.telegram_id` (**confirmed 2026-07-17** — read directly from `/var/www/backend/backend/model/season2User.js`; Shahnameh has no separate player ID, Telegram identity *is* the primary key) | Present only for devices whose owner plays Shahnameh and has linked via `linkvpn_<deviceId>` |
| Telegram | Telegram user ID | Present only for devices whose owner went through the bot's `linkvpn_<deviceId>` flow, or a future direct Telegram login |

**Consequence of the confirmation above:** since Shahnameh's player ID
*is* a Telegram ID, links 4 and 5 below resolve to **the same value** for
any device that has done the `linkvpn_<deviceId>` handshake — one
handshake yields both the `telegram` and `shahnameh` identity links at
once, they're just tagged under different `system` values in
`realgram_identity_links` (schema allows this: `UNIQUE(system,
external_id)` is per-system, not global). Don't build two separate
lookups for what's actually one linked fact.

**Merge rule:** `devices.device_id` is the anchor, because it's the only
identifier guaranteed to exist for every current user (it's the VPN
identity itself). The merge is therefore:

1. One `realgram_profiles` row created per existing `device_id` at
   migration time (§ 3) — **not** per human; a person with two devices
   gets two profiles initially, same as today's model. Merging two
   profiles into one (multi-device login) is a *later*, explicit,
   user-initiated action — out of scope for Fase 1 (`ADMIN_NOC_ROADMAP.md`
   § 6.11), not attempted automatically, since guessing "these two devices
   are the same person" wrong would put two strangers' data behind one
   login.
2. `realgram_identity_links` row `('device', device_id)` created for every
   profile — always present.
3. `realgram_identity_links` row `('trustai', real_account)` created
   **only** when a device has already completed the existing
   `sso-link.php` flow — read from TrustAI's existing linkage record
   (exact table TBC — needs Agent B to confirm where `sso-link.php`
   persists the device↔`real_account` mapping today), not re-derived.
4. `realgram_identity_links` row `('telegram', telegram_user_id)` created
   **only** when a device has already completed the bot's
   `linkvpn_<deviceId>` handshake — same principle, read the existing
   link, don't re-implement the handshake.
5. `realgram_identity_links` row `('shahnameh', telegram_id)` — **same
   value as step 4** (see consequence note above), created alongside it
   from the same `linkvpn_<deviceId>` handshake record, not a second
   lookup. `@handle` sync: when this link is created, pull
   `season2_users.handle` (if already claimed there) into
   `realgram_profiles.handle` via `GET /v1/handle-lookup`, rather than
   prompting the user to pick a handle they may have already claimed
   ecosystem-wide.

**What this deliberately does NOT do:** invent a new cross-system login or
a new linking mechanism. Every link in step 3–5 reuses a bridge that
already exists and is already live — **including `@handle` now**, corrected
2026-07-17: it's not net-new, it's `season2_users.handle` via the already-
live `/v1/handle-lookup`/`/v1/handle-claim` contract, synced in
(§ 2 step 5), not invented fresh in RealGram. The only genuinely new
concept left is `realgram_profiles` itself — the unifying row that didn't
exist in any system before.

### 2.1 REAL_ID — the long-term canonical identity (Khabat's principle, 2026-07-17)

**Telegram-ID is a temporary primary identity, not the permanent one.**
Long-term, every service should key off a single **REAL_ID**, with
Telegram becoming *one identity link among several* — not special-cased.
Future link types Khabat named: Apple, Google, phone number, e-mail,
wallet address. All of them point at the same REAL_ID.

**The good news: this repo's design already has the right shape for it.**
`realgram_profiles.id` (§ 1.1) *is* REAL_ID in everything but name — a
durable UUID that every identity link (`realgram_identity_links`, already
provider-agnostic: `system` + `external_id`) points at. Formalizing this
means:

1. **Rename in spirit, not necessarily in code:** `realgram_profiles.id`
   is documented from this point forward as *the* REAL_ID — the canonical
   ecosystem identity, not a RealGram-internal implementation detail.
2. **`realgram_identity_links.system` extends cleanly** to new providers
   as they're added — `'apple' | 'google' | 'phone' | 'email' |
   'wallet_address'` alongside today's `'device' | 'trustai' |
   'telegram' | 'shahnameh'` — no schema change needed, the table was
   already built provider-agnostic (§ 1.1's design reasoning already
   anticipated re-linking, just not this specific list of providers).
3. **What this repo (SetaLink) can promise vs. what it can't, honestly:**
   this repo's own tables (`devices`, `quota_transactions`, the new
   `realgram_*` tables) can be fully REAL_ID-anchored — that's within this
   session's control. **Shahnameh's `season2_users` cannot** — its
   `telegram_id` field is the actual Mongo document key today (§ 0), not
   just a foreign key. Making Shahnameh REAL_ID-native (so a user keeps
   Shahnameh progression after unlinking Telegram) is a **Shahnameh-side
   migration Agent B/the Shahnameh backend owns**, not something this
   repo's design can complete unilaterally. Flagging this honestly rather
   than implying REAL_ID is "done" once this repo's side is — it isn't,
   until Shahnameh's own primary key story changes too.
4. **The never-lose guarantee** (wallet, Shahnameh progress, REAL, ZAR,
   data quota, clan, friends, history — survives a Telegram unlink) is
   therefore **not fully deliverable until step 3's Shahnameh-side
   migration happens**. Today, unlinking Telegram from a profile would
   orphan the `('shahnameh', telegram_id)` link (§ 2 step 5) with no
   REAL_ID-keyed fallback on Shahnameh's side to fall back to — the
   guarantee is a real target, not yet an achievable one end-to-end.

**Sequencing:** REAL_ID formalization (points 1–2) can happen inside this
repo's own § 6 Fase 1 work with no cross-team dependency. The full
never-lose guarantee (points 3–4) is a separate, larger, cross-repo effort
that needs its own scoping conversation with whoever owns the Shahnameh
backend session — not silently assumed as part of § 6 Fase 1.

#### 2.1.1 SSO consequence: Shahnameh must never ask "how do you want to log in?" when a REAL-ID already exists (Khabat, 2026-07-18)

**Principle, stated directly:** REAL-ID is the master identity across the
whole ecosystem (RealGram, Shahnameh, TrustAI, 3REAL, Wallet, future
services). Telegram is *a way to create or link* a REAL-ID, never a
second, competing identity a linked user gets asked to choose again.
Pseudocode goal: `if (realIdSession.exists()) { loginWithRealId();
openGame(); } else { showLoginOptions(); }` — no linked user should ever
log in twice.

**Verified, not assumed — read `GameScreen.tsx` directly rather than
taking the flow on faith:**

- **Scenario 1 (RealGram → Shahnameh):** built, same-day, commit
  `048f229` (`feature/realgram-foundation`). A `checking` state shows a
  neutral gold spinner while an already-linked account's SSO status is
  silently confirmed server-side — the old behavior (gate flashing
  briefly before disappearing) is gone. Users arriving via the RealGram
  Home shortcut go straight into the game, no screen, no choice.
- **Scenario 2 (Telegram → Shahnameh):** already built — the "not linked"
  gate's own file header documents it: Telegram bot auth and RealGram
  linking resolve to *the same canonical account* (Telegram `user_id`),
  so switching between entry paths never creates a duplicate identity.
- **Scenario 3 (Web/Desktop, direct to Shahnameh's own site):** **not
  verified this session.** The gate described above lives in the React
  Native app's `GameScreen.tsx` — Shahnameh also has a separate website
  (`/var/www/shahnameh`, own login/admin surfaces) that was not checked
  for the same "REAL-ID first, Telegram as fallback choice" behavior.
  Don't assume it matches Scenario 3 the pseudocode implies until someone
  actually reads that code too.

**What this means for § 1's identity-links design:** no change needed —
the `realgram_identity_links` table (§ 1.1) already models Telegram as
one link among several pointing at one REAL_ID-shaped profile, which is
exactly this principle. What's new here is confirmation that Agent A's
app-side implementation already follows it in the two scenarios that
touch the mobile app, not a new design requirement.

---

## 3. Migration plan

**Principle:** additive only. No existing table (`devices`,
`quota_transactions`, `quota_transfer`, `referral_uses`, `admin_messages`)
is altered, renamed, or has rows deleted. A user's quota, balance, and
referral history live exactly where they live today, untouched — RealGram
identity is a new layer on top, not a replacement.

**Steps (idempotent, matching the existing `ledger_backfilled` guard-column
pattern in `qe_backfill()`):**

1. Add `devices.realgram_profile_id TEXT DEFAULT NULL` (lazy `ALTER TABLE`,
   same style as `quota_economy.php`'s `ledger_backfilled` column).
2. Backfill script (new, e.g. `scripts/migrate-realgram-identity.php`,
   mirroring `scripts/migrate-quota-economy.php`'s shape): for every
   `devices` row where `realgram_profile_id IS NULL`, create a
   `realgram_profiles` row, link it (`device`, `device_id`), set
   `devices.realgram_profile_id`. Guarded so re-running is a no-op for
   already-migrated devices — same idempotency guarantee
   `qe_backfill()` already gives for the quota ledger.
3. Seed each new profile's **Support** conversation
   (`conversations.type='support'`) from that device's existing
   `admin_messages` rows, in order, as `kind='system'` messages — so
   support history is visible in the new UI, not lost. `admin_messages`
   itself is left in place (still written by any code path that hasn't
   moved to the new system yet — safe to run both in parallel during
   rollout).
4. Link TrustAI/Telegram/Shahnameh identities per § 2 steps 3–5, from
   whatever table each existing flow already persists its linkage in
   (needs confirmation per system before this step is implementation-ready
   — flagged, not blocking steps 1–3).
5. `@handle` and `display_name` start **empty** for migrated profiles —
   prompted at first RealGram app open (Fase 1 onboarding), never
   auto-generated from `device_id`/`user_id` (Khabat's explicit rule:
   don't surface the technical ID as identity).

**Rollback:** every step above is additive and guarded by
`realgram_profile_id IS NULL`/idempotency checks, so rollback is "stop
writing to the new tables" — no destructive step exists that would need
reversing. If a bug is found post-migration, the fix is a corrective
migration pass, not a rollback of user data.

**What could go wrong (called out explicitly, not glossed over):**
- If TrustAI/Telegram linkage tables turn out to store the mapping
  differently than assumed here (§ 2 step 3–5's "TBC"), step 4 needs a
  rewrite before it's safe to run — this is exactly why § 6.12 requires
  this document to be reviewed before Fase 1 coding, not discovered
  mid-migration on production data.
- Support-history backfill (step 3) could be large for devices with long
  `admin_messages` history — needs a batch size / rate limit in the actual
  script, not a single unbounded query, given the 1GB-RAM constraint this
  VPS operates under.

---

## 4. Correction to `ADMIN_NOC_ROADMAP.md` § 6.6

Per § 0's finding, updating the roadmap's blocker column for the backend
rows in § 6.6 to reflect that `qe_transfer()`/`transfer-quota` already
exist and are reusable as-is — only the chat-thread rendering (§ 1.4) is
new work. Done as a separate, small edit to `ADMIN_NOC_ROADMAP.md` in this
same commit.

---

## 5. Wireframes

Text-form (authoritative, lives in git, diffable). A visual version was
also published as a Claude Artifact for easier eyeballing — link shared
separately in chat since artifacts aren't reachable from inside this repo.

### 5.1 Chats (conversation list) — primary tab

```
┌─────────────────────────────────────────┐
│  RealGram                          [+]   │  ← app bar, [+] = new conversation
│  ┌───────────────────────────────────┐   │
│  │ 🔍  Search                        │   │
│  └───────────────────────────────────┘   │
│  [ Alle ] Venner  Clan  Shahnameh  Support Grupper   │  ← filter chips, scrollable row
│ ───────────────────────────────────────  │
│  📌 (●)Ava  "Sendte deg 500 MB"   14:02  │  ← pinned, online dot, unread bold
│         2 ulest ●●                        │
│ ───────────────────────────────────────  │
│  (○)Clan Warriors  "Sara: gg alle"  13:40 │  ← clan chat, group icon
│         typing…                           │
│ ───────────────────────────────────────  │
│  (●)Nima   ✓✓ Levert          12:11      │  ← DM, delivered check, muted icon if muted
│         Du: Takk!                          │
│ ───────────────────────────────────────  │
│  (○)Support  ✓ Lest             Man       │  ← the ONE support conversation
│         Din sak er løst.                   │
└─────────────────────────────────────────┘
```
Key structural rule: **Support is one row, not a list of tickets** — this
is the fix for Khabat's original complaint.

### 5.2 Direct Message (1:1 chat)

```
┌─────────────────────────────────────────┐
│  ← (●)Ava  @ava_warrior      online       │  ← back, avatar, handle, presence
├─────────────────────────────────────────┤
│                                            │
│        ┌───────────────────────┐         │
│        │ Hei! Har du sett...    │         │  ← incoming bubble, left
│        └───────────────────────┘ 14:00    │
│                                            │
│  ┌───────────────────────┐               │
│  │ 💰 Du sendte 500 MB     │               │  ← kind='quota_transfer' system bubble
│  └───────────────────────┘ 14:02 ✓✓       │
│                                            │
│              ┌──────────────┐             │
│              │ Nice, takk!   │             │  ← outgoing bubble, right
│              └──────────────┘ 14:03 ✓✓    │
│                                            │
│  Ava skriver …                             │  ← typing indicator
├─────────────────────────────────────────┤
│ [😀] [Skriv en melding...........] [➤]   │  ← composer: emoji, text, send
│      [📎 Send data]                        │  ← quota-transfer entry point
└─────────────────────────────────────────┘
```

### 5.3 Warrior Profile (Shahnameh-linked profile view)

```
┌─────────────────────────────────────────┐
│              [ Avatar ]                   │
│           Ava · @ava_warrior              │
│         🛡 Commander · Clan Warriors       │
│         Lvl 24 · Chapter 7  ▓▓▓▓▓▓░░ 71%  │
├─────────────────────────────────────────┤
│  🏆 Achievements   👥 12 venner           │
│  📶 3.2 GB tilgjengelig kvote             │
├─────────────────────────────────────────┤
│  [ 💬 Send melding ]  [ ➕ Legg til venn ] │
│  [ 📎 Send datakvote ]  [ 🛡 Inviter til clan ] │
├─────────────────────────────────────────┤
│  Nylige achievements                      │
│  🏅 Scout   🏅 Connector   🏅 Builder      │
└─────────────────────────────────────────┘
```

### 5.4 Clan Chat

```
┌─────────────────────────────────────────┐
│  ← 🛡 Clan Warriors            42 medl.  │
│     📌 Kunngjøring: Event lørdag!         │  ← pinned announcement
├─────────────────────────────────────────┤
│  Sara (Commander)                         │
│  gg alle, bra kamp i dag 🔥                │
│                                    13:40   │
│                                            │
│  Nima                                     │
│  enig!! 💪                                 │
│                                    13:41   │
│                                            │
│  ┌───────────────────────┐               │
│  │ ⚔ Ava ble Commander     │               │  ← system message: role change
│  └───────────────────────┘ 13:45         │
├─────────────────────────────────────────┤
│ [😀] [Melding til clanet.........] [➤]   │
└─────────────────────────────────────────┘
```

---

## 6. Sign-off checklist (§ 6.12 rows 2–6)

| Row | Deliverable | Where |
|---|---|---|
| 2 | Datamodell | § 1 above |
| 3 | ID-system-kartlegging | § 2 above |
| 4 | Migreringsplan | § 3 above |
| 5 | Wireframes | § 5 above (+ Artifact link, shared in chat) |
| 6 | Khabats godkjenning | **Pending — waiting on this document's review** |

Fase 1 coding does not start until row 6 flips to `Ja`.
