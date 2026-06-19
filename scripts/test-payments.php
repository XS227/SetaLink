<?php
// Backend tests for premium payments (USDT + REAL). In-memory SQLite, real
// lib/payments.php functions. Exit 0 = all pass. docs/PREMIUM-REAL-PAYMENTS.md §8.

require_once __DIR__ . '/../lib/payments.php';

$pass = 0; $fail = 0;
function check(string $name, $got, $want) {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name — got " . var_export($got, true) . ", want " . var_export($want, true) . "\n"; }
}

function fresh_db(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec("CREATE TABLE devices (
        device_id TEXT PRIMARY KEY, user_id TEXT DEFAULT '', referral_code TEXT DEFAULT '',
        quota_bytes_total INTEGER DEFAULT 0, quota_bytes_used INTEGER DEFAULT 0,
        plan TEXT DEFAULT 'free', blocked INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))");
    $db->exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT)");
    // referral_uses always exists in prod (init_device_tables); qe_backfill reads it.
    $db->exec("CREATE TABLE referral_uses (id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_device_id TEXT, new_device_id TEXT, bonus_bytes INTEGER DEFAULT 0, status TEXT DEFAULT 'credited')");
    pay_init_tables($db);
    return $db;
}
function mk_device(PDO $db, string $id): void {
    $db->prepare("INSERT INTO devices (device_id, quota_bytes_total) VALUES (?, 0)")->execute([$id]);
}
function dev_total(PDO $db, string $id): int {
    $st = $db->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?"); $st->execute([$id]);
    return (int)$st->fetchColumn();
}
function ledger_type_sum(PDO $db, string $id, string $type): int {
    $st = $db->prepare("SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE device_id=? AND type=?");
    $st->execute([$id, $type]);
    return (int)$st->fetchColumn();
}

$GB = QE_GB;
$db = fresh_db();
$cfg = pay_config($db);

// ── 1. REAL package cheaper than USDT ─────────────────────────────────────────
echo "1. REAL discount:\n";
$pkgs = pay_packages($db);
check('seeded 3 packages', count($pkgs), 3);
foreach ($pkgs as $p) {
    check("REAL < USDT for {$p['package_id']}", $p['real_price'] < $p['usdt_price'], true);
    check("discount ~20% for {$p['package_id']}", round($p['real_discount_percent']), 20.0);
}
$rec = array_values(array_filter($pkgs, fn($p) => $p['is_recommended']));
check('one recommended package', count($rec), 1);

// ── 2. Payment intent creation ────────────────────────────────────────────────
echo "2. Intent creation:\n";
mk_device($db, 'buyer');
$intent = pay_create_intent($db, 'buyer', 'prem_25gb', 'REAL', $cfg);
check('intent has payment_id', $intent['payment_id'] > 0, true);
check('method REAL', $intent['method'], 'REAL');
check('amount = real_price 4.80', $intent['amount'], 4.80);
check('amount_units = 4.80 * 1e9', $intent['amount_units'], 4800000000);
check('token = REAL jetton', $intent['token_address'], 'EQDhq_DjQUMJqfXLP8K8J6SlOvon08XQQK0T49xon2e0xU8p');
check('gb_amount 25', $intent['gb_amount'], 25);
check('memo present', strncmp($intent['memo'], 'RLK-', 4) === 0, true);
check('status pending', $intent['status'], 'pending');

// ── 3. Expired payment ────────────────────────────────────────────────────────
echo "3. Expiry:\n";
$db->prepare("UPDATE payment_intents SET expires_at=datetime('now','-1 hour') WHERE payment_id=?")
   ->execute([$intent['payment_id']]);
$exp = pay_check($db, (int)$intent['payment_id'], $cfg);
check('expired status', $exp['status'], 'expired');
check('no quota granted on expiry', dev_total($db, 'buyer'), 0);

// ── 5/6. wrong token / wrong amount rejected (pure matcher) ───────────────────
echo "5/6. Transfer validation:\n";
mk_device($db, 'buyer2');
$i2 = pay_create_intent($db, 'buyer2', 'prem_10gb', 'REAL', $cfg);
$full = $db->prepare("SELECT * FROM payment_intents WHERE payment_id=?"); $full->execute([$i2['payment_id']]);
$irow = $full->fetch(PDO::FETCH_ASSOC);
$good = ['jetton_master' => $irow['token_address'], 'recipient' => $irow['destination_wallet'],
         'amount_units' => (int)$irow['amount_units'], 'comment' => $irow['memo']];
check('valid transfer ok', pay_validate_transfer($irow, $good, $cfg)[0], true);
check('wrong token rejected', pay_validate_transfer($irow, array_merge($good, ['jetton_master' => 'EQwrong']), $cfg)[1], 'wrong_token_address');
check('low amount rejected', pay_validate_transfer($irow, array_merge($good, ['amount_units' => 1]), $cfg)[1], 'insufficient_amount');
check('wrong memo rejected', pay_validate_transfer($irow, array_merge($good, ['comment' => 'RLK-999-x']), $cfg)[1], 'memo_mismatch');

// ── 7. Confirmed REAL grants correct GB ───────────────────────────────────────
echo "7. REAL grant:\n";
$rr = pay_confirm($db, (int)$i2['payment_id'], 'txREAL001', $cfg);
check('confirmed', $rr['status'], 'confirmed');
check('granted 10 GB', dev_total($db, 'buyer2'), 10 * $GB);
check('ledger purchase_real = 10 GB', ledger_type_sum($db, 'buyer2', 'purchase_real'), 10 * $GB);

// ── 4. Duplicate tx_hash cannot double-grant ──────────────────────────────────
echo "4. Duplicate tx:\n";
$reconf = pay_confirm($db, (int)$i2['payment_id'], 'txREAL001', $cfg);  // same intent again
check('re-confirm idempotent', $reconf['already'] ?? false, true);
check('still 10 GB after re-confirm', dev_total($db, 'buyer2'), 10 * $GB);
mk_device($db, 'buyer3');
$i3 = pay_create_intent($db, 'buyer3', 'prem_10gb', 'REAL', $cfg);
$dupTry = pay_confirm($db, (int)$i3['payment_id'], 'txREAL001', $cfg);  // reuse another's tx
check('duplicate tx rejected', $dupTry['status'], 'rejected');
check('reason tx_already_used', $dupTry['reason'] ?? '', 'tx_already_used');
check('buyer3 got nothing', dev_total($db, 'buyer3'), 0);

// ── Safe defaults: USDT disabled until configured; auto-verify off w/o indexer ──
echo "Safe defaults:\n";
$def = pay_defaults();
check('REAL enabled by default', pay_method_ready($def, 'REAL'), true);
check('USDT disabled by default', pay_method_ready($def, 'USDT'), false);
mk_device($db, 'buyerU0');
$blocked = false;
try { pay_create_intent($db, 'buyerU0', 'prem_10gb', 'USDT', $def); }
catch (\RuntimeException $e) { $blocked = (strpos($e->getMessage(), 'not available') !== false); }
check('USDT intent refused when disabled', $blocked, true);
check('auto-verify off without indexer key', $def['ton_indexer_key'] === '', true);

// ── 8. Confirmed USDT grants correct GB (USDT explicitly enabled) ─────────────
echo "8. USDT grant:\n";
$cfgU = $cfg; $cfgU['usdt_enabled'] = 1;   // operator enabled USDT after confirming chain/wallet
mk_device($db, 'buyer4');
$iu = pay_create_intent($db, 'buyer4', 'prem_50gb', 'USDT', $cfgU);
check('USDT amount = 10', $iu['amount'], 10.0);
check('USDT units = 10 * 1e6', $iu['amount_units'], 10000000);
$ru = pay_confirm($db, (int)$iu['payment_id'], 'txUSDT001', $cfg);
check('USDT confirmed', $ru['status'], 'confirmed');
check('granted 50 GB', dev_total($db, 'buyer4'), 50 * $GB);
check('ledger purchase_usdt = 50 GB', ledger_type_sum($db, 'buyer4', 'purchase_usdt'), 50 * $GB);

echo "\n" . ($fail === 0 ? "ALL $pass PASSED\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
