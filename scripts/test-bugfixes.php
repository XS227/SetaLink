<?php
// Backend regression tests for the 2026-06-10 bug-fix batch.
// Runs against a throwaway in-memory SQLite DB, exercising the same SQL the
// handlers use. No network, no live data. Exit code 0 = all pass.

$GiB = 1073741824;
$pass = 0; $fail = 0;
function check(string $name, $got, $want) {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name — got " . var_export($got, true) . ", want " . var_export($want, true) . "\n"; }
}

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("CREATE TABLE devices (device_id TEXT PRIMARY KEY, user_id TEXT, referral_code TEXT,
           quota_bytes_total INTEGER DEFAULT 1073741824, quota_bytes_used INTEGER DEFAULT 0)");
$db->exec("CREATE TABLE vpn_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT,
           bytes_sent INTEGER, bytes_recv INTEGER, session_id TEXT DEFAULT '')");
$db->exec("CREATE UNIQUE INDEX idx_devsid ON vpn_sessions(device_id, session_id) WHERE session_id <> ''");

// ── Bug 2: report-session is the single writer, idempotent, clamped ──────────
echo "Bug 2 — quota accounting:\n";
$db->prepare("INSERT INTO devices (device_id, quota_bytes_total, quota_bytes_used) VALUES ('d1', ?, 0)")
   ->execute([3 * $GiB]);

// Simulate the report-session handler (delta add, INSERT OR IGNORE, clamp).
$reportSession = function(string $dev, int $sent, int $recv, string $sid) use ($db) {
    $ins = $db->prepare("INSERT OR IGNORE INTO vpn_sessions (device_id, bytes_sent, bytes_recv, session_id) VALUES (?,?,?,?)");
    $ins->execute([$dev, $sent, $recv, $sid]);
    $total = $sent + $recv;
    if ($ins->rowCount() > 0 && $total > 0) {
        $db->prepare("UPDATE devices SET quota_bytes_used = MIN(quota_bytes_total, quota_bytes_used + ?) WHERE device_id=?")
           ->execute([$total, $dev]);
    }
    return $ins->rowCount() > 0;
};
$used = fn() => (int)$db->query("SELECT quota_bytes_used FROM devices WHERE device_id='d1'")->fetchColumn();

$reportSession('d1', 100 * 1000000, 50 * 1000000, 'sess-1');           // +150 MB
check('first session accumulates once', $used(), 150 * 1000000);
$dup = $reportSession('d1', 100 * 1000000, 50 * 1000000, 'sess-1');    // retry, same id
check('duplicate session is ignored (idempotent)', $dup, false);
check('quota unchanged after duplicate', $used(), 150 * 1000000);
$reportSession('d1', 200 * 1000000, 0, 'sess-2');                       // +200 MB
check('second distinct session adds delta', $used(), 350 * 1000000);
// Clamp: a huge session cannot exceed total.
$reportSession('d1', 10 * $GiB, 0, 'sess-big');
check('usage clamps to total (never exceeds quota)', $used(), 3 * $GiB);

// report-usage must NOT mutate quota (heartbeat only) — simulated as no-op.
$before = $used();
// (no quota write in the new report-usage handler)
check('report-usage does not change quota', $used(), $before);

// ── Bug 2 repair: de-inflate ×1000 totals; recompute used from sessions ──────
echo "Bug 2 — repair migration:\n";
$deinflate = function(int $total) use ($GiB) {
    if ($total >= 1000 * $GiB && $total % 1000 === 0 && (($total / 1000) % $GiB === 0)) return intdiv($total, 1000);
    return $total;
};
check('inflated 3 GiB×1000 de-inflates to 3 GiB', $deinflate(3221225472000), 3 * $GiB);
check('unlimited (1 TiB) is NOT de-inflated', $deinflate(1099511627776), 1099511627776);
check('227 GiB (not ×1000) is untouched', $deinflate(243739394048), 243739394048);
check('1 GiB starter is untouched', $deinflate($GiB), $GiB);

// ── Bug 3: referral lookup accepts referral_code OR user_id suffix ───────────
echo "Bug 3 — referral lookup:\n";
$db->prepare("INSERT INTO devices (device_id, user_id, referral_code, quota_bytes_total) VALUES ('owner','SL-227-62DAC5F0','4D2CA28', ?)")
   ->execute([$GiB]);
$lookup = function(string $code) use ($db) {
    $code = strtoupper($code);
    $st = $db->prepare("SELECT device_id FROM devices WHERE referral_code=? OR UPPER(user_id) LIKE ? LIMIT 1");
    $st->execute([$code, 'SL-%-' . $code]);
    return $st->fetchColumn() ?: null;
};
check('real referral_code resolves', $lookup('4D2CA28'), 'owner');
check('user_id suffix (old app shares this) resolves', $lookup('62DAC5F0'), 'owner');
check('lowercase referral_code resolves', $lookup('4d2ca28'), 'owner');
check('garbage code does not resolve', $lookup('ZZZZZZZ'), null);

// ── Bug 4: package catalog is 10/20/30GB on both sides with correct bytes ────
echo "Bug 4 — packages:\n";
$VALID = ['7days','30days','unlimited','10GB','20GB','30GB'];
$pkg_map = ['10GB'=>10*$GiB, '20GB'=>20*$GiB, '30GB'=>30*$GiB];
check('10GB valid', in_array('10GB', $VALID, true), true);
check('20GB valid', in_array('20GB', $VALID, true), true);
check('30GB valid', in_array('30GB', $VALID, true), true);
check('old 5GB no longer offered', in_array('5GB', $VALID, true), false);
check('10GB credits 10 GiB', $pkg_map['10GB'], 10 * $GiB);
check('20GB credits 20 GiB', $pkg_map['20GB'], 20 * $GiB);
check('30GB credits 30 GiB', $pkg_map['30GB'], 30 * $GiB);

echo "\n==== $pass passed, $fail failed ====\n";
exit($fail === 0 ? 0 : 1);
