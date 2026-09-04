<?php
// Daily Google Search Console → keyword_ranks sync. CLI ONLY (not web-reachable).
// Install (as the owner): add to crontab, e.g. once a day:
//   17 6 * * * php /var/www/setalink/admin/gsc_cron.php >> /var/log/gsc-sync.log 2>&1
if (PHP_SAPI !== 'cli') { http_response_code(403); exit("cli only\n"); }

require_once __DIR__ . '/gsc_sync.php';

// Minimal helpers needed by gsc_sync (seo_ranks_init/seed live in api.php, which
// we must not fully include here because it runs the auth gate + request handler).
function open_analytics_db(): PDO {
    $db = new PDO('sqlite:' . realpath(__DIR__ . '/../data') . '/analytics.db', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    return $db;
}
function seo_ranks_init(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS keyword_ranks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL, lang TEXT DEFAULT "fa",
        position REAL, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
        source TEXT DEFAULT "manual", captured_at TEXT NOT NULL DEFAULT (datetime("now")))');
    $db->exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "", updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
}

try {
    $db = open_analytics_db();
    if (!gsc_key_present()) { fwrite(STDERR, "[gsc-cron] key missing at " . GSC_KEY_PATH . "\n"); exit(1); }
    $r = gsc_sync($db);
    fprintf(STDOUT, "[gsc-cron] %s  %s  snapshots=%d keywords=%d\n",
        date('c'), $r['window'], $r['snapshots'], $r['keywords_hit']);
} catch (\Throwable $e) {
    fwrite(STDERR, "[gsc-cron] ERROR: " . $e->getMessage() . "\n");
    exit(1);
}
