<?php
// Backend tests for the RealGram Admin Monetization page (lib/ad_monetization.php,
// lib/admob_sync.php, lib/adsgram_publisher_sync.php). Runs against a throwaway
// in-memory SQLite DB using the real functions. Exit code 0 = all pass.
// See docs/realgram/MONETIZATION_REPORTING.md §Testing.

require_once __DIR__ . '/../lib/ad_monetization.php';
require_once __DIR__ . '/../lib/admob_sync.php';
require_once __DIR__ . '/../lib/adsgram_publisher_sync.php';

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
    $db->exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT)");
    am_init_tables($db);
    return $db;
}

echo "== am_event_insert idempotency ==\n";
$db = fresh_db();
$base = ['provider' => 'adsgram', 'event_type' => 'reward', 'provider_event_id' => 'evt-1',
         'provider_transaction_id' => 'txn-1', 'user_id' => 'u1', 'reward_type' => 'real',
         'reward_amount' => 100, 'reward_granted' => 1, 'validation_status' => 'verified',
         'source_type' => 'PROVIDER_CALLBACK'];
$r1 = am_event_insert($db, $base);
check_true('first insert succeeds', $r1['inserted'] === true && $r1['duplicate'] === false);
$r2 = am_event_insert($db, $base);
check_true('repeat insert (same providerTransactionId) is a duplicate, not a new row', $r2['duplicate'] === true);
check('exactly one row exists after the repeat', (int)$db->query("SELECT COUNT(*) FROM ad_events")->fetchColumn(), 1);
// Same transaction ID used twice with a DIFFERENT reward amount — must still be
// treated as the identical event (idempotency key is the id, not the payload) —
// a reward must never be granted twice for it.
$tampered = $base; $tampered['reward_amount'] = 999999;
$r3 = am_event_insert($db, $tampered);
check_true('same providerTransactionId, different payload, still a duplicate (no double grant)', $r3['duplicate'] === true);
check('stored reward_amount is unchanged (still the original 100)',
      (float)$db->query("SELECT reward_amount FROM ad_events WHERE provider_event_id='evt-1'")->fetchColumn(), 100.0);
check('total reward_granted count is still 1 (never double-granted)',
      (int)$db->query("SELECT SUM(reward_granted) FROM ad_events")->fetchColumn(), 1);

echo "\n== am_ingest_adsgram_event — push-adsgram-events contract (TASK_SPLIT B→A(56)) ==\n";
$db = fresh_db();
$credited = ['providerTransactionId' => 'mongo-id-1', 'account' => '8452000000', 'idType' => 'telegram',
             'tier' => 'watch', 'source' => 'client', 'status' => 'credited',
             'real' => 100, 'gems' => 0, 'farr' => 0, 'blockId' => '35738', 'reason' => '',
             'occurredAt' => '2026-07-20T03:31:04.000Z'];
$res = am_ingest_adsgram_event($db, $credited);
check_true('valid credited event accepted', $res['inserted'] === true);
$row = $db->query("SELECT * FROM ad_events WHERE provider_transaction_id='mongo-id-1'")->fetch(PDO::FETCH_ASSOC);
check('reward_granted=1 for credited', (int)$row['reward_granted'], 1);
check('validation_status=verified for credited', $row['validation_status'], 'verified');
check('reward_type picked as "real" (first nonzero)', $row['reward_type'], 'real');
check('reward_amount=100', (float)$row['reward_amount'], 100.0);
check('source=client maps to LOCAL_SDK_EVENT (not a confirmed AdsGram callback)', $row['source_type'], 'LOCAL_SDK_EVENT');
check('placement=tier ("watch")', $row['placement'], 'watch');
check('occurredAt honored as created_at (not ingestion time)', $row['created_at'], '2026-07-20 03:31:04');

$serverCallback = $credited; $serverCallback['providerTransactionId'] = 'mongo-id-2'; $serverCallback['source'] = 'server_callback';
$res2 = am_ingest_adsgram_event($db, $serverCallback);
$row2 = $db->query("SELECT source_type FROM ad_events WHERE provider_transaction_id='mongo-id-2'")->fetch(PDO::FETCH_ASSOC);
check('source=server_callback maps to PROVIDER_CALLBACK (genuine AdsGram postback)', $row2['source_type'], 'PROVIDER_CALLBACK');

$rejected = $credited; $rejected['providerTransactionId'] = 'mongo-id-3'; $rejected['status'] = 'cooldown'; $rejected['real'] = 0;
am_ingest_adsgram_event($db, $rejected);
$row3 = $db->query("SELECT reward_granted, validation_status FROM ad_events WHERE provider_transaction_id='mongo-id-3'")->fetch(PDO::FETCH_ASSOC);
check_true('cooldown status: reward_granted=0, validation_status=rejected',
    (int)$row3['reward_granted'] === 0 && $row3['validation_status'] === 'rejected');

$errored = $credited; $errored['providerTransactionId'] = 'mongo-id-4'; $errored['status'] = 'server_error'; $errored['real'] = 0;
am_ingest_adsgram_event($db, $errored);
$row4 = $db->query("SELECT validation_status FROM ad_events WHERE provider_transaction_id='mongo-id-4'")->fetch(PDO::FETCH_ASSOC);
check('server_error maps to "review" (distinct from a normal business-rule rejection)', $row4['validation_status'], 'review');

$noTxn = $credited; unset($noTxn['providerTransactionId']);
$resNoTxn = am_ingest_adsgram_event($db, $noTxn);
check_true('missing providerTransactionId is rejected, not silently inserted', !empty($resNoTxn['rejected']));

$farrEvent = $credited; $farrEvent['providerTransactionId'] = 'mongo-id-5'; $farrEvent['real'] = 0; $farrEvent['farr'] = 42;
am_ingest_adsgram_event($db, $farrEvent);
$row5 = $db->query("SELECT reward_type, reward_amount, raw_payload FROM ad_events WHERE provider_transaction_id='mongo-id-5'")->fetch(PDO::FETCH_ASSOC);
check('farr reward_type recognized', $row5['reward_type'], 'farr');
$decoded = json_decode($row5['raw_payload'], true);
check_true('raw_payload preserves the full original event for multi-currency fidelity', $decoded['providerTransactionId'] === 'mongo-id-5');

echo "\n== am_daily_metric_upsert — source-priority protection (spec §8) ==\n";
$db = fresh_db();
am_daily_metric_upsert($db, ['date' => '2026-07-01', 'provider' => 'admob', 'revenue' => 5.0, 'source_type' => 'ESTIMATE']);
$w1 = am_daily_metric_upsert($db, ['date' => '2026-07-01', 'provider' => 'admob', 'revenue' => 9.0, 'source_type' => 'PROVIDER_API']);
check_true('higher-trust source (PROVIDER_API) is allowed to overwrite ESTIMATE', $w1['written'] === true);
check('revenue now reflects the PROVIDER_API value', (float)$db->query("SELECT revenue FROM ad_daily_metrics WHERE date='2026-07-01'")->fetchColumn(), 9.0);
$w2 = am_daily_metric_upsert($db, ['date' => '2026-07-01', 'provider' => 'admob', 'revenue' => 1.0, 'source_type' => 'ESTIMATE']);
check_true('lower-trust source (ESTIMATE) is refused — never overwrites PROVIDER_API', $w2['written'] === false);
check('revenue is still the PROVIDER_API value, not overwritten by the estimate', (float)$db->query("SELECT revenue FROM ad_daily_metrics WHERE date='2026-07-01'")->fetchColumn(), 9.0);

echo "\n== Currency: never mixed, never guessed (spec §2/§11) ==\n";
$db = fresh_db();
$noRate = am_to_base($db, 100, 'NOK');
check('no configured rate -> null, never a guessed conversion', $noRate, null);
am_set_fx_rate($db, 'NOK', 0.091, 'manual');
$withRate = am_to_base($db, 100, 'NOK');
check('configured rate converts correctly', $withRate['amount'], 9.1);
check('conversion carries its source label', $withRate['rate_source'], 'manual');
check_true('conversion carries a timestamp', !empty($withRate['rate_at']));
$identity = am_to_base($db, 50, 'USD'); // base currency itself
check('base-currency amount passes through unconverted', $identity['amount'], 50.0);

echo "\n== am_csv_import_adsgram — manual import ==\n";
$db = fresh_db();
$csv = "date,block_id,impressions,clicks,completions,revenue,currency\n"
     . "2026-07-18,35738,20,2,18,0.03,USDT\n"
     . "bad-row,35738,5,0,5,0.01,USDT\n";
$imp = am_csv_import_adsgram($db, $csv, 'export.csv', 'khabat');
check('1 accepted, 1 rejected (bad date)', $imp['accepted'] . '/' . $imp['rejected'], '1/1');
$dailyRow = $db->query("SELECT source_type, revenue FROM ad_daily_metrics WHERE date='2026-07-18'")->fetch(PDO::FETCH_ASSOC);
check_true('imported row tagged MANUAL_IMPORT, never presented as live provider data', $dailyRow['source_type'] === 'MANUAL_IMPORT');
check('audit log recorded the import', (int)$db->query("SELECT COUNT(*) FROM monetization_admin_log WHERE action='adsgram_csv_import'")->fetchColumn(), 1);
check('ad_csv_imports row recorded for the Logs tab', (int)$db->query("SELECT COUNT(*) FROM ad_csv_imports")->fetchColumn(), 1);
// A CSV import must never silently clobber a higher-priority PROVIDER_API row.
am_daily_metric_upsert($db, ['date' => '2026-07-18', 'provider' => 'adsgram', 'ad_unit_id' => '35738', 'revenue' => 50, 'source_type' => 'PROVIDER_API']);
$csvAfterApi = am_csv_import_adsgram($db, $csv, 'export2.csv', 'khabat');
$rowAfterApi = $db->query("SELECT revenue, source_type FROM ad_daily_metrics WHERE date='2026-07-18' AND ad_unit_id='35738'")->fetch(PDO::FETCH_ASSOC);
check_true('CSV import cannot overwrite an existing PROVIDER_API row', $rowAfterApi['source_type'] === 'PROVIDER_API' && (float)$rowAfterApi['revenue'] === 50.0);

echo "\n== am_reconciliation — aggregates vs events agree ==\n";
$db = fresh_db();
am_daily_metric_upsert($db, ['date' => '2026-07-10', 'provider' => 'admob', 'ad_unit_id' => 'unit-A', 'impressions' => 100, 'rewards_granted' => 5, 'source_type' => 'PROVIDER_API']);
for ($i = 0; $i < 5; $i++) {
    am_event_insert($db, ['provider' => 'admob', 'event_type' => 'reward', 'ad_unit_id' => 'unit-A',
        'provider_event_id' => "recon-$i", 'reward_granted' => 1, 'validation_status' => 'verified', 'source_type' => 'PROVIDER_CALLBACK']);
}
$recon = am_reconciliation($db, 'admob', '2026-07-01', '2026-07-31');
check('reconciliation finds the ad unit', $recon[0]['ad_unit_id'] ?? null, 'unit-A');
check('provider vs local rewards match exactly (5 vs 5)', $recon[0]['difference'], 0);
check_true('no alerts when provider and local numbers agree', empty($recon[0]['alerts']));
// Now create a mismatch: one more provider-reported reward than we have locally.
am_daily_metric_upsert($db, ['date' => '2026-07-11', 'provider' => 'admob', 'ad_unit_id' => 'unit-A', 'rewards_granted' => 1, 'source_type' => 'PROVIDER_API']);
$recon2 = am_reconciliation($db, 'admob', '2026-07-01', '2026-07-31');
check('difference reflects the extra provider-reported reward', $recon2[0]['difference'], 1);
check_true('a mismatch produces an alert', !empty($recon2[0]['alerts']));

echo "\n== Reward valuation — always labeled 'estimated', never fabricated (spec §11) ==\n";
$db = fresh_db();
am_event_insert($db, ['provider' => 'admob', 'event_type' => 'reward', 'provider_event_id' => 'val-1',
    'user_id' => 'u1', 'reward_type' => 'gb', 'reward_amount' => 1073741824, 'reward_granted' => 1,
    'validation_status' => 'verified', 'source_type' => 'PROVIDER_CALLBACK']);
$costUnconfigured = am_reward_cost($db, '2026-01-01', '2026-12-31');
check('GB is valued by default (mirrors existing egress_cost_per_gb_usd convention)', $costUnconfigured['fully_configured'], true);
am_save_config($db, ['mon_value_per_gb_usd' => 0.10]);
$costConfigured = am_reward_cost($db, '2026-01-01', '2026-12-31');
check('reconfiguring the value changes the estimated cost', $costConfigured['total_estimated_cost_usd'], 0.1);

echo "\n== Secrets never leak through status functions ==\n";
$db = fresh_db();
$admobStatus = admob_sync_status($db);
check_true('admob_sync_status has no client_secret/refresh_token key', !array_key_exists('client_secret', $admobStatus) && !array_key_exists('refresh_token', $admobStatus));
$agStatus = adsgram_sync_status($db);
check_true('adsgram_sync_status has no token value, only a configured boolean', !array_key_exists('token', $agStatus) && !array_key_exists('adsgram_api_token', $agStatus));
check('AdMob not configured by default (no OAuth client file present in this test env)', $admobStatus['client_configured'], false);
check('AdsGram not configured by default (no token saved yet)', $agStatus['configured'], false);

echo "\n== am_backfill idempotency ==\n";
$db = fresh_db();
$db->exec("CREATE TABLE ad_reward_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, nonce TEXT,
    status TEXT DEFAULT 'pending', reward_bytes INTEGER DEFAULT 0, ad_unit TEXT DEFAULT '', ssv_verified INTEGER DEFAULT 0,
    risk_flags TEXT DEFAULT '', confirmed_at TEXT)");
$db->exec("INSERT INTO ad_reward_events (device_id,nonce,status,reward_bytes,ad_unit,ssv_verified,confirmed_at)
    VALUES ('dev1','n1','confirmed',262144000,'unit-1',1,'2026-07-15 10:00:00')");
$db->exec("CREATE TABLE ad_perf_daily (date TEXT, platform TEXT, active_users INTEGER DEFAULT 0, rewarded_views INTEGER DEFAULT 0,
    revenue_usd REAL DEFAULT 0, ecpm_usd REAL DEFAULT 0, fill_rate REAL DEFAULT 0, gb_granted REAL DEFAULT 0, avg_watch_time_s REAL DEFAULT 0)");
$db->exec("CREATE TABLE app_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, event TEXT, props TEXT DEFAULT '', created_at TEXT)");
$first = am_backfill($db, false);
$second = am_backfill($db, false);
check('first backfill inserts the one AdMob reward event', $first['admob_reward'], 1);
check('second backfill run finds it as a duplicate, does not double-insert', $second['skipped_dupe'], 1);
check('total ad_events rows stays at 1 after two runs', (int)$db->query("SELECT COUNT(*) FROM ad_events")->fetchColumn(), 1);

echo "\n== Interstitial backfill — 'shown' and 'impressions' stay separate (2026-07-22) ==\n";
$db = fresh_db();
$db->exec("CREATE TABLE ad_reward_events (device_id TEXT, nonce TEXT, ad_unit TEXT, status TEXT, ssv_verified INTEGER, reward_bytes INTEGER, risk_flags TEXT, confirmed_at TEXT)");
$db->exec("CREATE TABLE ad_perf_daily (date TEXT, platform TEXT, rewarded_views INTEGER, revenue_usd REAL)");
$db->exec("CREATE TABLE app_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, event TEXT, props TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
$ins = $db->prepare("INSERT INTO app_events (device_id, event, props, created_at) VALUES (?,?,?,?)");
// 3 ads displayed on-device, but only 1 provider-confirmed (PAID) impression and 1 click.
$ins->execute(['d1', 'AD_INTERSTITIAL_SHOWN', '{}', '2026-07-22 10:00:00']);
$ins->execute(['d2', 'AD_INTERSTITIAL_SHOWN', '{}', '2026-07-22 11:00:00']);
$ins->execute(['d3', 'AD_INTERSTITIAL_SHOWN', '{}', '2026-07-22 12:00:00']);
$ins->execute(['d1', 'AD_INTERSTITIAL_IMPRESSION', json_encode(['value' => 0.015, 'currency' => 'USD']), '2026-07-22 10:00:05']);
$ins->execute(['d2', 'AD_INTERSTITIAL_CLICK', '{}', '2026-07-22 11:00:03']);
am_backfill($db, false);
$row = $db->query("SELECT * FROM ad_daily_metrics WHERE ad_unit_id='interstitial'")->fetch(PDO::FETCH_ASSOC);
check('shown counts every displayed ad, not just paid ones', (int)$row['shown'], 3);
check('impressions counts only provider-confirmed (PAID) events', (int)$row['impressions'], 1);
check('revenue comes only from the PAID event, not from SHOWN', (float)$row['revenue'], 0.015);
$row2 = $db->query("SELECT * FROM ad_daily_metrics WHERE ad_unit_id='interstitial'")->fetch(PDO::FETCH_ASSOC);
am_backfill($db, false); // re-run
$row3 = $db->query("SELECT * FROM ad_daily_metrics WHERE ad_unit_id='interstitial'")->fetch(PDO::FETCH_ASSOC);
check('re-running the backfill does not double-count shown/impressions', $row3['shown'] . ':' . $row3['impressions'], $row2['shown'] . ':' . $row2['impressions']);
$drill = am_reward_events($db, ['user_id' => 'd1']);
check_true('a specific device+timestamp is drillable via am_reward_events (spec item #4)',
    count($drill['rows']) === 1 && $drill['rows'][0]['event_type'] === 'interstitial_impression'
    && $drill['rows'][0]['created_at'] === '2026-07-22 10:00:05');

echo "\n" . ($fail === 0 ? "ALL $pass TESTS PASSED\n" : "$fail FAILED, $pass PASSED\n");
exit($fail === 0 ? 0 : 1);
