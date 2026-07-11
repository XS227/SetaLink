<?php
/**
 * REAL Token Economy — phase 1: redemption ledger + rate settings.
 *
 * Implements A1 of mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md. Shahnameh
 * activity earns REAL; redeeming REAL for VPN quota happens in phase 2 via a
 * server-verified redeem endpoint. This phase only lays the bookkeeping that
 * endpoint must go through.
 *
 * Design invariant (mirrors quota_economy.php): quota is NEVER mutated from a
 * REAL redemption without a real_redemptions row, and tx_ref is the
 * idempotency key so a retried request can't credit twice.
 *
 * Statuses (real_redemptions.status):
 *   pending    redemption received, ecosystem backend not yet confirmed
 *   credited   REAL spend verified server-to-server, quota granted via
 *              qe_ledger_add (type 'promotion' until a dedicated type ships)
 *   rejected   verification failed or admin denied
 */

const RE_GB = 1073741824;

// Admin-editable rate settings (settings table), created with these defaults.
const RE_SETTING_DEFAULTS = [
    'real_per_gb'            => '100',          // REAL cost for 1 GB of quota
    'redeem_min_real'        => '50',           // smallest accepted REAL spend
    'redeem_daily_cap_bytes' => '10737418240',  // 10 GB per device per day
];

function re_ensure_schema(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS real_redemptions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id    TEXT NOT NULL,
        real_account TEXT NOT NULL DEFAULT '',
        real_amount  REAL NOT NULL DEFAULT 0,
        quota_bytes  INTEGER NOT NULL DEFAULT 0,
        tx_ref       TEXT NOT NULL UNIQUE,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_real_redemptions_device
                ON real_redemptions(device_id, created_at)");
    $ins = $pdo->prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    foreach (RE_SETTING_DEFAULTS as $k => $v) $ins->execute([$k, $v]);
}

/** Current redemption rates; missing keys fall back to the defaults above. */
function re_settings(PDO $pdo): array {
    $keys = array_keys(RE_SETTING_DEFAULTS);
    $in   = implode(',', array_fill(0, count($keys), '?'));
    $st   = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($in)");
    $st->execute($keys);
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
    return [
        'real_per_gb'            => (float)($rows['real_per_gb'] ?? RE_SETTING_DEFAULTS['real_per_gb']),
        'redeem_min_real'        => (float)($rows['redeem_min_real'] ?? RE_SETTING_DEFAULTS['redeem_min_real']),
        'redeem_daily_cap_bytes' => (int)($rows['redeem_daily_cap_bytes'] ?? RE_SETTING_DEFAULTS['redeem_daily_cap_bytes']),
    ];
}

/** Bytes already redeemed by a device in the last 24h (daily-cap check). */
function re_redeemed_today(PDO $pdo, string $deviceId): int {
    $st = $pdo->prepare(
        "SELECT COALESCE(SUM(quota_bytes),0) FROM real_redemptions
         WHERE device_id=? AND status IN ('pending','credited')
           AND created_at >= datetime('now','-1 day')"
    );
    $st->execute([$deviceId]);
    return (int)$st->fetchColumn();
}

/**
 * Record a redemption attempt. Returns the ledger row id, or null when tx_ref
 * was already recorded (idempotent retry — caller must NOT credit again).
 * Quota is not touched here; crediting happens only on status transition to
 * 'credited' by the phase-2 endpoint / an admin, alongside qe_ledger_add.
 */
function re_record(PDO $pdo, string $deviceId, string $realAccount,
                   float $realAmount, int $quotaBytes, string $txRef): ?int {
    $st = $pdo->prepare(
        "INSERT OR IGNORE INTO real_redemptions
         (device_id, real_account, real_amount, quota_bytes, tx_ref)
         VALUES (?,?,?,?,?)"
    );
    $st->execute([$deviceId, $realAccount, $realAmount, $quotaBytes, $txRef]);
    return $st->rowCount() > 0 ? (int)$pdo->lastInsertId() : null;
}

/** Recent redemptions for the admin read-only view. */
function re_list(PDO $pdo, int $limit = 100): array {
    $limit = max(1, min(500, $limit));
    return $pdo->query(
        "SELECT id, device_id, real_account, real_amount, quota_bytes,
                tx_ref, status, created_at
         FROM real_redemptions ORDER BY id DESC LIMIT $limit"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
}
