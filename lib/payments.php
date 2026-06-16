<?php
/**
 * Realink — Premium payments with USDT + REAL token (shared logic).
 *
 * REAL is the native Realink/SETAEI/Shahnameh ecosystem PAYMENT/UTILITY token,
 * offered at a configurable discount vs USDT. Compliance: utility token only — no
 * investment language anywhere in copy/config.
 *
 * Invariants: backend is source of truth; client payment status is never trusted;
 * confirmation is server-side on-chain verified; grants are idempotent on tx_hash.
 *
 * Included by public/v1.php (mobile), admin/api.php (config/metrics) and
 * scripts/test-payments.php. See docs/PREMIUM-REAL-PAYMENTS.md.
 */

require_once __DIR__ . '/quota_economy.php';

const PAY_METHODS = ['USDT', 'REAL'];

// ── Config (remote-tunable settings; no APK update) ──────────────────────────

function pay_defaults(): array {
    return [
        // REAL token (the ecosystem jetton)
        'real_token_address'        => 'EQDhq_DjQUMJqfXLP8K8J6SlOvon08XQQK0T49xon2e0xU8p',
        'real_destination_wallet'   => 'UQBWAwX1khMYZm3RobKKOm3460I6vLCA1c0wgb_68zdfBj5g',
        'real_decimals'             => 9,
        'real_discount_percent'     => 20,
        // USDT (chain not finalised — placeholders)
        'usdt_chain'                => 'ton',
        'usdt_token_address'        => 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
        'usdt_destination_wallet'   => 'UQBWAwX1khMYZm3RobKKOm3460I6vLCA1c0wgb_68zdfBj5g',
        'usdt_decimals'             => 6,
        'usdt_confirmations_required' => 1,
        // Flow
        'payment_window_secs'       => 1800,                       // 30-min intent validity
        'ton_indexer_url'           => 'https://toncenter.com/api/v2',
        'ton_indexer_key'           => '',                         // fill to enable auto-verify
    ];
}

function pay_config(PDO $pdo): array {
    $cfg  = pay_defaults();
    $keys = array_keys($cfg);
    $rows = [];
    try {
        $place = implode(',', array_fill(0, count($keys), '?'));
        $st = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($place)");
        $st->execute($keys);
        $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (\Exception $e) { $rows = []; }
    foreach ($cfg as $k => $v) {
        if (!isset($rows[$k]) || $rows[$k] === '') continue;
        if (is_int($v))        $cfg[$k] = (int)$rows[$k];
        elseif (is_float($v))  $cfg[$k] = (float)$rows[$k];
        else                   $cfg[$k] = (string)$rows[$k];
    }
    return $cfg;
}

/** Token address / recipient / decimals for a method, from config. */
function pay_method_params(array $cfg, string $method): array {
    if ($method === 'REAL') {
        return ['token' => $cfg['real_token_address'], 'wallet' => $cfg['real_destination_wallet'], 'decimals' => (int)$cfg['real_decimals']];
    }
    return ['token' => $cfg['usdt_token_address'], 'wallet' => $cfg['usdt_destination_wallet'], 'decimals' => (int)$cfg['usdt_decimals']];
}

// ── Schema + seed ─────────────────────────────────────────────────────────────

function pay_init_tables(PDO $pdo): void {
    qe_init_tables($pdo);

    $pdo->exec("CREATE TABLE IF NOT EXISTS premium_packages (
        package_id            TEXT PRIMARY KEY,
        gb_amount             INTEGER NOT NULL DEFAULT 0,
        usdt_price            REAL    NOT NULL DEFAULT 0,
        real_price            REAL    NOT NULL DEFAULT 0,
        real_discount_percent REAL    NOT NULL DEFAULT 0,
        is_recommended        INTEGER NOT NULL DEFAULT 0,
        is_active             INTEGER NOT NULL DEFAULT 1,
        display_order         INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )");

    $pdo->exec("CREATE TABLE IF NOT EXISTS payment_intents (
        payment_id         INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id          TEXT    NOT NULL,
        package_id         TEXT    NOT NULL,
        method             TEXT    NOT NULL,
        amount             REAL    NOT NULL DEFAULT 0,
        amount_units       INTEGER NOT NULL DEFAULT 0,
        token_address      TEXT    NOT NULL DEFAULT '',
        destination_wallet TEXT    NOT NULL DEFAULT '',
        memo               TEXT    NOT NULL DEFAULT '',
        gb_amount          INTEGER NOT NULL DEFAULT 0,
        status             TEXT    NOT NULL DEFAULT 'pending',
        tx_hash            TEXT    NOT NULL DEFAULT '',
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at         TEXT    NOT NULL,
        confirmed_at       TEXT
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_pi_device ON payment_intents(device_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_pi_status ON payment_intents(status)");
    // Idempotency: a real on-chain tx can settle at most one intent.
    $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pi_tx ON payment_intents(tx_hash) WHERE tx_hash <> ''");

    pay_seed_packages($pdo);
}

/** Seed the example ladder once (idempotent on package_id). Prices remote-editable after. */
function pay_seed_packages(PDO $pdo): void {
    $seed = [
        ['prem_10gb', 10, 3.0,  2.40, 20, 0, 1],
        ['prem_25gb', 25, 6.0,  4.80, 20, 1, 2],  // recommended
        ['prem_50gb', 50, 10.0, 8.00, 20, 0, 3],
    ];
    $ins = $pdo->prepare(
        "INSERT OR IGNORE INTO premium_packages
            (package_id, gb_amount, usdt_price, real_price, real_discount_percent, is_recommended, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)");
    foreach ($seed as $s) $ins->execute($s);
}

// ── Packages ───────────────────────────────────────────────────────────────────

/** Active packages for the app (ordered). Discount % derived for display safety. */
function pay_packages(PDO $pdo, bool $activeOnly = true): array {
    pay_init_tables($pdo);
    $sql = "SELECT * FROM premium_packages" . ($activeOnly ? " WHERE is_active=1" : "") . " ORDER BY display_order, gb_amount";
    return array_map(static function ($r) {
        $usdt = (float)$r['usdt_price']; $real = (float)$r['real_price'];
        $disc = $usdt > 0 ? round((1 - $real / $usdt) * 100, 1) : (float)$r['real_discount_percent'];
        return [
            'package_id'            => $r['package_id'],
            'gb_amount'             => (int)$r['gb_amount'],
            'usdt_price'            => $usdt,
            'real_price'            => $real,
            'real_discount_percent' => $disc,
            'is_recommended'        => (int)$r['is_recommended'] === 1,
            'is_active'             => (int)$r['is_active'] === 1,
            'display_order'         => (int)$r['display_order'],
        ];
    }, $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC));
}

function pay_get_package(PDO $pdo, string $packageId): ?array {
    $st = $pdo->prepare("SELECT * FROM premium_packages WHERE package_id=? AND is_active=1");
    $st->execute([$packageId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ?: null;
}

// ── Intent ──────────────────────────────────────────────────────────────────────

/** Create a pending payment intent. Server computes price — client never sets it. */
function pay_create_intent(PDO $pdo, string $deviceId, string $packageId, string $method, array $cfg): array {
    pay_init_tables($pdo);
    if ($deviceId === '')                     throw new \RuntimeException('missing device_id');
    if (!in_array($method, PAY_METHODS, true)) throw new \RuntimeException('invalid payment_method');
    $pkg = pay_get_package($pdo, $packageId);
    if (!$pkg) throw new \RuntimeException('unknown or inactive package');

    $price    = $method === 'REAL' ? (float)$pkg['real_price'] : (float)$pkg['usdt_price'];
    if ($price <= 0) throw new \RuntimeException('package not priced for this method');
    $mp       = pay_method_params($cfg, $method);
    $units    = (int)round($price * (10 ** $mp['decimals']));
    $window   = max(60, (int)$cfg['payment_window_secs']);

    $pdo->prepare(
        "INSERT INTO payment_intents
            (device_id, package_id, method, amount, amount_units, token_address, destination_wallet, memo, gb_amount, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'pending', datetime('now', ? || ' seconds'))"
    )->execute([$deviceId, $packageId, $method, $price, $units, $mp['token'], $mp['wallet'], (int)$pkg['gb_amount'], '+' . $window]);
    $id   = (int)$pdo->lastInsertId();
    $memo = 'RLK-' . $id . '-' . substr(bin2hex(random_bytes(4)), 0, 6);
    $pdo->prepare("UPDATE payment_intents SET memo=? WHERE payment_id=?")->execute([$memo, $id]);

    return pay_public_intent(pay_intent($pdo, $id));
}

/** Public-facing intent payload for the app. */
function pay_public_intent(array $i): array {
    return [
        'payment_id'         => (int)$i['payment_id'],
        'method'             => $i['method'],
        'amount'             => (float)$i['amount'],
        'amount_units'       => (int)$i['amount_units'],
        'token_address'      => $i['token_address'],
        'destination_wallet' => $i['destination_wallet'],
        'memo'               => $i['memo'],
        'gb_amount'          => (int)$i['gb_amount'],
        'status'             => $i['status'],
        'expires_at'         => $i['expires_at'],
    ];
}

/** Expire stale pending intents, then return the row. */
function pay_intent(PDO $pdo, int $paymentId): ?array {
    $pdo->prepare("UPDATE payment_intents SET status='expired'
                   WHERE status='pending' AND expires_at < datetime('now')")->execute();
    $st = $pdo->prepare("SELECT * FROM payment_intents WHERE payment_id=?");
    $st->execute([$paymentId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ?: null;
}

// ── On-chain verification ─────────────────────────────────────────────────────

/**
 * Pure matcher: does an observed jetton transfer satisfy this intent?
 * $transfer keys: jetton_master, recipient, amount_units, comment, utime (optional).
 * @return array{0:bool,1:string} [ok, reason]
 */
function pay_validate_transfer(array $intent, array $transfer, array $cfg): array {
    if (($transfer['jetton_master'] ?? '') !== $intent['token_address'])        return [false, 'wrong_token_address'];
    if (($transfer['recipient'] ?? '') !== $intent['destination_wallet'])       return [false, 'wrong_recipient'];
    if ((int)($transfer['amount_units'] ?? 0) < (int)$intent['amount_units'])   return [false, 'insufficient_amount'];
    if ((string)($transfer['comment'] ?? '') !== (string)$intent['memo'])       return [false, 'memo_mismatch'];
    if (isset($transfer['utime'])) {
        $created = strtotime($intent['created_at'] . ' UTC');
        $expires = strtotime($intent['expires_at'] . ' UTC') + 600; // 10-min grace
        $t = (int)$transfer['utime'];
        if ($t < $created - 600 || $t > $expires) return [false, 'outside_window'];
    }
    return [true, ''];
}

/**
 * Fetch incoming jetton transfers to the destination wallet from the TON indexer and
 * return the first that matches this intent. Returns null if indexer not configured or
 * no match. NEVER trusts client input — re-reads the chain. Best-effort/no-throw.
 */
function pay_verify_onchain(PDO $pdo, array $intent, array $cfg): ?array {
    if (($cfg['ton_indexer_key'] ?? '') === '') return null; // auto-verify disabled
    $url = rtrim($cfg['ton_indexer_url'], '/') . '/getTransactions'
         . '?address=' . urlencode($intent['destination_wallet'])
         . '&limit=40&api_key=' . urlencode($cfg['ton_indexer_key']);
    $ctx = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return null;
    $j = json_decode($raw, true);
    foreach (($j['result'] ?? []) as $tx) {
        $transfer = pay_extract_jetton_transfer($tx);
        if (!$transfer) continue;
        [$ok] = pay_validate_transfer($intent, $transfer, $cfg);
        if ($ok) return $transfer + ['tx_hash' => (string)($tx['transaction_id']['hash'] ?? $transfer['tx_hash'] ?? '')];
    }
    return null;
}

/**
 * Normalise an indexer transaction into the matcher's transfer shape. Indexer schemas
 * vary; this isolates that parsing so pay_validate_transfer stays pure/testable.
 */
function pay_extract_jetton_transfer(array $tx): ?array {
    $in = $tx['in_msg'] ?? null;
    if (!is_array($in)) return null;
    return [
        'jetton_master' => (string)($in['source'] ?? ''),          // refined per real indexer
        'recipient'     => (string)($in['destination'] ?? ''),
        'amount_units'  => (int)($in['value'] ?? 0),
        'comment'       => (string)($in['message'] ?? $in['comment'] ?? ''),
        'utime'         => (int)($tx['utime'] ?? 0),
        'tx_hash'       => (string)($tx['transaction_id']['hash'] ?? ''),
    ];
}

// ── Confirmation (idempotent, server-authoritative) ─────────────────────────────

/**
 * Confirm a payment and grant quota. Idempotent: a re-confirm of the same intent, or a
 * tx_hash already used by ANY intent, never double-grants. Returns a status array.
 */
function pay_confirm(PDO $pdo, int $paymentId, string $txHash, array $cfg): array {
    pay_init_tables($pdo);
    $own = !$pdo->inTransaction();
    if ($own) $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM payment_intents WHERE payment_id=?");
        $st->execute([$paymentId]);
        $i = $st->fetch(PDO::FETCH_ASSOC);
        if (!$i) { if ($own) $pdo->commit(); return ['status' => 'not_found']; }

        if ($i['status'] === 'confirmed') {           // idempotent
            if ($own) $pdo->commit();
            return ['status' => 'confirmed', 'already' => true, 'gb_amount' => (int)$i['gb_amount']];
        }
        if ($i['status'] === 'expired') { if ($own) $pdo->commit(); return ['status' => 'expired']; }

        // tx_hash already used by another intent → reject (no double grant).
        if ($txHash !== '') {
            $dup = $pdo->prepare("SELECT payment_id FROM payment_intents WHERE tx_hash=? AND payment_id<>?");
            $dup->execute([$txHash, $paymentId]);
            if ($dup->fetchColumn()) { if ($own) $pdo->commit(); return ['status' => 'rejected', 'reason' => 'tx_already_used']; }
        }

        $type     = $i['method'] === 'REAL' ? 'purchase_real' : 'purchase_usdt';
        $bytes    = (int)$i['gb_amount'] * QE_GB;
        $newTotal = qe_credit_payment($pdo, $i['device_id'], $i['package_id'], $bytes, $type, $paymentId, $txHash);
        $pdo->prepare("UPDATE payment_intents SET status='confirmed', tx_hash=?, confirmed_at=datetime('now') WHERE payment_id=?")
            ->execute([$txHash, $paymentId]);
        if ($own) $pdo->commit();
        return ['status' => 'confirmed', 'gb_amount' => (int)$i['gb_amount'], 'new_quota_total' => $newTotal];
    } catch (\Exception $e) {
        if ($own && $pdo->inTransaction()) $pdo->rollBack();
        // A unique-index race on tx_hash → duplicate (no double grant). Anything else
        // is a real error: surface it rather than silently mislabelling as duplicate.
        if (stripos($e->getMessage(), 'unique') !== false) {
            return ['status' => 'rejected', 'reason' => 'tx_already_used'];
        }
        return ['status' => 'error', 'reason' => 'confirm_failed'];
    }
}

/**
 * Status check used by the app's "Check payment" button. Expires stale intents, then
 * (for a still-pending one) attempts on-chain verification and confirms on success.
 * Client tx_hash is only a lookup hint; the server re-verifies on-chain.
 */
function pay_check(PDO $pdo, int $paymentId, array $cfg): array {
    $i = pay_intent($pdo, $paymentId);
    if (!$i) return ['status' => 'not_found'];
    if ($i['status'] !== 'pending') {
        return ['status' => $i['status'], 'gb_amount' => (int)$i['gb_amount'],
                'new_quota_total' => null];
    }
    $match = pay_verify_onchain($pdo, $i, $cfg);
    if ($match === null) return ['status' => 'pending', 'verified' => false];
    return pay_confirm($pdo, $paymentId, (string)($match['tx_hash'] ?? ''), $cfg);
}
