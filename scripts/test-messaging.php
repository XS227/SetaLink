<?php
// Backend tests for direct-message reactions + typing indicators
// (lib/messaging.php) — the server half of the 2026-07-22 "chat pass part 1"
// discovery: the mobile client (entitlementService.ts, DM_REACTIONS) already
// called react-message/set-typing/get-typing, but nothing server-side
// implemented them. Runs against a throwaway in-memory SQLite DB using the
// real functions. Exit code 0 = all pass.

require_once __DIR__ . '/../lib/messaging.php';

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

function fresh_db(): PDO {
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    dm_init_tables($db);
    return $db;
}

function seed_message(PDO $db, int $id, string $sender, string $recipient): void {
    $db->prepare(
        "INSERT INTO user_messages (id, sender_device, recipient_device, body_enc, status)
         VALUES (?,?,?,?,'sent')"
    )->execute([$id, $sender, $recipient, dm_encrypt('hello')]);
}

echo "== dm_react — toggle/replace, one per (message, device) ==\n";
$db = fresh_db();
seed_message($db, 1, 'dev-a', 'dev-b');

$r1 = dm_react($db, 'dev-b', 1, '👍');
check('first reaction counts it', $r1['counts']['👍'] ?? 0, 1);
check('first reaction reports as mine', $r1['mine'], '👍');

$r2 = dm_react($db, 'dev-b', 1, '👍');
check_true('same emoji again clears it', empty($r2['counts']), 'counts: ' . json_encode($r2['counts']));
check('cleared reaction has no mine', $r2['mine'], null);

$r3 = dm_react($db, 'dev-b', 1, '❤️');
$r4 = dm_react($db, 'dev-a', 1, '❤️');
check('two devices reacting with the same emoji both count', $r4['counts']['❤️'] ?? 0, 2);

$r5 = dm_react($db, 'dev-a', 1, '😮');
check_true('a different emoji replaces, does not add a second reaction from the same device',
    ($r5['counts']['❤️'] ?? 0) === 1 && ($r5['counts']['😮'] ?? 0) === 1,
    json_encode($r5['counts']));
check('mine reflects the replacement', $r5['mine'], '😮');

echo "\n== dm_react — validation ==\n";
$threw = false;
try { dm_react($db, 'dev-b', 1, '💩'); } catch (\RuntimeException $e) { $threw = true; }
check_true('rejects an emoji outside MSG_REACTIONS', $threw);

$threw = false;
try { dm_react($db, 'dev-outsider', 1, '👍'); } catch (\RuntimeException $e) { $threw = true; }
check_true('rejects a device that is not sender or recipient of the message', $threw);

echo "\n== dm_list embeds reactions/my_reaction (client contract, entitlementService.ts) ==\n";
$db = fresh_db();
seed_message($db, 10, 'dev-a', 'dev-b');
dm_react($db, 'dev-a', 10, '🙏');
dm_react($db, 'dev-b', 10, '🙏');
$listed = dm_list($db, 'dev-b');
check('exactly one message listed', count($listed), 1);
check('reactions count is embedded in dm_list output', $listed[0]['reactions']['🙏'] ?? 0, 2);
check('my_reaction (for dev-b) is embedded in dm_list output', $listed[0]['my_reaction'], '🙏');
$listedOther = dm_list($db, 'dev-a');
check('my_reaction differs per viewing device (still 🙏 for dev-a too, but independently looked up)', $listedOther[0]['my_reaction'], '🙏');

echo "\n== typing indicator — TTL-based, directional, no explicit stop call ==\n";
$db = fresh_db();
check_true('nobody has pinged yet', dm_get_typing($db, 'dev-b', 'dev-a') === false);
dm_set_typing($db, 'dev-a', 'dev-b'); // dev-a is typing TO dev-b
check_true('dev-b sees dev-a typing to them', dm_get_typing($db, 'dev-b', 'dev-a') === true);
check_true('dev-a does NOT see themself as "peer typing" (directional, not symmetric)', dm_get_typing($db, 'dev-a', 'dev-b') === false);

// Simulate the TTL expiring by back-dating the row directly (no real sleep in a test).
$db->prepare("UPDATE user_typing_status SET updated_at = datetime('now', '-" . (MSG_TYPING_TTL_SECS + 1) . " seconds') WHERE device_id='dev-a' AND peer='dev-b'")->execute();
check_true('typing status goes stale after the TTL with no explicit stop call', dm_get_typing($db, 'dev-b', 'dev-a') === false);

// Re-ping refreshes it (upsert, not insert-only).
dm_set_typing($db, 'dev-a', 'dev-b');
check_true('re-pinging after going stale works (upsert, not insert-once)', dm_get_typing($db, 'dev-b', 'dev-a') === true);

echo "\n" . ($fail === 0 ? "ALL $pass TESTS PASSED\n" : "$fail FAILED, $pass PASSED\n");
exit($fail === 0 ? 0 : 1);
