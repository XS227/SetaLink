<?php
/**
 * SetaLink/RealGram global chat — one shared room every user can post in
 * (Khabat, 2026-07-31: "på social så kan det være en social chat der alle
 * brukere av realgram kan skrive i men begrensning på antall meldinger pr
 * minut ... så det ikke blir kaos der").
 *
 * Deliberately simpler than lib/messaging.php's 1:1 DMs: this content is
 * public by design (everyone in the room can already read it), so bodies
 * are stored plain, not encrypted-at-rest like DM bodies are. Rate limit
 * is tighter than DMs (GC_MAX_PER_MIN vs messaging.php's MSG_MAX_PER_MIN)
 * — a spammy DM only bothers one recipient, a spammy global-chat message
 * bothers everyone in the room at once.
 *
 * display_name is client-supplied and denormalized onto each row (not
 * looked up server-side) — this box's own devices table has no real
 * username concept (RealGram identity/handle lives client-side,
 * identityStore), and pulling one from the separate Shahnameh service per
 * message would mean a cross-service call on every send/read. Same trust
 * model DM bodies already have (sender-supplied content, not otherwise
 * validated) — only the RATE and LENGTH are enforced server-side, not the
 * content itself.
 */

const GC_MAX_LEN     = 500;   // shorter than DM's 2000 — a chat room, not a letter
const GC_MAX_PER_MIN = 3;     // per device, rolling 60s — the actual anti-chaos ask
const GC_MAX_PER_DAY = 100;   // per device, rolling 24h
const GC_LIST_LIMIT  = 100;

function gc_init_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS global_chat_messages (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id     TEXT NOT NULL,
        display_name  TEXT NOT NULL DEFAULT '',
        body          TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_gc_created ON global_chat_messages(id DESC)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_gc_device  ON global_chat_messages(device_id, created_at)");
}

function gc_strlen(string $s): int {
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

/** Throws \RuntimeException with a client-safe message on any rejection. */
function gc_send(PDO $pdo, string $deviceId, string $displayName, string $body): array {
    gc_init_tables($pdo);

    $body = trim($body);
    if ($body === '')                    throw new \RuntimeException('message is empty');
    if (gc_strlen($body) > GC_MAX_LEN)   throw new \RuntimeException('message too long');

    $displayName = trim($displayName);
    if (gc_strlen($displayName) > 40) $displayName = mb_substr($displayName, 0, 40);

    $rl = $pdo->prepare(
        "SELECT
            COALESCE(SUM(created_at >= datetime('now','-60 seconds')),0) AS m,
            COALESCE(SUM(created_at >= datetime('now','-1 day')),0)      AS d
         FROM global_chat_messages WHERE device_id=?"
    );
    $rl->execute([$deviceId]);
    $counts = $rl->fetch();
    if ((int)($counts['m'] ?? 0) >= GC_MAX_PER_MIN) throw new \RuntimeException('rate_limited_minute');
    if ((int)($counts['d'] ?? 0) >= GC_MAX_PER_DAY) throw new \RuntimeException('rate_limited_day');

    $ins = $pdo->prepare(
        "INSERT INTO global_chat_messages (device_id, display_name, body) VALUES (?, ?, ?)"
    );
    $ins->execute([$deviceId, $displayName, $body]);
    $id = (int)$pdo->lastInsertId();

    $row = $pdo->prepare("SELECT id, device_id, display_name, body, created_at FROM global_chat_messages WHERE id=?");
    $row->execute([$id]);
    return $row->fetch();
}

/** Most recent messages, newest first (client reverses for display). */
function gc_recent(PDO $pdo, int $limit = 50, ?int $beforeId = null): array {
    gc_init_tables($pdo);
    $limit = max(1, min(GC_LIST_LIMIT, $limit));
    if ($beforeId !== null) {
        $st = $pdo->prepare(
            "SELECT id, device_id, display_name, body, created_at FROM global_chat_messages
             WHERE id < ? ORDER BY id DESC LIMIT ?"
        );
        $st->execute([$beforeId, $limit]);
    } else {
        $st = $pdo->prepare(
            "SELECT id, device_id, display_name, body, created_at FROM global_chat_messages
             ORDER BY id DESC LIMIT ?"
        );
        $st->execute([$limit]);
    }
    return $st->fetchAll();
}
