<?php
// OAuth redirect target for the AdMob "Connect" flow (admin_oauth_start.php).
// Auth is enforced upstream by nginx auth_basic, same posture as admin/qr.php.
declare(strict_types=1);

require_once __DIR__ . '/../lib/admob_sync.php';
require_once __DIR__ . '/../lib/ad_monetization.php';

function admob_cb_db(): PDO {
    $db = new PDO('sqlite:' . realpath(__DIR__ . '/../data') . '/analytics.db', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "",
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    return $db;
}

header('Content-Type: text/html; charset=utf-8');

function admob_cb_page(string $title, string $body): never {
    echo '<!doctype html><html><head><meta charset="utf-8"><title>' . htmlspecialchars($title)
       . '</title></head><body style="font:14px system-ui;background:#0b0f1a;color:#e6ebff;padding:2rem">'
       . '<h2>' . htmlspecialchars($title) . '</h2><p>' . $body . '</p>'
       . '<p><a href="/admin/#monetization" style="color:#7aa2f7">&larr; Back to RealGram Admin</a></p>'
       . '</body></html>';
    exit;
}

$error = (string)($_GET['error'] ?? '');
if ($error !== '') {
    admob_cb_page('AdMob connection failed', htmlspecialchars($error));
}

$code  = (string)($_GET['code'] ?? '');
$state = (string)($_GET['state'] ?? '');
if ($code === '' || $state === '') {
    admob_cb_page('AdMob connection failed', 'Missing code or state in callback.');
}

$db = admob_cb_db();
$expected = (string)($db->query("SELECT value FROM settings WHERE key='admob_oauth_state'")->fetchColumn() ?: '');
// Single-use: clear immediately regardless of outcome, so a replayed callback URL can't reconnect.
$db->exec("DELETE FROM settings WHERE key='admob_oauth_state'");
if ($expected === '' || !hash_equals($expected, $state)) {
    admob_cb_page('AdMob connection failed', 'Invalid or expired state (possible CSRF or double-submit) — please retry the Connect AdMob button.');
}

try {
    admob_exchange_code($code);
    am_log($db, 'admin', 'admob_oauth_connected', []);
    admob_cb_page('AdMob connected', 'The refresh token was stored. You can close this tab and return to RealGram Admin — Monetization → AdMob will sync on the next scheduled run, or click "Sync now".');
} catch (\Exception $e) {
    admob_cb_page('AdMob connection failed', htmlspecialchars($e->getMessage()));
}
