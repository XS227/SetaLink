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

// Referral reward mode (plan item C3).
//   quota  grant VPN quota only
//   real   grant REAL to the party's linked account instead; NO linked
//          account ⇒ fall back to quota so nobody goes unrewarded
//   both   grant quota AND REAL — Khabat, 2026-07-28: switched default here
//          from 'quota' so the new Invite list UI (InvitedFriendsList.tsx)
//          can show a real, truthful REAL-token figure per invite, not just
//          GB. This is a genuine payout increase (both amounts, not a
//          split) — an unlinked invitee still gets their quota as before,
//          the REAL side is additive once/if they link an account.
const RE_REFERRAL_SETTING_DEFAULTS = [
    'referral_reward_mode' => 'both',
    'referral_real_reward' => '500',  // REAL granted per referral (real/both)
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
    // Ecosystem profile store: single source for avatar/handle/persona shared
    // across all REAL products. Written by ReaLink; read by Shahnameh, RealGram,
    // TrustAI, 3REAL. Authoritative once B-8 (JWT issuer) is live — callers
    // should prefer the JWT claims when present and fall back to this table.
    $pdo->exec("CREATE TABLE IF NOT EXISTS real_profiles (
        account      TEXT PRIMARY KEY,
        handle       TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        avatar_emoji TEXT NOT NULL DEFAULT '',
        avatar_color TEXT NOT NULL DEFAULT '',
        persona      TEXT NOT NULL DEFAULT '',
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    // ZAR→REAL conversion ledger (2026-07-27, contract per B->A(114)).
    // client_ref is the idempotency key — Shahnameh's /v1/zar-swap has none of
    // its own (a real, flagged gap: a double-tap or retried network call would
    // otherwise genuinely execute twice), so the panel proxy owns dedup here,
    // same UNIQUE-column pattern as real_redemptions.tx_ref above.
    $pdo->exec("CREATE TABLE IF NOT EXISTS zar_swaps (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id     TEXT NOT NULL,
        real_account  TEXT NOT NULL DEFAULT '',
        amount_real   REAL NOT NULL DEFAULT 0,
        client_ref    TEXT NOT NULL UNIQUE,
        status        TEXT NOT NULL DEFAULT 'pending',
        response_json TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_zar_swaps_device
                ON zar_swaps(device_id, created_at)");
}

// ── Ecosystem profile (cross-app shared identity) ─────────���───────────────────

/** Upsert a profile for the given REAL account. Only the non-empty fields are updated. */
function re_save_profile(PDO $pdo, string $account, array $fields): void {
    $allowed = ['handle','display_name','avatar_emoji','avatar_color','persona'];
    $sets = [];
    $vals = [];
    foreach ($allowed as $col) {
        if (isset($fields[$col]) && $fields[$col] !== '') {
            $sets[] = "$col = ?";
            $vals[] = (string)$fields[$col];
        }
    }
    if (empty($sets)) return;
    $sets[]  = "updated_at = datetime('now')";
    $vals[]  = $account;
    // INSERT default row first so UPDATE always has a target.
    $pdo->prepare("INSERT OR IGNORE INTO real_profiles (account) VALUES (?)")->execute([$account]);
    $pdo->prepare("UPDATE real_profiles SET " . implode(', ', $sets) . " WHERE account = ?")->execute($vals);
}

/** Read profile for the given REAL account. Returns [] if not found. */
function re_get_profile(PDO $pdo, string $account): array {
    $st = $pdo->prepare("SELECT account, handle, display_name, avatar_emoji, avatar_color, persona, updated_at FROM real_profiles WHERE account = ?");
    $st->execute([$account]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: [];
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
 * Admin-UI-safe view of re_service_config(): configured/not-configured
 * booleans for the two secrets (never the secret values themselves — same
 * masking convention as ton_indexer_configured elsewhere in this file), plus
 * the URL as-is since a base URL isn't sensitive. Lets Khabat confirm in
 * _setalink-admin that B-2 (docs/realgram/TASK_SPLIT.md, SetaLink repo) has
 * actually landed, without exposing real_link_secret/real_api_key in a
 * plaintext admin form field.
 */
function re_ecosystem_status(PDO $pdo): array {
    $cfg = re_service_config($pdo);
    return [
        'link_secret_configured' => $cfg['link_secret'] !== '',
        'api_url'                => $cfg['api_url'],
        'api_key_configured'     => $cfg['api_key'] !== '',
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

/**
 * REAL-ID Phase 2 (Khabat, 2026-07-19): every device gets a permanent
 * REAL-ID automatically — no Telegram widget, no external login in the
 * default flow. If the device already has a linked_real_account (either a
 * prior auto-generated id, or a real Telegram-verified one from
 * re_link_account()), that value wins unchanged. Telegram linking later
 * (existing flow, unmodified) simply overwrites this with the verified
 * account — re_link_account() already does an unconditional UPDATE, so
 * that upgrade path needed zero changes here.
 *
 * Format: 'device:<deviceId>' — matches Agent B's shahnameh-backend
 * convention exactly (main@272d17b, id_type:'real' bridging in
 * /user/sync), not an arbitrary format of my own — their side already
 * auto-creates a season2_users doc keyed on this exact shape.
 */
function re_ensure_real_id(PDO $pdo, string $deviceId): string {
    $existing = re_linked_account($pdo, $deviceId);
    if ($existing !== '') return $existing;

    $newId = 'device:' . $deviceId;
    // Guard the UPDATE on still-empty so a concurrent request racing the same
    // device can't clobber a value the other request just set.
    $st = $pdo->prepare(
        "UPDATE devices SET linked_real_account=?
         WHERE device_id=? AND (linked_real_account IS NULL OR linked_real_account='')"
    );
    $st->execute([$newId, $deviceId]);
    if ($st->rowCount() > 0) {
        try {
            $pdo->prepare(
                "UPDATE devices SET real_linked_at = datetime('now')
                 WHERE device_id = ? AND (real_linked_at IS NULL OR real_linked_at = '')"
            )->execute([$deviceId]);
        } catch (\Exception $_) {}
        return $newId;
    }
    // Lost the race — someone else's value is now there; use it instead.
    return re_linked_account($pdo, $deviceId);
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
 * Full wallet breakdown for the B-23 wallet UI: balance (REAL), zar, and
 * conversion_rate, straight from contract §3 v2 (shahnameh-backend
 * main@2fd2c7c, 2026-07-19) — re_fetch_balance() above only ever extracted
 * `balance` and silently dropped the other two fields. Same request shape,
 * kept as a separate function rather than changing re_fetch_balance()'s
 * return type, since nothing else calls it.
 */
function re_fetch_wallet_detail(PDO $pdo, string $realAccount): ?array {
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
    return [
        'balance'          => (float)$json['balance'],
        'zar'              => isset($json['zar']) && is_numeric($json['zar']) ? (float)$json['zar'] : null,
        'conversion_rate'  => isset($json['conversion_rate']) && is_numeric($json['conversion_rate'])
                               ? (float)$json['conversion_rate'] : null,
    ];
}

/**
 * One-call profile data for RealGram's native ProfileScreen (contract §9,
 * shahnameh-backend main@6b725e1) — identity/economy/streaks/achievements/
 * chapters/clan in a single round-trip, replacing the WebView-embedded
 * profile.html/guild.html as the data source. Same fail-open posture as
 * the wallet functions above: null means "service unconfigured/unreachable
 * /account not found", never a thrown exception — the app decides how to
 * degrade (e.g. show the WebView fallback) when this comes back null.
 */
// TEMPORARY (Khabat, 2026-07-21): profile_unavailable was reaching the app
// with zero diagnostic info server-side — every distinct failure mode
// (unreachable, timeout, non-200, malformed JSON, status!=1) collapsed to a
// bare null. Logs the real reason to /var/log/setalink/profile-summary-errors.log
// so a future occurrence is actually debuggable. Remove once this endpoint's
// reliability is confirmed stable (see TASK_SPLIT.md A→B(66)/(67)).
function re_profile_summary_log(string $account, string $reason, array $extra = []): void {
    $line = sprintf(
        "[%s] account=%s reason=%s %s\n",
        date('Y-m-d H:i:s'), $account, $reason, json_encode($extra, JSON_UNESCAPED_SLASHES)
    );
    @file_put_contents('/var/log/setalink/profile-summary-errors.log', $line, FILE_APPEND | LOCK_EX);
}

function re_fetch_profile_summary(PDO $pdo, string $realAccount): ?array {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) {
        re_profile_summary_log($realAccount, 'no_api_url_or_curl');
        return null;
    }

    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/profile-summary/' . rawurlencode($realAccount));
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
    $curlErr = curl_error($ch);
    curl_close($ch);
    if ($body === false || $http !== 200) {
        re_profile_summary_log($realAccount, 'http_or_curl_failure', [
            'http' => $http, 'curl_error' => $curlErr, 'body_snippet' => substr((string)$body, 0, 300),
        ]);
        return null;
    }

    $json = json_decode((string)$body, true);
    if (!is_array($json) || (int)($json['status'] ?? 0) !== 1) {
        re_profile_summary_log($realAccount, 'bad_status_or_shape', [
            'http' => $http, 'status_field' => $json['status'] ?? null,
            'body_snippet' => substr((string)$body, 0, 300),
        ]);
        return null;
    }
    return $json;
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

// ── ZAR→REAL conversion (2026-07-27, contract per B→A(114)) ────────────────────
// The ecosystem-API twin of Shahnameh's existing Mini App /user/zar-swap — same
// SystemConfig-driven rate/minimum, same account resolution as profile-summary.
// Idempotency is NOT built into the Shahnameh endpoint itself (a real, flagged
// gap on their side) — re_zar_swap_claim()/_store() below own that here, same
// UNIQUE-client_ref pattern as re_record()'s tx_ref.

/**
 * Call /v1/zar-swap. Deliberately does NOT own idempotency — see
 * re_zar_swap_claim() for that. Returns:
 *   ['ok'=>true, ...full response fields (new_zar, new_real_balance, rate, …)]
 *   ['ok'=>false, 'error'=>string]        structured denial (e.g. insufficient_zar)
 *   ['ok'=>false, 'error'=>'unavailable'] service missing/unreachable/malformed
 */
function re_zar_swap(PDO $pdo, string $realAccount, float $amountReal): array {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'unavailable'];
    }
    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/zar-swap');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['account' => $realAccount, 'amount_real' => $amountReal]),
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
    if (!is_array($json)) return ['ok' => false, 'error' => 'unavailable'];
    if ($http === 200 && (int)($json['status'] ?? 0) === 1) {
        return ['ok' => true] + $json;
    }
    if (!empty($json['error']) && is_string($json['error'])) {
        return ['ok' => false, 'error' => substr($json['error'], 0, 64)];
    }
    return ['ok' => false, 'error' => 'unavailable'];
}

/** Claim a client_ref before calling Shahnameh. Returns the new row id, or
 *  null if this client_ref was already claimed (caller should look it up
 *  instead of calling Shahnameh again). */
function re_zar_swap_claim(PDO $pdo, string $deviceId, string $realAccount,
                           float $amountReal, string $clientRef): ?int {
    $st = $pdo->prepare(
        "INSERT OR IGNORE INTO zar_swaps (device_id, real_account, amount_real, client_ref)
         VALUES (?,?,?,?)"
    );
    $st->execute([$deviceId, $realAccount, $amountReal, $clientRef]);
    return $st->rowCount() > 0 ? (int)$pdo->lastInsertId() : null;
}

/** Record the outcome of a claimed swap (status + full response, for idempotent replay). */
function re_zar_swap_store(PDO $pdo, int $id, string $status, array $response): void {
    $pdo->prepare("UPDATE zar_swaps SET status=?, response_json=? WHERE id=?")
        ->execute([$status, json_encode($response), $id]);
}

/** Look up a previously-claimed client_ref (duplicate request). Returns
 *  ['status'=>string, 'response'=>array] or null if the ref is unknown. */
function re_zar_swap_lookup(PDO $pdo, string $clientRef): ?array {
    $st = $pdo->prepare("SELECT id, status, response_json FROM zar_swaps WHERE client_ref=?");
    $st->execute([$clientRef]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    return [
        'id'       => (int)$row['id'],
        'status'   => $row['status'],
        'response' => $row['response_json'] !== '' ? (json_decode($row['response_json'], true) ?: []) : [],
    ];
}

// ── Ecosystem SSO (contract 6) ───────────────────────────────────────────────
// Shared single-sign-on for ALL REAL apps (Shahnameh, 3real, TrustAI, …), not
// just the embedded game. The ecosystem backend is the identity provider: it
// owns the accounts and holds an RS256 keypair; it mints a short-lived JWT for
// a linked account, and every ecosystem app verifies it with the published
// public key (JWKS) — no app but the issuer ever holds the signing key. The
// panel is a client: it authenticates the device (via the existing account
// link) and proxies the mint request, so the app never holds real_api_key and
// the whole thing fails safe (no token → the app loads the game as a guest /
// prompts to link) until the issuer (Agent B, task B-8) exists.

/**
 * Mint an SSO token for a device's linked REAL account (contract 6).
 * Returns:
 *   ['status'=>'ok', 'token'=>string, 'expires_in'=>int, 'account'=>string]
 *   ['status'=>'unlinked']                 device has no linked REAL account
 *   ['status'=>'unavailable']              issuer not configured/reachable yet
 */
function re_sso_token(PDO $pdo, string $deviceId, bool $allowRealIdFallback = false): array {
    // Phase 2, opt-in only (Agent B's design, matched exactly — this action
    // is shared with TrustAiLinkScreen, a separate product neither of us
    // owns, so the fallback must not change behavior for callers that don't
    // ask for it). $allowRealIdFallback=true auto-generates a permanent
    // REAL-ID instead of returning 'unlinked'; false preserves the exact
    // original behavior.
    $account = $allowRealIdFallback
        ? re_ensure_real_id($pdo, $deviceId)
        : re_linked_account($pdo, $deviceId);
    if ($account === '') return ['status' => 'unlinked'];

    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) {
        return ['status' => 'unavailable'];
    }
    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/sso-token');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    // Two request shapes now live on Agent B's side: {account,...} (original,
    // requires a pre-existing season2_users doc) and {real_id,...} (new,
    // find-or-creates via id_type:'real' bridging). The auto-fallback path
    // MUST use real_id — {account} 404s account_not_found for a brand-new id
    // even though it's the exact same string (confirmed live, 2026-07-19).
    $payload = $allowRealIdFallback
        ? ['real_id' => $account, 'device_id' => $deviceId]
        : ['account'  => $account, 'device_id' => $deviceId];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => RE_VERIFY_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => RE_VERIFY_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $http !== 200) return ['status' => 'unavailable'];

    $json = json_decode((string)$body, true);
    if (!is_array($json) || empty($json['token']) || !is_string($json['token'])) {
        return ['status' => 'unavailable'];
    }
    return [
        'status'      => 'ok',
        'token'       => $json['token'],
        'expires_in'  => isset($json['expires_in']) && is_numeric($json['expires_in'])
                        ? (int)$json['expires_in'] : 900,
        'account'     => $account,
        // B->A(132): resolved telegram_id for the /api/season2/* calls that
        // are keyed on it (clan join/apply/my-clan/contribute, heroes buy/
        // upgrade, earn claim/check-in) — the real DB-backed value for a
        // synced Season2User, or the same real_id fallback /user/sync's own
        // upsert will use on first sync, never a naive real_id===telegram_id
        // assumption (breaks once an account permanent-links to Telegram).
        'telegram_id' => isset($json['telegram_id']) ? (string)$json['telegram_id'] : '',
    ];
}

/**
 * Sync a batch of RealGram tap-to-earn taps to Shahnameh (contract §8,
 * docs/realgram/REALGRAM_UNIFIED_PLATFORM.md §B, Khabat 2026-07-19). The
 * app's tap button used to be purely local; this makes the server the one
 * source of truth for ZAR, same as the Mini App's own tap loop already is.
 *
 * Always resolves an account via re_ensure_real_id() (not
 * re_linked_account()) — ZAR-earning must work for a device that's never
 * linked Telegram, same reasoning as the REAL-ID SSO auto-fallback: there
 * is no product reason tapping the coin should require a Telegram account
 * to exist first.
 *
 * Returns:
 *   ['ok'=>true,  'zar'=>int, 'zar_earned'=>int, 'capped'=>bool]
 *   ['ok'=>false, 'error'=>string]          structured denial from Shahnameh
 *   ['ok'=>false, 'error'=>'unavailable']   service missing/unreachable/malformed
 */
function re_tap_sync(PDO $pdo, string $deviceId, int $taps): array {
    if ($taps <= 0) return ['ok' => false, 'error' => 'bad_request'];
    $account = re_ensure_real_id($pdo, $deviceId);

    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) {
        return ['ok' => false, 'error' => 'unavailable'];
    }
    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/tap-sync');
    $headers = ['Content-Type: application/json'];
    if ($cfg['api_key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['api_key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['account' => $account, 'taps' => $taps]),
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
    if ($http === 200 && is_array($json) && isset($json['zar']) && is_numeric($json['zar'])) {
        return [
            'ok'         => true,
            'zar'        => (int)$json['zar'],
            'zar_earned' => (int)($json['zar_earned'] ?? 0),
            'capped'     => (bool)($json['capped'] ?? false),
        ];
    }
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
 * Aggregate REAL/ZAR economy view for the admin panel's "REAL Wallet" page
 * (previously a "Coming soon" placeholder, docs/realgram/TASK_SPLIT.md
 * B→A(73)/(94)/(95)). Same fail-open posture as the other proxy functions
 * here: null means unconfigured/unreachable/malformed, never a thrown
 * exception — the admin page renders its own empty state on null.
 */
function re_fetch_economy_summary(PDO $pdo): ?array {
    $cfg = re_service_config($pdo);
    if ($cfg['api_url'] === '' || !function_exists('curl_init')) return null;

    $ch = curl_init(rtrim($cfg['api_url'], '/') . '/v1/economy-summary');
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
    if (!is_array($json) || (int)($json['status'] ?? 0) !== 1) return null;
    return $json;
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
