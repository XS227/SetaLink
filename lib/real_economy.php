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
 *
 * Phase 2 (A2): account linking + the server-verified redeem endpoint.
 * Both external trust anchors are settings-driven and FAIL CLOSED:
 *   real_link_secret  HMAC key shared with the ecosystem backend; empty =
 *                     linking disabled (a proof we can't verify links nothing).
 *   real_api_url/key  spend-verification service; unconfigured or unreachable
 *                     leaves the redemption 'pending' for admin review — the
 *                     app is never credited on client claims alone.
 */

const RE_GB = 1073741824;
const RE_VERIFY_TIMEOUT_SECS = 5;
const RE_LINK_PROOF_MAX_AGE_SECS = 600;

// Admin-editable rate settings (settings table), created with these defaults.
const RE_SETTING_DEFAULTS = [
    'real_per_gb'            => '100',          // REAL cost for 1 GB of quota
    'redeem_min_real'        => '50',           // smallest accepted REAL spend
    'redeem_daily_cap_bytes' => '10737418240',  // 10 GB per device per day
];

// Referral reward mode (plan item C3). Default 'quota' = the current +1 GB
// behaviour, unchanged, so flipping this on is a deliberate admin action.
//   quota  grant VPN quota only (today's behaviour)
//   real   grant REAL to the party's linked account instead; NO linked
//          account ⇒ fall back to quota so nobody goes unrewarded
//   both   grant quota AND REAL
const RE_REFERRAL_SETTING_DEFAULTS = [
    'referral_reward_mode' => 'quota',
    'referral_real_reward' => '100',  // REAL granted per referral (real/both)
];

// Service settings (never returned to the admin UI alongside the rates).
const RE_SERVICE_SETTING_DEFAULTS = [
    'real_link_secret' => '',  // HMAC-SHA256 key for account-link proofs
    'real_api_url'     => '',  // ecosystem backend base URL, empty = manual review
    'real_api_key'     => '',
];

function re_ensure_schema(PDO $pdo): void {
    // Same schema as admin/api.php — the public API path may hit a fresh DB
    // before the admin panel ever ran.
    $pdo->exec('CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "",
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
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
    // kind distinguishes a user-initiated redeem (REAL → quota, default) from a
    // referral grant (system → REAL payout). Both share this ledger so the
    // admin view and audit trail stay single-source.
    try { $pdo->exec("ALTER TABLE real_redemptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'redeem'"); }
    catch (\Exception $e) { /* column exists */ }
    $ins = $pdo->prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    foreach (RE_SETTING_DEFAULTS as $k => $v) $ins->execute([$k, $v]);
    foreach (RE_SERVICE_SETTING_DEFAULTS as $k => $v) $ins->execute([$k, $v]);
    foreach (RE_REFERRAL_SETTING_DEFAULTS as $k => $v) $ins->execute([$k, $v]);
    try { $pdo->exec("ALTER TABLE devices ADD COLUMN linked_real_account TEXT DEFAULT ''"); }
    catch (\Exception $e) { /* column exists */ }
}

/** Referral reward config (plan C3). */
function re_referral_settings(PDO $pdo): array {
    $keys = array_keys(RE_REFERRAL_SETTING_DEFAULTS);
    $in   = implode(',', array_fill(0, count($keys), '?'));
    $st   = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($in)");
    $st->execute($keys);
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
    $mode = (string)($rows['referral_reward_mode'] ?? RE_REFERRAL_SETTING_DEFAULTS['referral_reward_mode']);
    if (!in_array($mode, ['quota', 'real', 'both'], true)) $mode = 'quota';
    return [
        'mode'        => $mode,
        'real_reward' => (float)($rows['referral_real_reward'] ?? RE_REFERRAL_SETTING_DEFAULTS['referral_real_reward']),
    ];
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
                tx_ref, status, kind, created_at
         FROM real_redemptions ORDER BY id DESC LIMIT $limit"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

// ── Phase 2 (A2): account linking ────────────────────────────────────────────

function re_service_config(PDO $pdo): array {
    $keys = array_keys(RE_SERVICE_SETTING_DEFAULTS);
    $in   = implode(',', array_fill(0, count($keys), '?'));
    $st   = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($in)");
    $st->execute($keys);
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
    return [
        'link_secret' => trim((string)($rows['real_link_secret'] ?? '')),
        'api_url'     => trim((string)($rows['real_api_url'] ?? '')),
        'api_key'     => trim((string)($rows['real_api_key'] ?? '')),
    ];
}

/**
 * Verify a signed account-link proof issued by the ecosystem backend.
 * sig = HMAC-SHA256_hex(device_id . '|' . real_account . '|' . ts, real_link_secret)
 * ts is a unix timestamp; proofs older than RE_LINK_PROOF_MAX_AGE_SECS (or from
 * the future) are replays. Empty secret = linking disabled, nothing verifies.
 */
function re_verify_link_proof(PDO $pdo, string $deviceId, string $realAccount,
                              int $ts, string $sig): bool {
    $cfg = re_service_config($pdo);
    if ($cfg['link_secret'] === '' || $sig === '') return false;
    if (abs(time() - $ts) > RE_LINK_PROOF_MAX_AGE_SECS) return false;
    $expected = hash_hmac('sha256', $deviceId . '|' . $realAccount . '|' . $ts, $cfg['link_secret']);
    return hash_equals($expected, strtolower($sig));
}

/** Store the verified link. Returns false when the device doesn't exist. */
function re_link_account(PDO $pdo, string $deviceId, string $realAccount): bool {
    $st = $pdo->prepare("UPDATE devices SET linked_real_account=? WHERE device_id=?");
    $st->execute([$realAccount, $deviceId]);
    return $st->rowCount() > 0;
}

function re_linked_account(PDO $pdo, string $deviceId): string {
    $st = $pdo->prepare("SELECT linked_real_account FROM devices WHERE device_id=?");
    $st->execute([$deviceId]);
    return (string)($st->fetchColumn() ?: '');
}

// ── Phase 2 (A2): server-verified redemption ─────────────────────────────────

/**
 * Verify a REAL spend against the ecosystem backend (server-to-server).
 * Returns true (spend confirmed), false (backend explicitly denies — reject),
 * or null (unconfigured/unreachable/malformed — keep the redemption pending).
 */
function re_verify_spend(PDO $pdo, string $realAccount, float $realAmount, string $txRef): ?bool {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) return null;

    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/verify-spend');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'account' => $realAccount, 'amount' => $realAmount, 'tx_ref' => $txRef,
        ]),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => RE_VERIFY_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => RE_VERIFY_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $http !== 200) return null;

    $json = json_decode((string)$body, true);
    if (!is_array($json) || !array_key_exists('verified', $json)) return null;
    return (bool)$json['verified'];
}

function re_get(PDO $pdo, int $id): ?array {
    $st = $pdo->prepare("SELECT * FROM real_redemptions WHERE id=?");
    $st->execute([$id]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

function re_get_by_tx(PDO $pdo, string $txRef): ?array {
    $st = $pdo->prepare("SELECT * FROM real_redemptions WHERE tx_ref=?");
    $st->execute([$txRef]);
    return $st->fetch(PDO::FETCH_ASSOC) ?: null;
}

/**
 * Credit a pending redemption: status → credited + quota granted through the
 * ledger, atomically. Only pending rows transition (the WHERE guard makes a
 * concurrent double-credit a no-op). Returns the new quota_bytes_total, or
 * null when the row wasn't pending.
 */
function re_credit(PDO $pdo, int $id): ?int {
    $row = re_get($pdo, $id);
    if (!$row) return null;
    // Referral grants pay REAL, not quota — they must go through the grant
    // approval path, never this quota-crediting one.
    if (($row['kind'] ?? 'redeem') === 'referral_grant') return null;
    $ownTxn = !$pdo->inTransaction();
    if ($ownTxn) $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("UPDATE real_redemptions SET status='credited' WHERE id=? AND status='pending'");
        $st->execute([$id]);
        if ($st->rowCount() === 0) { if ($ownTxn) $pdo->rollBack(); return null; }
        $total = qe_ledger_add($pdo, $row['device_id'], 'promotion', (int)$row['quota_bytes'],
                               'REAL redeem tx ' . $row['tx_ref']);
        if ($ownTxn) $pdo->commit();
        return $total;
    } catch (\Exception $e) {
        if ($ownTxn && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/** Reject a pending redemption. Returns true when a row transitioned. */
function re_reject(PDO $pdo, int $id): bool {
    $st = $pdo->prepare("UPDATE real_redemptions SET status='rejected' WHERE id=? AND status='pending'");
    $st->execute([$id]);
    return $st->rowCount() > 0;
}

// ── Phase 2 (A2/A3): wallet proxy against the ecosystem backend ──────────────
// Contracts 3–4 in docs/realgram/TASK_SPLIT.md. The app never talks to the
// Shahnameh backend or holds real_api_key — the panel proxies, and every
// function here degrades to null/unavailable when the service is missing.

/** REAL balance for an account, or null when the service can't answer. */
function re_fetch_balance(PDO $pdo, string $realAccount): ?float {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) return null;

    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/balance/' . rawurlencode($realAccount));
    $headers = [];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => RE_VERIFY_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => RE_VERIFY_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $http !== 200) return null;

    $json = json_decode((string)$body, true);
    if (!is_array($json) || !isset($json['balance']) || !is_numeric($json['balance'])) return null;
    return (float)$json['balance'];
}

/**
 * Debit REAL from an account (contract 4). Idempotent on $idempotencyKey —
 * the Shahnameh side must return the same tx_ref for a retried key.
 * Returns:
 *   ['ok'=>true,  'tx_ref'=>string, 'balance_after'=>?float]
 *   ['ok'=>false, 'error'=>string]          structured denial (e.g. insufficient_balance)
 *   ['ok'=>false, 'error'=>'unavailable']   service missing/unreachable/malformed
 */
function re_spend(PDO $pdo, string $realAccount, float $realAmount, string $idempotencyKey): array {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'unavailable'];
    }
    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/spend');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'account'         => $realAccount,
            'amount'          => $realAmount,
            'purpose'         => 'vpn_quota',
            'idempotency_key' => $idempotencyKey,
        ]),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => RE_VERIFY_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => RE_VERIFY_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false) return ['ok' => false, 'error' => 'unavailable'];

    $json = json_decode((string)$body, true);
    if ($http === 200 && is_array($json) && !empty($json['tx_ref']) && is_string($json['tx_ref'])) {
        return [
            'ok'            => true,
            'tx_ref'        => $json['tx_ref'],
            'balance_after' => isset($json['balance_after']) && is_numeric($json['balance_after'])
                               ? (float)$json['balance_after'] : null,
        ];
    }
    // Structured denial (4xx with an error field) is a real answer, not an outage.
    if ($http >= 400 && $http < 500 && is_array($json) && !empty($json['error']) && is_string($json['error'])) {
        return ['ok' => false, 'error' => substr($json['error'], 0, 64)];
    }
    return ['ok' => false, 'error' => 'unavailable'];
}

/**
 * Validate a redeem request and price it. Shared by redeem-real (pre-executed
 * spend) and redeem-real-spend (panel-orchestrated spend). Returns
 * ['error'=>string] or ['account'=>, 'quota_bytes'=>, 'rates'=>].
 */
function re_quote(PDO $pdo, string $deviceId, float $realAmount): array {
    $account = re_linked_account($pdo, $deviceId);
    if ($account === '') return ['error' => 'no linked REAL account'];
    $rates = re_settings($pdo);
    if ($rates['real_per_gb'] <= 0) return ['error' => 'redemption disabled'];
    if ($realAmount < $rates['redeem_min_real']) {
        return ['error' => 'minimum spend is ' . $rates['redeem_min_real'] . ' REAL'];
    }
    $quotaBytes = (int)floor($realAmount / $rates['real_per_gb'] * RE_GB);
    if ($quotaBytes <= 0) return ['error' => 'amount too small'];
    if (re_redeemed_today($pdo, $deviceId) + $quotaBytes > $rates['redeem_daily_cap_bytes']) {
        return ['error' => 'daily redemption cap reached'];
    }
    return ['account' => $account, 'quota_bytes' => $quotaBytes, 'rates' => $rates];
}

// ── Phase 2 (C3): REAL referral grants (payout, not spend) ───────────────────
// A grant is the inverse of a spend: the ecosystem credits REAL to a linked
// account. Contract 5 in docs/realgram/TASK_SPLIT.md. Recorded in the shared
// real_redemptions ledger with kind='referral_grant' so grants and redeems
// stay in one auditable place; quota_bytes stays 0 (a pure REAL payout, no
// VPN quota moves — so it never counts against the redeem daily cap either).

/**
 * Credit REAL to an account via the ecosystem backend (contract 5).
 * Idempotent on $txRef. Returns true (granted), false (backend denied), or
 * null (unconfigured/unreachable/malformed — grant stays pending).
 */
function re_grant_real(PDO $pdo, string $realAccount, float $realAmount, string $txRef): ?bool {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) return null;

    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/grant');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'account'         => $realAccount,
            'amount'          => $realAmount,
            'reason'          => 'referral_reward',
            'idempotency_key' => $txRef,
        ]),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => RE_VERIFY_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => RE_VERIFY_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $http !== 200) return null;

    $json = json_decode((string)$body, true);
    if (!is_array($json) || !array_key_exists('granted', $json)) return null;
    return (bool)$json['granted'];
}

/**
 * Record + attempt a REAL referral grant for one party. tx_ref is deterministic
 * (referral code + recipient) so a re-run of use-referral can't double-grant.
 * Returns the final status ('credited' | 'pending' | 'rejected' | 'skipped').
 * 'skipped' means the party had no linked REAL account — the caller should
 * fall back to a quota grant so nobody goes unrewarded.
 */
function re_referral_grant(PDO $pdo, string $deviceId, float $realAmount, string $txRef): string {
    $account = re_linked_account($pdo, $deviceId);
    if ($account === '') return 'skipped';

    // Insert the grant row (kind=referral_grant, quota_bytes=0). OR IGNORE on
    // the unique tx_ref makes a retry a no-op.
    $st = $pdo->prepare(
        "INSERT OR IGNORE INTO real_redemptions
         (device_id, real_account, real_amount, quota_bytes, tx_ref, status, kind)
         VALUES (?,?,?,0,?,'pending','referral_grant')"
    );
    $st->execute([$deviceId, $account, $realAmount, $txRef]);
    if ($st->rowCount() === 0) {
        // Already recorded on a prior run — return its current status.
        $prev = re_get_by_tx($pdo, $txRef);
        return $prev['status'] ?? 'pending';
    }
    $id = (int)$pdo->lastInsertId();

    $verdict = re_grant_real($pdo, $account, $realAmount, $txRef);
    if ($verdict === true) {
        $pdo->prepare("UPDATE real_redemptions SET status='credited' WHERE id=? AND status='pending'")
            ->execute([$id]);
        return 'credited';
    }
    if ($verdict === false) {
        $pdo->prepare("UPDATE real_redemptions SET status='rejected' WHERE id=? AND status='pending'")
            ->execute([$id]);
        return 'rejected';
    }
    return 'pending';  // backend unavailable — admin can approve later
}

/**
 * Admin approval of a pending referral grant: retry the REAL grant against the
 * ecosystem backend and credit on success. Returns 'credited', 'pending'
 * (backend still unreachable), 'rejected', or null (row isn't a pending grant).
 * This is the recovery path for grants recorded while the backend was down.
 */
function re_approve_grant(PDO $pdo, int $id): ?string {
    $row = re_get($pdo, $id);
    if (!$row || ($row['kind'] ?? '') !== 'referral_grant' || $row['status'] !== 'pending') return null;
    $verdict = re_grant_real($pdo, $row['real_account'], (float)$row['real_amount'], $row['tx_ref']);
    if ($verdict === true) {
        $pdo->prepare("UPDATE real_redemptions SET status='credited' WHERE id=? AND status='pending'")->execute([$id]);
        return 'credited';
    }
    if ($verdict === false) {
        $pdo->prepare("UPDATE real_redemptions SET status='rejected' WHERE id=? AND status='pending'")->execute([$id]);
        return 'rejected';
    }
    return 'pending';
}
