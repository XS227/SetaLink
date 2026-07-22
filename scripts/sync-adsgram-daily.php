<?php
// Daily AdsGram publisher-API sync — run from cron (see docs/realgram/MONETIZATION_REPORTING.md
// for the exact crontab line). Mirrors scripts/sync-admob-daily.php: retries
// with backoff on transient failure, never duplicates data
// (am_daily_metric_upsert is a keyed upsert). Exit 0 on success (including
// "not configured yet" — that's not a cron failure), exit 1 on a real API
// error after retries so cron/monitoring can alert.
declare(strict_types=1);

require_once __DIR__ . '/../lib/ad_monetization.php';
require_once __DIR__ . '/../lib/adsgram_publisher_sync.php';

$dbPath = realpath(__DIR__ . '/../data') . '/analytics.db';
$pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA busy_timeout=5000');

if (!adsgram_publisher_configured($pdo)) {
    echo "[sync-adsgram-daily] not configured — nothing to do.\n";
    exit(0);
}

$attempts = [0, 5, 30]; // seconds to wait before each retry (first entry = no wait)
$result = null;
foreach ($attempts as $i => $waitSecs) {
    if ($waitSecs > 0) sleep($waitSecs);
    $result = adsgram_publisher_sync($pdo, 3); // 3-day window daily; a separate backfill covers history
    if ($result['ok']) break;
    echo "[sync-adsgram-daily] attempt " . ($i + 1) . " failed: " . $result['error'] . "\n";
}

if (!$result['ok']) {
    fwrite(STDERR, "[sync-adsgram-daily] giving up after " . count($attempts) . " attempts: " . $result['error'] . "\n");
    exit(1);
}
echo "[sync-adsgram-daily] ok — rows_written=" . $result['rows_written'] . "\n";
exit(0);
