<?php
/**
 * SetaLink user-to-user messaging — MVP (v0.9.33).
 *
 * Shared helper library, mirrors lib/quota_economy.php: every function takes a
 * PDO so each caller (public/api.php mobile, admin/api.php) keeps its own DB
 * bootstrap. Messages are addressed by SetaLink ID only (device_id | user_id |
 * referral_code) — no phone number, email or IP is ever read or stored here.
 *
 * Privacy / security posture (MVP):
 *   - Bodies are encrypted at rest (libsodium secretbox, AES-256-GCM fallback)
 *     with a server-side key in data/.message_key. NOT end-to-end: the server
 *     can decrypt to deliver. The admin stats path never selects the body.
 *   - Rate limited per sender device (per-minute + per-day) to curb spam.
 *   - user_blocks / user_reports tables exist now but are reserved for the
 *     block/report feature shipped later; structure-only so the schema is ready.
 */

const MSG_MAX_LEN        = 2000;   // max characters per message body
const MSG_MAX_PER_MIN    = 10;     // per sender device, rolling 60s
const MSG_MAX_PER_DAY    = 300;    // per sender device, rolling 24h
const MSG_LIST_LIMIT     = 200;    // max messages returned by list
const MSG_MAX_EXPIRE_SECS = 7 * 86400; // cap for disappearing-message timers (7d)

// One emoji per (message, device) — tapping the same one again clears it,
// a different one replaces it. Mirrors mobile-app's DM_REACTIONS constant
// (entitlementService.ts, which already documents itself as mirroring this
// exact constant) — keep the two lists in sync.
const MSG_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// "Is typing" TTL: comfortably longer than the client's 2.5s ping interval
// (InboxScreen.tsx debounces set-typing to once per 2.5s) so a normal typing
// burst never flickers false between two pings, but short enough that
// stopping typing goes stale quickly without an explicit "stopped" call.
const MSG_TYPING_TTL_SECS = 6;

// ── Schema ───────────────────────────────────────────────────────────────────

function dm_init_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_messages (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_device     TEXT NOT NULL,
        sender_user_id    TEXT NOT NULL DEFAULT '',
        recipient_device  TEXT NOT NULL,
        recipient_user_id TEXT NOT NULL DEFAULT '',
        body_enc          TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'sent',   -- sent | read
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        read_at           TEXT DEFAULT NULL
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_um_recipient ON user_messages(recipient_device, id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_um_sender    ON user_messages(sender_device, id)");

    // Disappearing messages (Wickr-style): expire_secs is the sender-chosen
    // timer (0 = never). When the RECIPIENT reads the message, expires_at is
    // stamped read_at + expire_secs; dm_purge_expired() then hard-deletes the
    // row (encrypted body included) once that moment passes.
    dm_ensure_column($pdo, 'expire_secs', "INTEGER NOT NULL DEFAULT 0");
    dm_ensure_column($pdo, 'expires_at',  "TEXT DEFAULT NULL");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_um_expires ON user_messages(expires_at)");

    // Per-user soft-delete (v0.9.35): a row hides one message from ONE device's
    // inbox only. The message and the other party's copy are untouched (no global
    // hard-delete), and the encrypted body is never removed by this path.
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_message_deletes (
        message_id INTEGER NOT NULL,
        device_id  TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (message_id, device_id)
    )");

    // Reserved for the abuse/report/block feature (shipped later) — structure
    // only, nothing in the MVP writes to these yet.
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_device TEXT NOT NULL,
        blocked_device TEXT NOT NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (blocker_device, blocked_device)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_reports (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_device TEXT NOT NULL,
        message_id      INTEGER NOT NULL,
        reason          TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )");

    // One row per (message, reacting device) — the PK itself enforces "one
    // reaction per device per message" so toggle/replace is a plain
    // upsert-or-delete, never a dedupe query.
    $pdo->exec("CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL,
        device_id  TEXT    NOT NULL,
        emoji      TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (message_id, device_id)
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(message_id)");

    // Typing status: one row per (device, peer) pair, upserted on every
    // set-typing ping and read as "typing" only while updated_at is within
    // MSG_TYPING_TTL_SECS — no explicit "stopped typing" call, it just goes
    // stale. Directional (a->b and b->a are separate rows) since either side
    // can type independently.
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_typing_status (
        device_id  TEXT NOT NULL,
        peer       TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (device_id, peer)
    )");
}

/** Add a column to user_messages if this DB predates it (SQLite has no
 *  ADD COLUMN IF NOT EXISTS). */
function dm_ensure_column(PDO $pdo, string $col, string $ddl): void {
    foreach ($pdo->query("PRAGMA table_info(user_messages)") as $r) {
        if (($r['name'] ?? '') === $col) return;
    }
    $pdo->exec("ALTER TABLE user_messages ADD COLUMN $col $ddl");
}

/** UTF-8 codepoint count, mbstring-independent (the host PHP lacks mbstring).
 *  Keeps the length cap fair for Persian/Arabic text rather than byte-counting. */
function dm_strlen(string $s): int {
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    $n = preg_match_all('/./us', $s);
    return $n === false ? strlen($s) : $n;
}

// ── At-rest encryption ───────────────────────────────────────────────────────

/**
 * Load (or create on first use) the 32-byte symmetric key used to encrypt
 * message bodies at rest. Stored outside the DB at data/.message_key, 0600.
 */
function dm_key(): string {
    static $key;
    if ($key !== null) return $key;
    $path = dirname(__DIR__) . '/data/.message_key';
    if (is_readable($path)) {
        $raw = file_get_contents($path);
        if ($raw !== false && strlen($raw) >= 32) { $key = substr($raw, 0, 32); return $key; }
    }
    $key = random_bytes(32);
    // Best-effort persist as 0640 (owner+group) so the web user can read it on
    // the NEXT request. 0600 here was the v0.9.35 bug: when the file was owned by
    // a different user than php-fpm (www-data), the web process couldn't read it
    // and silently used a fresh ephemeral key every request — so message bodies
    // could never be decrypted across requests. Keep the file group = web user.
    $old = umask(0027);
    @file_put_contents($path, $key);
    @chmod($path, 0640);
    umask($old);
    return $key;
}

/** Encrypt a UTF-8 body → versioned, base64 token. */
function dm_encrypt(string $plain): string {
    $key = dm_key();
    if (function_exists('sodium_crypto_secretbox')) {
        $nonce  = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES); // 24
        $cipher = sodium_crypto_secretbox($plain, $nonce, $key);
        return 'v1:' . base64_encode($nonce . $cipher);
    }
    // openssl AES-256-GCM fallback
    $iv  = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return 'v2:' . base64_encode($iv . $tag . $cipher);
}

/** Decrypt a token produced by dm_encrypt(). Returns '' on failure. */
function dm_decrypt(string $token): string {
    $key = dm_key();
    if (str_starts_with($token, 'v1:') && function_exists('sodium_crypto_secretbox_open')) {
        $raw   = base64_decode(substr($token, 3), true);
        if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return '';
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        return $plain === false ? '' : $plain;
    }
    if (str_starts_with($token, 'v2:')) {
        $raw = base64_decode(substr($token, 3), true);
        if ($raw === false || strlen($raw) <= 28) return '';
        $iv     = substr($raw, 0, 12);
        $tag    = substr($raw, 12, 16);
        $cipher = substr($raw, 28);
        $plain  = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        return $plain === false ? '' : $plain;
    }
    return '';
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * True if either party has blocked the other. MVP always returns false (no
 * rows yet); kept as the single chokepoint so the later block feature only
 * has to start writing user_blocks.
 */
function dm_is_blocked(PDO $pdo, string $a, string $b): bool {
    $st = $pdo->prepare(
        "SELECT 1 FROM user_blocks
         WHERE (blocker_device=? AND blocked_device=?)
            OR (blocker_device=? AND blocked_device=?) LIMIT 1");
    $st->execute([$a, $b, $b, $a]);
    return (bool)$st->fetchColumn();
}

/**
 * Send a message addressed by SetaLink ID. Validates recipient, rejects
 * self/blocked, rate-limits, encrypts, stores.
 * Throws \RuntimeException with a client-safe message on any rejection.
 */
function dm_send(PDO $pdo, string $senderDevice, string $recipientParam, string $body,
                 int $expireSecs = 0): array {
    dm_init_tables($pdo);
    $expireSecs = max(0, min(MSG_MAX_EXPIRE_SECS, $expireSecs));

    $sender = qe_fetch_device($pdo, $senderDevice);
    if (!$sender)                        throw new \RuntimeException('sender not found');
    if ((int)($sender['blocked'] ?? 0)) throw new \RuntimeException('sender is blocked');

    $body = trim($body);
    if ($body === '')                       throw new \RuntimeException('message is empty');
    if (dm_strlen($body) > MSG_MAX_LEN)     throw new \RuntimeException('message too long');

    $receiver = qe_resolve_device($pdo, $recipientParam);
    if (!$receiver)                                 throw new \RuntimeException('recipient not found');
    if ($receiver['device_id'] === $senderDevice)   throw new \RuntimeException('cannot message yourself');
    if ((int)($receiver['blocked'] ?? 0))           throw new \RuntimeException('recipient unavailable');
    if (dm_is_blocked($pdo, $senderDevice, $receiver['device_id']))
                                                    throw new \RuntimeException('recipient unavailable');

    // Rate limit: per-minute and per-day, per sender device.
    $rl = $pdo->prepare(
        "SELECT
            COALESCE(SUM(created_at >= datetime('now','-60 seconds')),0) AS m,
            COALESCE(SUM(created_at >= datetime('now','-1 day')),0)      AS d
         FROM user_messages WHERE sender_device=?");
    $rl->execute([$senderDevice]);
    $c = $rl->fetch(PDO::FETCH_ASSOC) ?: ['m' => 0, 'd' => 0];
    if ((int)$c['m'] >= MSG_MAX_PER_MIN) throw new \RuntimeException('too many messages, slow down');
    if ((int)$c['d'] >= MSG_MAX_PER_DAY) throw new \RuntimeException('daily message limit reached');

    $pdo->prepare(
        "INSERT INTO user_messages
            (sender_device, sender_user_id, recipient_device, recipient_user_id, body_enc, status, expire_secs)
         VALUES (?,?,?,?,?, 'sent', ?)"
    )->execute([
        $senderDevice,
        (string)($sender['user_id'] ?? ''),
        $receiver['device_id'],
        (string)($receiver['user_id'] ?? ''),
        dm_encrypt($body),
        $expireSecs,
    ]);
    $id = (int)$pdo->lastInsertId();

    return [
        'message_id'        => $id,
        'recipient_device'  => $receiver['device_id'],
        'recipient_user_id' => (string)($receiver['user_id'] ?? ''),
        'created_at'        => date('Y-m-d H:i:s'),
        'status'            => 'sent',
        'expire_secs'       => $expireSecs,
    ];
}

/**
 * Unified inbox/outbox for a device, newest first. Bodies are decrypted here;
 * `direction` is 'in' (received) or 'out' (sent). Unread = incoming with
 * status='sent'. Peer is identified only by SetaLink user_id / device_id.
 */
/** Shared row->API-shape mapping for dm_list()/dm_thread_before() so the two
 *  can never silently drift apart on what a "message" looks like. */
function dm_row_to_message(array $r, string $deviceId, array $reactionsByMsg): array {
    $incoming = $r['recipient_device'] === $deviceId;
    $id = (int)$r['id'];
    $rx = $reactionsByMsg[$id] ?? ['counts' => [], 'mine' => null];
    return [
        'id'           => $id,
        'direction'    => $incoming ? 'in' : 'out',
        'peer_user_id' => $incoming ? ($r['sender_user_id']    ?: '') : ($r['recipient_user_id'] ?: ''),
        'peer_device'  => $incoming ?  $r['sender_device']            :  $r['recipient_device'],
        'body'         => dm_decrypt((string)$r['body_enc']),
        'read'         => $r['status'] === 'read' || !$incoming,
        'created_at'   => $r['created_at'],
        'expire_secs'  => (int)($r['expire_secs'] ?? 0),
        'expires_at'   => $r['expires_at'] ?? null,
        'reactions'    => $rx['counts'],
        'my_reaction'  => $rx['mine'],
    ];
}

function dm_list(PDO $pdo, string $deviceId, int $limit = MSG_LIST_LIMIT): array {
    dm_init_tables($pdo);
    dm_purge_expired($pdo);
    $limit = max(1, min(MSG_LIST_LIMIT, $limit));
    $st = $pdo->prepare(
        "SELECT id, sender_device, sender_user_id, recipient_device, recipient_user_id,
                body_enc, status, created_at, read_at, expire_secs, expires_at
         FROM user_messages
         WHERE (sender_device=? OR recipient_device=?)
           AND id NOT IN (SELECT message_id FROM user_message_deletes WHERE device_id=?)
         ORDER BY id DESC LIMIT ?");
    $st->bindValue(1, $deviceId);
    $st->bindValue(2, $deviceId);
    $st->bindValue(3, $deviceId);
    $st->bindValue(4, $limit, PDO::PARAM_INT);
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $reactionsByMsg = dm_reactions_for($pdo, array_column($rows, 'id'), $deviceId);

    $out = [];
    foreach ($rows as $r) $out[] = dm_row_to_message($r, $deviceId, $reactionsByMsg);
    return $out;
}

/**
 * Older messages in ONE thread (peer), for "load older" pagination --
 * dm_list() is a combined-all-peers window capped at MSG_LIST_LIMIT (200),
 * so once a device's total message count crosses that, older messages
 * silently vanish from every screen (found 2026-07-22, Khabat's chat audit).
 * This lets the client fetch further back in a single open thread on demand,
 * independent of that global cap. $peerParam accepts the same device_id /
 * user_id / referral_code forms dm_send()'s recipient does (resolved via
 * qe_resolve_device -- falls back to the raw param if resolution fails, so
 * history with a since-deleted account is still reachable). Newest-first,
 * same contract as dm_list(), caller prepends to its already-loaded thread.
 */
function dm_thread_before(PDO $pdo, string $deviceId, string $peerParam, int $beforeId, int $limit = 50): array {
    dm_init_tables($pdo);
    $limit = max(1, min(100, $limit));
    $peer = qe_resolve_device($pdo, $peerParam);
    $peerDevice = $peer ? $peer['device_id'] : $peerParam;
    $st = $pdo->prepare(
        "SELECT id, sender_device, sender_user_id, recipient_device, recipient_user_id,
                body_enc, status, created_at, read_at, expire_secs, expires_at
         FROM user_messages
         WHERE ((sender_device=? AND recipient_device=?) OR (sender_device=? AND recipient_device=?))
           AND id < ?
           AND id NOT IN (SELECT message_id FROM user_message_deletes WHERE device_id=?)
         ORDER BY id DESC LIMIT ?");
    $st->bindValue(1, $deviceId);
    $st->bindValue(2, $peerDevice);
    $st->bindValue(3, $peerDevice);
    $st->bindValue(4, $deviceId);
    $st->bindValue(5, $beforeId, PDO::PARAM_INT);
    $st->bindValue(6, $deviceId);
    $st->bindValue(7, $limit, PDO::PARAM_INT);
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $reactionsByMsg = dm_reactions_for($pdo, array_column($rows, 'id'), $deviceId);

    $out = [];
    foreach ($rows as $r) $out[] = dm_row_to_message($r, $deviceId, $reactionsByMsg);
    return $out;
}

/**
 * Server-side search fallback (2026-07-22, Khabat's chat audit) -- the
 * client's own search only covers dm_list()'s locally-cached 200-message
 * window, so anything older is silently unsearchable with no indication to
 * the user. Scans up to $scanLimit of this device's own most-recent messages
 * (bounded -- this box has 1GB RAM, an unbounded full-history decrypt+scan
 * isn't safe), decrypts and substring-matches server-side (bodies are
 * encrypted at rest, so this can't be a SQL WHERE body LIKE). stripos(), not
 * mbstring (host PHP lacks it, see dm_strlen's own comment) -- correct for
 * exact substring matches even in UTF-8, only loses case-folding for
 * non-Latin scripts, which don't have case anyway.
 */
function dm_search(PDO $pdo, string $deviceId, string $query, int $scanLimit = 1000, int $resultLimit = 50): array {
    dm_init_tables($pdo);
    $query = trim($query);
    if ($query === '') return [];
    $scanLimit   = max(1, min(2000, $scanLimit));
    $resultLimit = max(1, min(100, $resultLimit));
    $st = $pdo->prepare(
        "SELECT id, sender_device, sender_user_id, recipient_device, recipient_user_id,
                body_enc, status, created_at, read_at, expire_secs, expires_at
         FROM user_messages
         WHERE (sender_device=? OR recipient_device=?)
           AND id NOT IN (SELECT message_id FROM user_message_deletes WHERE device_id=?)
         ORDER BY id DESC LIMIT ?");
    $st->bindValue(1, $deviceId);
    $st->bindValue(2, $deviceId);
    $st->bindValue(3, $deviceId);
    $st->bindValue(4, $scanLimit, PDO::PARAM_INT);
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    $out = [];
    foreach ($rows as $r) {
        $body = dm_decrypt((string)$r['body_enc']);
        if ($body === '' || stripos($body, $query) === false) continue;
        $incoming = $r['recipient_device'] === $deviceId;
        $out[] = [
            'id'           => (int)$r['id'],
            'direction'    => $incoming ? 'in' : 'out',
            'peer_user_id' => $incoming ? ($r['sender_user_id']    ?: '') : ($r['recipient_user_id'] ?: ''),
            'peer_device'  => $incoming ?  $r['sender_device']            :  $r['recipient_device'],
            'body'         => $body,
            'created_at'   => $r['created_at'],
        ];
        if (count($out) >= $resultLimit) break;
    }
    return $out;
}

/**
 * Reaction summary for a batch of message ids, keyed by message_id:
 * ['counts' => ['👍'=>2,...], 'mine' => <this device's emoji or null>].
 * One query for the whole page (dm_list callers), not one per message.
 */
function dm_reactions_for(PDO $pdo, array $messageIds, string $deviceId): array {
    $messageIds = array_values(array_unique(array_map('intval', $messageIds)));
    if (!$messageIds) return [];
    dm_init_tables($pdo);
    $ph = implode(',', array_fill(0, count($messageIds), '?'));
    $st = $pdo->prepare("SELECT message_id, device_id, emoji FROM message_reactions WHERE message_id IN ($ph)");
    $st->execute($messageIds);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $mid = (int)$r['message_id'];
        if (!isset($out[$mid])) $out[$mid] = ['counts' => [], 'mine' => null];
        $emoji = (string)$r['emoji'];
        $out[$mid]['counts'][$emoji] = ($out[$mid]['counts'][$emoji] ?? 0) + 1;
        if ($r['device_id'] === $deviceId) $out[$mid]['mine'] = $emoji;
    }
    return $out;
}

/**
 * Toggle a reaction: tapping the same emoji again clears it, a different one
 * replaces it (one reaction per device per message — enforced by the table's
 * own primary key, not just this function). Only a participant (sender or
 * recipient) of the message may react to it. Returns the message's full,
 * fresh reaction summary — same shape dm_list() embeds, so the client never
 * has to guess whether its optimistic update matches the server.
 * Throws \RuntimeException with a client-safe message on any rejection.
 */
function dm_react(PDO $pdo, string $deviceId, int $messageId, string $emoji): array {
    dm_init_tables($pdo);
    if (!in_array($emoji, MSG_REACTIONS, true)) throw new \RuntimeException('invalid reaction');

    $chk = $pdo->prepare("SELECT 1 FROM user_messages WHERE id=? AND (sender_device=? OR recipient_device=?)");
    $chk->execute([$messageId, $deviceId, $deviceId]);
    if (!$chk->fetchColumn()) throw new \RuntimeException('message not found');

    $cur = $pdo->prepare("SELECT emoji FROM message_reactions WHERE message_id=? AND device_id=?");
    $cur->execute([$messageId, $deviceId]);
    $existing = $cur->fetchColumn();

    if ($existing === $emoji) {
        // Same emoji tapped again → clear.
        $pdo->prepare("DELETE FROM message_reactions WHERE message_id=? AND device_id=?")
            ->execute([$messageId, $deviceId]);
    } else {
        // No reaction yet, or a different one → set/replace (PK makes this
        // idempotent regardless of which case it is).
        $pdo->prepare(
            "INSERT INTO message_reactions (message_id, device_id, emoji) VALUES (?,?,?)
             ON CONFLICT(message_id, device_id) DO UPDATE SET emoji=excluded.emoji, created_at=datetime('now')"
        )->execute([$messageId, $deviceId, $emoji]);
    }

    $rx = dm_reactions_for($pdo, [$messageId], $deviceId)[$messageId] ?? ['counts' => [], 'mine' => null];
    return $rx;
}

/** Fire-and-forget upsert: this device is typing to $peer, right now. */
function dm_set_typing(PDO $pdo, string $deviceId, string $peer): void {
    dm_init_tables($pdo);
    $pdo->prepare(
        "INSERT INTO user_typing_status (device_id, peer, updated_at) VALUES (?,?,datetime('now'))
         ON CONFLICT(device_id, peer) DO UPDATE SET updated_at=datetime('now')"
    )->execute([$deviceId, $peer]);
}

/** True if $peer pinged set-typing (addressed to $deviceId) within the TTL.
 *  Directional: checks the row keyed (device_id=$peer, peer=$deviceId) —
 *  i.e. "is the OTHER party currently typing TO me". */
function dm_get_typing(PDO $pdo, string $deviceId, string $peer): bool {
    dm_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT 1 FROM user_typing_status
         WHERE device_id=? AND peer=? AND updated_at >= datetime('now', '-" . MSG_TYPING_TTL_SECS . " seconds')");
    $st->execute([$peer, $deviceId]);
    return (bool)$st->fetchColumn();
}

/** Hard-delete disappearing messages whose post-read timer has run out. This
 *  is the ONLY hard-delete path: body_enc is destroyed for both parties, and
 *  the per-user soft-delete markers for those rows are cleaned with them. */
function dm_purge_expired(PDO $pdo): void {
    $ids = $pdo->query(
        "SELECT id FROM user_messages
         WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')")
        ->fetchAll(PDO::FETCH_COLUMN);
    if (!$ids) return;
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $pdo->prepare("DELETE FROM user_messages WHERE id IN ($ph)")->execute($ids);
    $pdo->prepare("DELETE FROM user_message_deletes WHERE message_id IN ($ph)")->execute($ids);
}

/** Mark one received message read. Only the recipient can mark their own.
 *  Reading a disappearing message starts its burn timer: expires_at is stamped
 *  read_at + expire_secs and dm_purge_expired() removes it once due. */
function dm_mark_read(PDO $pdo, string $deviceId, int $messageId): bool {
    dm_init_tables($pdo);
    $st = $pdo->prepare(
        "UPDATE user_messages SET
            status='read',
            read_at=datetime('now'),
            expires_at = CASE WHEN expire_secs > 0
                              THEN datetime('now', '+' || expire_secs || ' seconds')
                              ELSE expires_at END
         WHERE id=? AND recipient_device=? AND status<>'read'");
    $st->execute([$messageId, $deviceId]);
    return $st->rowCount() > 0;
}

/** Soft-delete one message from this device's inbox only (per-user, v0.9.35).
 *  Only a participant (sender or recipient) may hide a message. Returns true if
 *  the device was a participant. The other party's copy and the encrypted body
 *  are left intact. */
function dm_delete_message(PDO $pdo, string $deviceId, int $messageId): bool {
    dm_init_tables($pdo);
    $chk = $pdo->prepare(
        "SELECT 1 FROM user_messages WHERE id=? AND (sender_device=? OR recipient_device=?)");
    $chk->execute([$messageId, $deviceId, $deviceId]);
    if (!$chk->fetchColumn()) return false;
    $pdo->prepare(
        "INSERT OR IGNORE INTO user_message_deletes (message_id, device_id) VALUES (?, ?)")
        ->execute([$messageId, $deviceId]);
    return true;
}

/** Soft-delete an entire thread (all messages with one peer) from this device's
 *  inbox only. Peer is matched by device_id or user_id on either side. Returns
 *  the number of messages hidden. */
function dm_delete_thread(PDO $pdo, string $deviceId, string $peer): int {
    dm_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT id FROM user_messages
         WHERE (sender_device=? OR recipient_device=?)
           AND (sender_device=? OR recipient_device=? OR sender_user_id=? OR recipient_user_id=?)");
    $st->execute([$deviceId, $deviceId, $peer, $peer, $peer, $peer]);
    $ids = $st->fetchAll(PDO::FETCH_COLUMN);
    if (!$ids) return 0;
    $ins = $pdo->prepare("INSERT OR IGNORE INTO user_message_deletes (message_id, device_id) VALUES (?, ?)");
    foreach ($ids as $id) $ins->execute([(int)$id, $deviceId]);
    return count($ids);
}

/** Count unread (incoming, status='sent') messages for a device. */
function dm_unread_count(PDO $pdo, string $deviceId): int {
    dm_init_tables($pdo);
    dm_purge_expired($pdo);
    $st = $pdo->prepare(
        "SELECT COUNT(*) FROM user_messages WHERE recipient_device=? AND status='sent'
           AND id NOT IN (SELECT message_id FROM user_message_deletes WHERE device_id=?)");
    $st->execute([$deviceId, $deviceId]);
    return (int)$st->fetchColumn();
}

/**
 * Admin overview — counts and delivery status only. NEVER selects body_enc, so
 * message content cannot leak into the admin panel (requirement #9).
 */
function dm_admin_stats(PDO $pdo, int $recentLimit = 50): array {
    dm_init_tables($pdo);
    $totals = $pdo->query(
        "SELECT
            COUNT(*)                                                   AS total,
            COALESCE(SUM(status='sent'),0)                             AS delivered_unread,
            COALESCE(SUM(status='read'),0)                             AS read_count,
            COALESCE(SUM(created_at >= datetime('now','-1 day')),0)    AS last_24h,
            COUNT(DISTINCT sender_device)                              AS senders,
            COUNT(DISTINCT recipient_device)                           AS recipients
         FROM user_messages")->fetch(PDO::FETCH_ASSOC) ?: [];

    // Recent activity: metadata only — IDs, status, time. No body, ever.
    $recentLimit = max(1, min(200, $recentLimit));
    $rs = $pdo->prepare(
        "SELECT id, sender_user_id, recipient_user_id, status, created_at, read_at
         FROM user_messages ORDER BY id DESC LIMIT ?");
    $rs->bindValue(1, $recentLimit, PDO::PARAM_INT);
    $rs->execute();

    return [
        'total'            => (int)($totals['total'] ?? 0),
        'delivered_unread' => (int)($totals['delivered_unread'] ?? 0),
        'read'             => (int)($totals['read_count'] ?? 0),
        'last_24h'         => (int)($totals['last_24h'] ?? 0),
        'senders'          => (int)($totals['senders'] ?? 0),
        'recipients'       => (int)($totals['recipients'] ?? 0),
        'recent'           => $rs->fetchAll(PDO::FETCH_ASSOC),
    ];
}
