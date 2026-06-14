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
    // Best-effort persist; 0600 so only the web user can read it.
    $old = umask(0077);
    @file_put_contents($path, $key);
    @chmod($path, 0600);
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
function dm_send(PDO $pdo, string $senderDevice, string $recipientParam, string $body): array {
    dm_init_tables($pdo);

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
            (sender_device, sender_user_id, recipient_device, recipient_user_id, body_enc, status)
         VALUES (?,?,?,?,?, 'sent')"
    )->execute([
        $senderDevice,
        (string)($sender['user_id'] ?? ''),
        $receiver['device_id'],
        (string)($receiver['user_id'] ?? ''),
        dm_encrypt($body),
    ]);
    $id = (int)$pdo->lastInsertId();

    return [
        'message_id'        => $id,
        'recipient_device'  => $receiver['device_id'],
        'recipient_user_id' => (string)($receiver['user_id'] ?? ''),
        'created_at'        => date('Y-m-d H:i:s'),
        'status'            => 'sent',
    ];
}

/**
 * Unified inbox/outbox for a device, newest first. Bodies are decrypted here;
 * `direction` is 'in' (received) or 'out' (sent). Unread = incoming with
 * status='sent'. Peer is identified only by SetaLink user_id / device_id.
 */
function dm_list(PDO $pdo, string $deviceId, int $limit = MSG_LIST_LIMIT): array {
    dm_init_tables($pdo);
    $limit = max(1, min(MSG_LIST_LIMIT, $limit));
    $st = $pdo->prepare(
        "SELECT id, sender_device, sender_user_id, recipient_device, recipient_user_id,
                body_enc, status, created_at, read_at
         FROM user_messages
         WHERE sender_device=? OR recipient_device=?
         ORDER BY id DESC LIMIT ?");
    $st->bindValue(1, $deviceId);
    $st->bindValue(2, $deviceId);
    $st->bindValue(3, $limit, PDO::PARAM_INT);
    $st->execute();
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $incoming = $r['recipient_device'] === $deviceId;
        $out[] = [
            'id'           => (int)$r['id'],
            'direction'    => $incoming ? 'in' : 'out',
            'peer_user_id' => $incoming ? ($r['sender_user_id']    ?: '') : ($r['recipient_user_id'] ?: ''),
            'peer_device'  => $incoming ?  $r['sender_device']            :  $r['recipient_device'],
            'body'         => dm_decrypt((string)$r['body_enc']),
            'read'         => $r['status'] === 'read' || !$incoming,
            'created_at'   => $r['created_at'],
        ];
    }
    return $out;
}

/** Mark one received message read. Only the recipient can mark their own. */
function dm_mark_read(PDO $pdo, string $deviceId, int $messageId): bool {
    dm_init_tables($pdo);
    $st = $pdo->prepare(
        "UPDATE user_messages SET status='read', read_at=datetime('now')
         WHERE id=? AND recipient_device=? AND status<>'read'");
    $st->execute([$messageId, $deviceId]);
    return $st->rowCount() > 0;
}

/** Count unread (incoming, status='sent') messages for a device. */
function dm_unread_count(PDO $pdo, string $deviceId): int {
    dm_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT COUNT(*) FROM user_messages WHERE recipient_device=? AND status='sent'");
    $st->execute([$deviceId]);
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
