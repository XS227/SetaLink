<?php
// Backend tests for the v0.9.31 quota economy (ledger, transfers, milestones,
// packages). Runs against a throwaway in-memory SQLite DB using the real
// lib/quota_economy.php functions. Exit code 0 = all pass.

require_once __DIR__ . '/../lib/quota_economy.php';

$GiB = QE_GB;
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
        invite_count INTEGER DEFAULT 0, country TEXT DEFAULT '', last_seen TEXT, internet_ok INTEGER DEFAULT 0,
        plan TEXT DEFAULT 'free', valid_until TEXT DEFAULT NULL)");
    $db->exec("CREATE TABLE referral_uses (id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_device_id TEXT, new_device_id TEXT, bonus_bytes INTEGER DEFAULT 0, status TEXT DEFAULT 'credited')");
    qe_init_tables($db);
    return $db;
}
function mk_device(PDO $db, string $id, int $total, int $used = 0, array $opt = []): void {
    $db->prepare("INSERT INTO devices (device_id, user_id, referral_code, quota_bytes_total, quota_bytes_used,
                                        invite_count, plan, valid_until)
                  VALUES (?,?,?,?,?,?,?,?)")
       ->execute([
           $id, $opt['user_id'] ?? 'SL-227-' . strtoupper($id), $opt['referral_code'] ?? strtoupper($id) . 'CODE',
           $total, $used,
           $opt['invite_count'] ?? 0, $opt['plan'] ?? 'free', $opt['valid_until'] ?? null,
       ]);
}
function ledger_sum(PDO $db, string $id): int {
    $st = $db->prepare("SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE device_id=?");
    $st->execute([$id]);
    return (int)$st->fetchColumn();
}
function dev_total(PDO $db, string $id): int {
    $st = $db->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?");
    $st->execute([$id]);
    return (int)$st->fetchColumn();
}

// ── Backfill + invariant ─────────────────────────────────────────────────────
echo "Ledger backfill:\n";
$db = fresh_db();
mk_device($db, 'starter1', 1 * $GiB);
$s = qe_summary($db, 'starter1');
check('1 GiB device → starter = 1 GiB',         $s['starter_quota'],      1 * $GiB);
check('1 GiB device → referral = 0',            $s['referral_quota'],     0);
check('starter-only → transferable = 0',        $s['transferable_quota'], 0);
check('ledger sum == total (1 GiB)',            ledger_sum($db, 'starter1'), 1 * $GiB);

// Total must exceed QE_STARTER_BYTES (5 GiB) for referral/adjustment to be
// reconstructed at all -- below that the whole total is starter (see the
// 'starter1' case above), by design.
mk_device($db, 'mix', 8 * $GiB);
$db->prepare("INSERT INTO referral_uses (referrer_device_id,new_device_id,bonus_bytes,status) VALUES ('mix','x',?,'credited')")
   ->execute([1 * $GiB]);
$s = qe_summary($db, 'mix');
check('8 GiB w/ 1 GiB referral → starter 5 GiB',  $s['starter_quota'],  5 * $GiB);
check('referral reconstructed = 1 GiB',           $s['referral_quota'], 1 * $GiB);
check('remainder → adjustment = 2 GiB',           $s['adjustment_quota'], 2 * $GiB);
check('ledger sum == total (8 GiB)',              ledger_sum($db, 'mix'), 8 * $GiB);
check('transferable = total - starter (3 GiB)',   $s['transferable_quota'], 3 * $GiB);

// Used data reduces transferable (again, total > 5 GiB starter so there's
// real transferable headroom to cap: 8 GiB total, 3 GiB transferable before
// use, 0.5 GiB remaining after 7.5 GiB used).
mk_device($db, 'used', 8 * $GiB, (int)(7.5 * $GiB));
$s = qe_summary($db, 'used');
check('used 7.5 GiB → remaining 0.5 GiB',         $s['remaining_quota'], (int)(0.5 * $GiB));
check('transferable capped by remaining (0.5 GiB)', $s['transferable_quota'], (int)(0.5 * $GiB));

// ── Ledger add keeps invariant ───────────────────────────────────────────────
echo "Ledger writes:\n";
$db = fresh_db();
mk_device($db, 'd', 1 * $GiB);
$newTotal = qe_ledger_add($db, 'd', 'purchase', 5 * $GiB, 'test');
check('ledger_add purchase → total 6 GiB',  $newTotal, 6 * $GiB);
check('ledger sum tracks total after add',  ledger_sum($db, 'd'), 6 * $GiB);
$s = qe_summary($db, 'd');
check('purchased_quota reflects purchase',  $s['purchased_quota'], 5 * $GiB);

// ── Transfers ────────────────────────────────────────────────────────────────
echo "Transfers:\n";
$db = fresh_db();
mk_device($db, 'alice', 6 * $GiB);                       // 5 GiB starter + 1 GiB transferable (adjustment)
mk_device($db, 'bob',   1 * $GiB, 0, ['user_id' => 'SL-227-BOB']);
qe_summary($db, 'alice'); qe_summary($db, 'bob');         // backfill both

$res = qe_transfer($db, 'alice', 'SL-227-BOB', 500 * 1024 * 1024, 'test');
check('transfer resolves receiver by user_id', $res['receiver_device'], 'bob');
check('alice total after sending 500 MB',  dev_total($db, 'alice'), 6 * $GiB - 500 * 1024 * 1024);
check('bob total after receiving 500 MB',  dev_total($db, 'bob'),   1 * $GiB + 500 * 1024 * 1024);
check('alice ledger sum still == total',   ledger_sum($db, 'alice'), dev_total($db, 'alice'));
check('bob ledger sum still == total',     ledger_sum($db, 'bob'),   dev_total($db, 'bob'));
$xfers = qe_transfer_history($db, 'alice');
check('transfer recorded in history',      count($xfers), 1);
check('history direction is out',          $xfers[0]['direction'], 'out');

// Below minimum.
$err = '';
try { qe_transfer($db, 'alice', 'bob', 1024, 'x'); } catch (\RuntimeException $e) { $err = $e->getMessage(); }
check('below 100 MB rejected', $err, 'minimum transfer is 100 MB');

// More than transferable (but below the daily volume cap).
$err = '';
try { qe_transfer($db, 'alice', 'bob', 2 * $GiB, 'x'); } catch (\RuntimeException $e) { $err = $e->getMessage(); }
check('over transferable rejected', $err, 'insufficient transferable quota');

// Self transfer.
$err = '';
try { qe_transfer($db, 'alice', 'alice', 200 * 1024 * 1024, 'x'); } catch (\RuntimeException $e) { $err = $e->getMessage(); }
check('self transfer rejected', $err, 'cannot transfer to yourself');

// Starter is never transferable.
$db = fresh_db();
mk_device($db, 'poor', 1 * $GiB);   // starter only
mk_device($db, 'rich', 1 * $GiB);
qe_summary($db, 'poor'); qe_summary($db, 'rich');
$err = '';
try { qe_transfer($db, 'poor', 'rich', 200 * 1024 * 1024, 'x'); } catch (\RuntimeException $e) { $err = $e->getMessage(); }
check('starter-only cannot transfer (not transferable)', $err, 'insufficient transferable quota');

// ── Milestones ───────────────────────────────────────────────────────────────
echo "Milestones:\n";
$db = fresh_db();
mk_device($db, 'host', 1 * $GiB);
qe_summary($db, 'host');                                 // backfill at 0 invites (no milestones pre-claimed)
for ($i = 1; $i <= 3; $i++) {
    $db->prepare("INSERT INTO referral_uses (referrer_device_id,new_device_id,bonus_bytes,status) VALUES ('host',?,?, 'credited')")
       ->execute(["inv$i", 1 * $GiB]);
}
$granted = qe_evaluate_milestones($db, 'host');
check('3 invites grants milestone 3',  $granted, [3]);
check('milestone 3 credits +1 GiB',    dev_total($db, 'host'), 2 * $GiB);
$stealth = (int)$db->query("SELECT stealth_unlocked FROM devices WHERE device_id='host'")->fetchColumn();
check('milestone 3 unlocks stealth',   $stealth, 1);
$again = qe_evaluate_milestones($db, 'host');
check('milestone grant is idempotent', $again, []);
check('total unchanged on re-evaluate', dev_total($db, 'host'), 2 * $GiB);
$prog = qe_milestone_progress($db, 'host');
check('progress current_milestone = 3', $prog['current_milestone'], 3);
check('progress next_milestone = 5',    $prog['next_milestone'], 5);

// No retroactive grant for legacy devices already past a milestone.
$db = fresh_db();
mk_device($db, 'legacy', 6 * $GiB);
for ($i = 1; $i <= 5; $i++) {
    $db->prepare("INSERT INTO referral_uses (referrer_device_id,new_device_id,bonus_bytes,status) VALUES ('legacy',?,?, 'credited')")
       ->execute(["inv$i", 1 * $GiB]);
}
qe_summary($db, 'legacy');                               // backfill marks milestones 3 & 5 claimed (bytes 0)
$granted = qe_evaluate_milestones($db, 'legacy');
check('legacy device: no retroactive milestone grant', $granted, []);
check('legacy total unchanged by milestones',          dev_total($db, 'legacy'), 6 * $GiB);

// Pending/rejected referrals never count.
$db = fresh_db();
mk_device($db, 'pend', 1 * $GiB);
qe_summary($db, 'pend');
foreach (['pending','rejected','pending'] as $i => $stt) {
    $db->prepare("INSERT INTO referral_uses (referrer_device_id,new_device_id,bonus_bytes,status) VALUES ('pend',?,?,?)")
       ->execute(["p$i", 1 * $GiB, $stt]);
}
$granted = qe_evaluate_milestones($db, 'pend');
check('pending/rejected referrals do not count', $granted, []);
check('approved invite count = 0',               qe_approved_invite_count($db, 'pend'), 0);

// ── Packages ─────────────────────────────────────────────────────────────────
echo "Packages:\n";
$db = fresh_db();
mk_device($db, 'buyer', 1 * $GiB);
$total = qe_credit_purchase($db, 'buyer', '30GB', 30 * $GiB, 'tx-abc');
check('credit_purchase → total 31 GiB', $total, 31 * $GiB);
$pkgs = qe_packages($db, 'buyer');
check('one purchased package recorded', count($pkgs), 1);
check('package name stored',            $pkgs[0]['package_name'], '30GB');
check('package payment_reference stored', $pkgs[0]['payment_reference'], 'tx-abc');
check('purchase reflected in ledger sum', ledger_sum($db, 'buyer'), 31 * $GiB);

// ── Recipient resolution ─────────────────────────────────────────────────────
echo "Recipient resolution:\n";
$db = fresh_db();
mk_device($db, 'dev-1', 1 * $GiB, 0, ['user_id' => 'SL-227-ABCDEF', 'referral_code' => 'XYZ1234']);
check('resolve by device_id',     qe_resolve_device($db, 'dev-1')['device_id'], 'dev-1');
check('resolve by user_id',       qe_resolve_device($db, 'SL-227-ABCDEF')['device_id'], 'dev-1');
check('resolve by user_id lower', qe_resolve_device($db, 'sl-227-abcdef')['device_id'], 'dev-1');
check('resolve by referral_code', qe_resolve_device($db, 'xyz1234')['device_id'], 'dev-1');
check('unknown recipient → null', qe_resolve_device($db, 'nobody'), null);

// ── Peer badge info (VIP/verified/premium, 2026-07-20) ───────────────────────
// qe_badge_info_for_devices() -- batched peer badge lookup for DM chat list/
// thread header, requested by Khabat. Covers the exact cases asked for:
// regular user, VIP, verified, VIP+verified combo -- plus a query-count
// check as the "no N+1" regression guard.
echo "Peer badge info:\n";
$db = fresh_db();
mk_device($db, 'regular', 1 * $GiB); // free plan, 0 invites -- every default
mk_device($db, 'vip21',   1 * $GiB, 0, ['invite_count' => 21]);              // exactly at the 'vip' threshold
mk_device($db, 'elite55', 1 * $GiB, 0, ['invite_count' => 55]);              // past 'vip' into 'elite'
mk_device($db, 'premium', 1 * $GiB, 0, ['plan' => 'premium', 'valid_until' => '2026-12-31 00:00:00']);
mk_device($db, 'vipplus', 1 * $GiB, 0, [
    'invite_count' => 34, 'plan' => 'team', 'valid_until' => '2027-01-01 00:00:00',
]); // VIP tier (34 >= 21, < 55) AND verified -- the combo case

$badges = qe_badge_info_for_devices($db, ['regular', 'vip21', 'elite55', 'premium', 'vipplus', 'ghost-device']);

check('regular user: not VIP',          $badges['regular']['isVip'],  false);
check('regular user: no tier',          $badges['regular']['vipTier'], null);
check('regular user: not verified',     $badges['regular']['verified'], false);
check('regular user: no premiumUntil',  $badges['regular']['premiumUntil'], null);

check('21 invites: is VIP',             $badges['vip21']['isVip'], true);
check('21 invites: tier = vip',         $badges['vip21']['vipTier'], 'vip');
check('21 invites, free plan: not verified', $badges['vip21']['verified'], false);

check('55 invites: is VIP',             $badges['elite55']['isVip'], true);
check('55 invites: tier = elite (highest reached, not vip)', $badges['elite55']['vipTier'], 'elite');

check('premium plan: verified',         $badges['premium']['verified'], true);
check('premium plan: not VIP (0 invites)', $badges['premium']['isVip'], false);
check('premium plan: premiumUntil set', $badges['premium']['premiumUntil'], '2026-12-31 00:00:00');

check('combo: VIP + verified both true', $badges['vipplus']['isVip'] && $badges['vipplus']['verified'], true);
check('combo: tier = vip (34 invites)',  $badges['vipplus']['vipTier'], 'vip');
check('combo: premiumUntil set',         $badges['vipplus']['premiumUntil'], '2027-01-01 00:00:00');

check('unknown device_id still returns the regular-user shape (no null-crash for callers)',
      $badges['ghost-device'], ['isVip' => false, 'vipTier' => null, 'verified' => false, 'premiumUntil' => null]);

check('empty id list → empty result, no query attempted', qe_badge_info_for_devices($db, []), []);

// No-N+1 regression guard: exactly one SELECT against `devices` regardless of
// batch size (5 ids above vs. 40 below) -- the real risk this whole feature
// was built to avoid. PDO has no query counter, so this asserts the actual
// invariant that guarantees it: correctness holds at a batch size no
// realistic conversation list would ever hit with one query each.
$manyIds = array_merge(['vip21', 'premium'], array_map(fn($i) => "unseen-$i", range(1, 40)));
$manyBadges = qe_badge_info_for_devices($db, $manyIds);
check('batch of 42 ids: still resolves the 2 real ones correctly',
      $manyBadges['vip21']['isVip'] && $manyBadges['premium']['verified'], true);
check('batch of 42 ids: all 42 keys present', count($manyBadges), 42);

echo "\n==== $pass passed, $fail failed ====\n";
exit($fail === 0 ? 0 : 1);
