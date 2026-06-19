<?php
// Backend tests for rewarded ads + hidden recovery quota (lib/ads_recovery.php).
// Runs against a throwaway in-memory SQLite DB using the real functions.
// Exit code 0 = all pass. See docs/REWARDED-ADS-RECOVERY.md §10.

require_once __DIR__ . '/../lib/ads_recovery.php';

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
        quota_bytes_total INTEGER DEFAULT 1073741824, quota_bytes_used INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0, stealth_unlocked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')), last_seen TEXT)");
    $db->exec("CREATE TABLE referral_uses (id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_device_id TEXT, new_device_id TEXT, bonus_bytes INTEGER DEFAULT 0, status TEXT DEFAULT 'credited')");
    $db->exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT)");
    ar_init_tables($db);
    return $db;
}
function mk_device(PDO $db, string $id, int $total, int $used = 0, string $createdAt = null): void {
    $db->prepare("INSERT INTO devices (device_id, user_id, quota_bytes_total, quota_bytes_used, created_at)
                  VALUES (?,?,?,?,COALESCE(?, datetime('now')))")
       ->execute([$id, 'SL-' . strtoupper($id), $total, $used, $createdAt]);
}
function vis_used(PDO $db, string $id): int {
    $st = $db->prepare("SELECT quota_bytes_used FROM devices WHERE device_id=?"); $st->execute([$id]);
    return (int)$st->fetchColumn();
}
function rec_used(PDO $db, string $id): int {
    $st = $db->prepare("SELECT recovery_used_bytes FROM devices WHERE device_id=?"); $st->execute([$id]);
    return (int)$st->fetchColumn();
}

$MB  = 1048576;
$cfg = ar_defaults();
$cfg['ad_cooldown_secs'] = 0;            // isolate cap from cooldown in tests
$cfg['recovery_exit_uuid'] = 'test-uuid'; // pretend the recovery node is configured

// ── 1. quota > 0 → normal mode, recovery not eligible ─────────────────────────
echo "1. Normal mode when quota > 0:\n";
$db = fresh_db();
mk_device($db, 'normal', 1073741824, 0);
$st = ar_recovery_state($db, 'normal', $cfg);
check('eligible=false when quota remains', $st['eligible'], false);

// ── 2. quota == 0 → recovery eligible ─────────────────────────────────────────
echo "2. Recovery eligible at 0 GB:\n";
$db = fresh_db();
mk_device($db, 'empty', 1073741824, 1073741824); // fully used
$st = ar_recovery_state($db, 'empty', $cfg);
check('eligible=true at zero visible', $st['eligible'], true);
check('reserve remaining = default 512MB', $st['recovery_remaining_bytes'], 536870912);

// ── 3. Ad reward grants from recovery state ───────────────────────────────────
echo "3. Ad reward grant:\n";
$db = fresh_db();
mk_device($db, 'ad1', 1073741824, 1073741824);
ar_init_reward($db, 'ad1', 'nonce-A', '9.9.9.1', $cfg);
$r = ar_confirm_reward($db, 'ad1', 'nonce-A', 'client', false, $cfg);
check('granted=true', $r['granted'], true);
check('reward = 250MB', $r['reward_bytes'], 262144000);
$st = $db->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?"); $st->execute(['ad1']);
check('visible total increased by reward', (int)$st->fetchColumn(), 1073741824 + 262144000);

// ── 4. Duplicate ad callback does NOT double-grant ────────────────────────────
echo "4. Idempotent confirm:\n";
$dup = ar_confirm_reward($db, 'ad1', 'nonce-A', 'ssv', true, $cfg);
check('second confirm granted=false', $dup['granted'], false);
check('second confirm flagged already', $dup['already'] ?? false, true);
$st = $db->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?"); $st->execute(['ad1']);
check('total unchanged after duplicate', (int)$st->fetchColumn(), 1073741824 + 262144000);

// ── 5. Daily ad cap enforced ──────────────────────────────────────────────────
echo "5. Daily cap:\n";
$db = fresh_db();
mk_device($db, 'cap', 1073741824, 1073741824);
for ($i = 0; $i < (int)$cfg['ad_daily_cap']; $i++) {
    ar_init_reward($db, 'cap', "n$i", '9.9.9.2', $cfg);
    ar_confirm_reward($db, 'cap', "n$i", 'client', false, $cfg);
}
[$ok, $reason] = ar_can_reward($db, 'cap', $cfg);
check('capped after daily_cap videos', $ok, false);
check('reason = daily_cap_reached', $reason, 'daily_cap_reached');
$over = ar_confirm_reward($db, 'cap', 'n-over', 'client', false, $cfg);
check('over-cap confirm rejected', $over['rejected'] ?? '', 'daily_cap_reached');

// ── 6. Hidden reserve never shown as visible/normal balance ───────────────────
echo "6. Hidden reserve hidden:\n";
$db = fresh_db();
mk_device($db, 'hide', 1073741824, 1073741824);
$st = ar_recovery_state($db, 'hide', $cfg);
check('visible_remaining = 0 (reserve not folded in)', $st['visible_remaining_bytes'], 0);
check('reserve is separate field', $st['recovery_remaining_bytes'], 536870912);

// ── 7. Suspicious repeated ad events → review (not banned) ─────────────────────
echo "7. Fraud → review:\n";
$db = fresh_db();
$badIp = '5.5.5.5';
// 5 distinct devices already claimed from this IP today → ip_cluster (+60)
for ($i = 0; $i < 5; $i++) {
    mk_device($db, "decoy$i", 1073741824, 0);
    $db->prepare("INSERT INTO ad_reward_events (device_id,nonce,status,client_ip) VALUES (?,?,'pending',?)")
       ->execute(["decoy$i", "d$i", $badIp]);
}
mk_device($db, 'fraud', 1073741824, 1073741824, gmdate('Y-m-d H:i:s')); // new device (+20) ⇒ ≥75
ar_init_reward($db, 'fraud', 'nonce-F', $badIp, $cfg);
$rf = ar_confirm_reward($db, 'fraud', 'nonce-F', 'client', false, $cfg);
check('high-risk reward held for review', $rf['review'] ?? false, true);
check('no quota granted on review', vis_used($db, 'fraud') >= 0 && ($rf['granted'] ?? false), false);
$rev = (int)$db->query("SELECT COUNT(*) FROM ad_reward_events WHERE status='review'")->fetchColumn();
check('event marked review (not banned)', $rev, 1);

// ── 8. Recovery metering + allowlist (no general-internet abuse) ───────────────
echo "8. Recovery metering & allowlist:\n";
$db = fresh_db();
mk_device($db, 'rec', 1073741824, 1073741824);
$enter = ar_recovery_enter($db, 'rec', $cfg);
check('recovery profile carries throttle', $enter['profile']['throttle_kbps'], 512);
check('recovery token issued', strlen($enter['token']) > 0, true);
ar_meter_recovery($db, 'rec', 100 * $MB);
check('recovery bytes charged to reserve', rec_used($db, 'rec'), 100 * $MB);
check('recovery bytes NOT charged to visible', vis_used($db, 'rec'), 1073741824);
$al = ar_allowlist();
foreach (['t.me', 'google.com', 'tonkeeper.com', 'setalink.no'] as $dom) {
    check("allowlist includes $dom", in_array($dom, $al, true), true);
}
// reserve exhaustion → no longer eligible (forces ad/pay/referral)
ar_meter_recovery($db, 'rec', 500 * $MB);
$st = ar_recovery_state($db, 'rec', $cfg);
check('reserve exhausted → not eligible', $st['eligible'], false);

echo "\n" . ($fail === 0 ? "ALL $pass PASSED\n" : "$fail FAILED, $pass passed\n");
exit($fail === 0 ? 0 : 1);
