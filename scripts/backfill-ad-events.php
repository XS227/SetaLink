<?php
// One-time (but safely re-runnable) backfill: populates ad_events/ad_daily_metrics
// from the legacy ad_reward_events / ad_perf_daily / app_events tables, via
// am_backfill() (lib/ad_monetization.php). Idempotent — a second run only
// reports duplicates, never double-inserts.
//
// Usage:
//   php scripts/backfill-ad-events.php --dry-run   # report counts, write nothing
//   php scripts/backfill-ad-events.php             # actually write
declare(strict_types=1);

require_once __DIR__ . '/../lib/ad_monetization.php';

$dryRun = in_array('--dry-run', $argv, true);
$dbPath = realpath(__DIR__ . '/../data') . '/analytics.db';
if (!$dbPath || !is_readable($dbPath)) {
    fwrite(STDERR, "Cannot find/read analytics.db at " . __DIR__ . "/../data/analytics.db\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA busy_timeout=5000');

$before = [
    'ad_events'        => (int)$pdo->query("SELECT COUNT(*) FROM ad_events")->fetchColumn(),
    'ad_daily_metrics' => (int)$pdo->query("SELECT COUNT(*) FROM ad_daily_metrics")->fetchColumn(),
];

echo ($dryRun ? "[DRY RUN] " : "") . "Backfilling from ad_reward_events / ad_perf_daily / app_events…\n";
$stats = am_backfill($pdo, $dryRun);
echo "  admob_reward events processed: {$stats['admob_reward']}\n";
echo "  adsgram_daily rows processed:  {$stats['adsgram_daily']}\n";
echo "  banner events processed:       {$stats['banner']}\n";
echo "  interstitial impression events: " . ($stats['interstitial_events'] ?? 0) . "\n";
echo "  interstitial days rolled up:    " . ($stats['interstitial'] ?? 0) . "\n";
echo "  skipped as duplicates:         {$stats['skipped_dupe']}\n";

if (!$dryRun) {
    $after = [
        'ad_events'        => (int)$pdo->query("SELECT COUNT(*) FROM ad_events")->fetchColumn(),
        'ad_daily_metrics' => (int)$pdo->query("SELECT COUNT(*) FROM ad_daily_metrics")->fetchColumn(),
    ];
    echo "\nad_events:        {$before['ad_events']} -> {$after['ad_events']}\n";
    echo "ad_daily_metrics: {$before['ad_daily_metrics']} -> {$after['ad_daily_metrics']}\n";
} else {
    echo "\n(dry run — no rows were written; re-run without --dry-run to apply)\n";
}
