<?php
// Redirects the admin browser into Google's AdMob OAuth consent screen.
// Auth is enforced upstream by nginx auth_basic — same posture as admin/qr.php,
// this script trusts that PHP-FPM only receives requests that already passed it.
declare(strict_types=1);

require_once __DIR__ . '/../lib/admob_sync.php';

function admob_start_db(): PDO {
    $db = new PDO('sqlite:' . realpath(__DIR__ . '/../data') . '/analytics.db', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "",
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    return $db;
}

if (!admob_client_configured()) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("AdMob OAuth client not configured — see docs/realgram/MONETIZATION_REPORTING.md (" . ADMOB_CLIENT_CONFIG_PATH . " missing).\n");
}

$state = bin2hex(random_bytes(16));
$db = admob_start_db();
// Single-use, short-lived (10 min) CSRF state — no PHP session mechanism exists
// anywhere else in this admin panel (auth is stateless HTTP Basic), so this
// follows the same "settings table as storage" convention as ga4_token etc.
$db->prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('admob_oauth_state', ?, datetime('now'))")
    ->execute([$state]);

$url = admob_authorize_url($state);
if (!$url) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("Could not build AdMob authorize URL.\n");
}
header('Location: ' . $url);
exit;
