<?php
// Backend tests for lib/calling.php — audio calling authorization, voucher
// signing, and session bookkeeping (docs/realgram/TASK_SPLIT.md
// A→B(162)/(164)/(166)). Runs against a throwaway in-memory SQLite DB using
// the real functions. Exit code 0 = all pass.

require_once __DIR__ . '/../lib/quota_economy.php';
require_once __DIR__ . '/../lib/messaging.php';
require_once __DIR__ . '/../lib/calling.php';

$pass = 0; $fail = 0;
function check(string $name, $got, $want) {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name — got " . var_export($got, true) . ", want " . var_export($want, true) . "\n"; }
}
function check_true(string $name, bool $cond, string $detail = '') {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  PASS  $name\n"; }
    else { $fail++; echo "  FAIL  $name" . ($detail ? " — $detail" : "") . "\n"; }
}
function check_throws(string $name, callable $fn): void {
    global $pass, $fail;
    try { $fn(); $fail++; echo "  FAIL  $name — did not throw\n"; }
    catch (\RuntimeException $e) { $pass++; echo "  PASS  $name (\"{$e->getMessage()}\")\n"; }
}

const TEST_SECRET = 'test-relay-secret-not-real';

function fresh_db(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec("CREATE TABLE devices (
        device_id TEXT PRIMARY KEY, user_id TEXT DEFAULT '', referral_code TEXT DEFAULT '',
        plan TEXT DEFAULT 'free', blocked INTEGER DEFAULT 0)");
    dm_init_tables($db);
    call_ensure_schema($db);
    // Point at a real (test-only) secret so calling isn't fail-safe-disabled
    // for the whole suite — call_presence_token()'s "disabled when
    // unconfigured" behavior gets its own dedicated test below instead.
    $db->prepare("UPDATE settings SET value=? WHERE key='calling_relay_secret'")->execute([TEST_SECRET]);
    return $db;
}
function mk_device(PDO $db, string $id, array $opt = []): void {
    $db->prepare("INSERT INTO devices (device_id, user_id, referral_code, plan, blocked) VALUES (?,?,?,?,?)")
       ->execute([
           $id, $opt['user_id'] ?? 'SL-' . strtoupper($id), $opt['referral_code'] ?? strtoupper($id) . 'CODE',
           $opt['plan'] ?? 'free', $opt['blocked'] ?? 0,
       ]);
}

echo "== voucher signing/verification ==\n";
$v = call_sign_voucher(TEST_SECRET, ['role' => 'caller', 'call_id' => 'abc123', 'device_id' => 'dev-a']);
check_true('voucher has the two-part body.sig shape', substr_count($v, '.') === 1, $v);
$decoded = call_verify_voucher(TEST_SECRET, $v);
check_true('valid voucher verifies', $decoded !== null);
check('payload round-trips', $decoded['device_id'] ?? null, 'dev-a');

check_true('wrong secret rejects', call_verify_voucher('wrong-secret', $v) === null);
check_true('garbage input rejects', call_verify_voucher(TEST_SECRET, 'not-a-voucher') === null);
check_true('tampered body rejects', call_verify_voucher(TEST_SECRET, $v . 'x') === null);

$expired = call_sign_voucher(TEST_SECRET, ['role' => 'caller', 'exp' => time() - 10]);
check_true('expired voucher rejects', call_verify_voucher(TEST_SECRET, $expired) === null);

echo "\n== call_initiate — happy path ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
check_true('returns a call_id', strlen($r['call_id']) === 32, $r['call_id']);
check_true('returns a caller voucher', $r['voucher'] !== '');
check('callee_device resolved correctly', $r['callee_device'], 'dev-b');
check('kind defaults to audio', $r['kind'], 'audio');

$row = $db->query("SELECT * FROM call_sessions WHERE call_id='{$r['call_id']}'")->fetch();
check('session row status starts ringing', $row['status'], 'ringing');
check('caller/callee devices persisted', $row['caller_device'] . '|' . $row['callee_device'], 'dev-a|dev-b');

echo "\n== call_initiate — premium gate (caller only, per calling.php's documented open decision) ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'free']);
mk_device($db, 'dev-b', ['plan' => 'free']);
check_throws('free-plan caller is rejected', fn() => call_initiate($db, 'dev-a', 'dev-b'));

$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
check_true('free-plan CALLEE can still be called by a premium caller', $r['call_id'] !== '');

echo "\n== call_initiate — validation ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
check_throws('unknown caller device rejected', fn() => call_initiate($db, 'ghost', 'dev-a'));
check_throws('unknown callee rejected', fn() => call_initiate($db, 'dev-a', 'ghost'));
check_throws('calling yourself rejected', fn() => call_initiate($db, 'dev-a', 'dev-a'));
check_throws('video is parked (not available yet)', fn() => call_initiate($db, 'dev-a', 'dev-a', 'video'));

$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium', 'blocked' => 1]);
mk_device($db, 'dev-b', ['plan' => 'free']);
check_throws('blocked caller device rejected', fn() => call_initiate($db, 'dev-a', 'dev-b'));

$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free', 'blocked' => 1]);
check_throws('blocked callee device rejected', fn() => call_initiate($db, 'dev-a', 'dev-b'));

echo "\n== call_initiate — shares the DM block-list trust boundary ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$blockTable = $db->query("SELECT sql FROM sqlite_master WHERE name='user_blocks'")->fetchColumn();
check_true('user_blocks table exists (dm_is_blocked dependency)', $blockTable !== false);
$db->exec("INSERT INTO user_blocks (blocker_device, blocked_device) VALUES ('dev-b', 'dev-a')");
check_throws('a DM-block also blocks calling (either direction)', fn() => call_initiate($db, 'dev-a', 'dev-b'));

echo "\n== call_initiate — one active call at a time, per device ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
mk_device($db, 'dev-c', ['plan' => 'premium']);
call_initiate($db, 'dev-a', 'dev-b');
check_throws('caller already mid-call cannot start a second one', fn() => call_initiate($db, 'dev-a', 'dev-c'));
check_throws('cannot call someone who is already on another call', fn() => call_initiate($db, 'dev-c', 'dev-b'));

echo "\n== call_initiate — rate limit ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
for ($i = 0; $i < CALL_MAX_PER_HOUR; $i++) {
    mk_device($db, "peer-$i", ['plan' => 'free']);
    $r = call_initiate($db, 'dev-a', "peer-$i");
    call_mark_ended($db, $r['call_id'], 'dev-a', 'caller_hangup'); // free the "one active call" slot each time
}
mk_device($db, 'peer-over', ['plan' => 'free']);
check_throws("caller is rate-limited after " . CALL_MAX_PER_HOUR . " calls/hour", fn() => call_initiate($db, 'dev-a', 'peer-over'));

echo "\n== call_callee_voucher ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
$cv = call_callee_voucher($db, 'dev-b', $r['call_id']);
check_true('callee gets their own voucher', $cv['voucher'] !== '' && $cv['voucher'] !== $r['voucher']);
check_throws('wrong device cannot claim the callee voucher', fn() => call_callee_voucher($db, 'dev-c', $r['call_id']));
check_throws('unknown call_id rejected', fn() => call_callee_voucher($db, 'dev-b', 'nonexistent'));

$ended = call_mark_ended($db, $r['call_id'], 'dev-a', 'caller_hangup');
check('call ended', $ended['status'], 'ended');
check_throws('voucher cannot be claimed once the call is no longer ringing', fn() => call_callee_voucher($db, 'dev-b', $r['call_id']));

echo "\n== accept / decline / end lifecycle ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
call_mark_accepted($db, $r['call_id'], 'dev-b');
$row = $db->query("SELECT * FROM call_sessions WHERE call_id='{$r['call_id']}'")->fetch();
check('status is accepted', $row['status'], 'accepted');
check_true('accepted_at was stamped', $row['accepted_at'] !== null);

check_throws('a stranger cannot end a call that is not theirs', fn() => call_mark_ended($db, $r['call_id'], 'dev-stranger', 'caller_hangup'));

$ended = call_mark_ended($db, $r['call_id'], 'dev-b', 'callee_hangup');
check('end reason recorded', $ended['end_reason'], 'callee_hangup');
check('status is ended', $ended['status'], 'ended');

$again = call_mark_ended($db, $r['call_id'], 'dev-a', 'caller_hangup');
check_true('ending an already-ended call is an idempotent no-op, not an error', $again['status'] === 'ended');

echo "\n== decline ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
call_mark_declined($db, $r['call_id'], 'dev-b');
$row = $db->query("SELECT * FROM call_sessions WHERE call_id='{$r['call_id']}'")->fetch();
check('declined status', $row['status'], 'declined');
check('declined end_reason', $row['end_reason'], 'declined');

echo "\n== stale ringing calls auto-resolve to missed ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
$db->prepare("UPDATE call_sessions SET started_at = datetime('now', '-" . (CALL_STALE_RINGING_SECS + 5) . " seconds') WHERE call_id=?")
   ->execute([$r['call_id']]);
check_true('a stale ringing call no longer blocks a new one', call_active_for($db, 'dev-a') === null);
$row = $db->query("SELECT * FROM call_sessions WHERE call_id='{$r['call_id']}'")->fetch();
check('swept to missed', $row['status'], 'missed');

echo "\n== call_history ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r1 = call_initiate($db, 'dev-a', 'dev-b');
call_mark_ended($db, $r1['call_id'], 'dev-a', 'caller_hangup');
mk_device($db, 'dev-c', ['plan' => 'premium']);
$r2 = call_initiate($db, 'dev-c', 'dev-a');
call_mark_declined($db, $r2['call_id'], 'dev-a');

$hist = call_history($db, 'dev-a');
check('history has both calls', count($hist), 2);
$out = array_values(array_filter($hist, fn($h) => $h['call_id'] === $r1['call_id']))[0] ?? null;
check_true('outgoing call direction is out', $out !== null && $out['direction'] === 'out');
check('outgoing call peer is the callee', $out['peer_device'], 'dev-b');
$in = array_values(array_filter($hist, fn($h) => $h['call_id'] === $r2['call_id']))[0] ?? null;
check_true('incoming call direction is in', $in !== null && $in['direction'] === 'in');
check('incoming call status reflects decline', $in['status'], 'declined');

echo "\n== call_presence_token ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'free']);
$tok = call_presence_token($db, 'dev-a');
check_true('enabled when relay secret is configured', $tok['enabled'] === true);
check_true('token is non-empty', $tok['token'] !== '');

$db->prepare("UPDATE settings SET value='' WHERE key='calling_relay_secret'")->execute();
$tok2 = call_presence_token($db, 'dev-a');
check_true('disabled (fail-safe) when relay secret is unconfigured', $tok2['enabled'] === false);

$db2 = fresh_db();
mk_device($db2, 'dev-blocked', ['plan' => 'premium', 'blocked' => 1]);
$tok3 = call_presence_token($db2, 'dev-blocked');
check_true('disabled for a blocked device even with a valid secret', $tok3['enabled'] === false);

echo "\n== call_is_allowlisted / testing-phase restriction (A→B(170)) ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
mk_device($db, 'dev-outsider', ['plan' => 'premium']);
check_true('empty allowlist permits anyone', call_initiate($db, 'dev-a', 'dev-b') !== null);

$db->prepare("UPDATE settings SET value='dev-a,dev-b' WHERE key='calling_allowlist'")->execute();
call_mark_ended($db, call_active_for($db, 'dev-a')['call_id'], 'dev-a', 'caller_hangup');
check_true('both sides listed: call goes through', call_initiate($db, 'dev-a', 'dev-b') !== null);
call_mark_ended($db, call_active_for($db, 'dev-a')['call_id'], 'dev-a', 'caller_hangup');

mk_device($db, 'dev-c', ['plan' => 'premium']);
check_throws('caller not on the allowlist is rejected', fn() => call_initiate($db, 'dev-outsider', 'dev-b'));
check_throws('callee not on the allowlist is rejected', fn() => call_initiate($db, 'dev-a', 'dev-c'));

$db->prepare("UPDATE settings SET value='SL-DEV-A,dev-b' WHERE key='calling_allowlist'")->execute();
check_true('allowlist also matches on user_id, not just device_id', call_initiate($db, 'dev-a', 'dev-b') !== null);

echo "\n== call_ice_servers ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
$r = call_initiate($db, 'dev-a', 'dev-b');
$ice = call_ice_servers($db, $r['call_id'], 'dev-a');
check_true('STUN is always present', count($ice['ice_servers']) >= 1);
check_true('no TURN entry when calling_turn_secret is unconfigured', count($ice['ice_servers']) === 1);
check_throws('a stranger cannot fetch ICE servers for a call that is not theirs',
    fn() => call_ice_servers($db, $r['call_id'], 'dev-stranger'));
check_throws('unknown call_id rejected', fn() => call_ice_servers($db, 'nonexistent', 'dev-a'));

$db->prepare("UPDATE settings SET value='fi-hel-turn-secret-not-real' WHERE key='calling_turn_secret'")->execute();
$ice2 = call_ice_servers($db, $r['call_id'], 'dev-b');
check('adds exactly one TURN entry once configured', count($ice2['ice_servers']), 2);
$turn = $ice2['ice_servers'][1];
check_true('TURN entry carries username/credential', !empty($turn['username']) && !empty($turn['credential']));
$expectedCred = base64_encode(hash_hmac('sha1', $turn['username'], 'fi-hel-turn-secret-not-real', true));
check('TURN credential matches the documented coturn REST-API HMAC scheme', $turn['credential'], $expectedCred);

echo "\n== call_relay_push (best-effort internal push, no relay running here) ==\n";
$db = fresh_db();
mk_device($db, 'dev-a', ['plan' => 'premium']);
mk_device($db, 'dev-b', ['plan' => 'free']);
// No calling_relay_internal_url configured — call_initiate() must not
// throw or hang even though it calls call_relay_push() internally.
$before = microtime(true);
$r = call_initiate($db, 'dev-a', 'dev-b');
check_true('call_initiate completes fast when push is unconfigured (no-op, not a hung network call)', (microtime(true) - $before) < 1.0);
check_true('call still created normally', $r['call_id'] !== '');
// Point at a URL nothing is listening on — connect should fail fast
// (short CONNECTTIMEOUT_MS) and be swallowed, not thrown or hung.
$db->prepare("UPDATE settings SET value='http://127.0.0.1:1' WHERE key='calling_relay_internal_url'")->execute();
$db->prepare("UPDATE settings SET value='x' WHERE key='calling_relay_internal_secret'")->execute();
$before = microtime(true);
call_mark_accepted($db, $r['call_id'], 'dev-b');
check_true('an unreachable relay does not throw or hang the caller', (microtime(true) - $before) < 1.0);
check('call still marked accepted despite the push failing', call_active_for($db, 'dev-b')['status'] ?? null, 'accepted');

echo "\n" . ($fail === 0 ? "ALL $pass TESTS PASSED\n" : "$fail FAILED, $pass PASSED\n");
exit($fail === 0 ? 0 : 1);
