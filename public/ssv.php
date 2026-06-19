<?php
/**
 * AdMob rewarded-ad Server-Side Verification (SSV) callback.
 *
 * Public endpoint Google calls after a verified rewarded impression. Authenticated
 * by AdMob's ECDSA signature (NOT the mobile token) — so it lives outside api.php's
 * token gate. This is the TRUSTED reward path: the client cannot forge it.
 *
 * Configure in AdMob console → ad unit → Server-side verification:
 *   Callback URL: https://setalink.no/ssv.php
 *   Custom data : user_id={DEVICE_ID}   (set by the app at ad-load time)
 *
 * Until admob_* settings + reachable verifier keys exist, signatures won't validate
 * and nothing is granted. See docs/REWARDED-ADS-RECOVERY.md §4.
 *
 * Response policy: 200 once the request is definitively handled (success OR proven
 * bad signature); 503 only on a transient key-fetch failure so AdMob retries.
 */

declare(strict_types=1);
header('Content-Type: text/plain');

require_once __DIR__ . '/../lib/ads_recovery.php';

define('SSV_DB_PATH', __DIR__ . '/../data/analytics.db');

try {
    $pdo = new PDO('sqlite:' . SSV_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    ar_init_tables($pdo);
} catch (\Throwable $e) {
    http_response_code(503);
    echo 'db unavailable';
    exit;
}

$cfg = ar_config($pdo);
$raw = $_SERVER['QUERY_STRING'] ?? '';

$res = ar_verify_ssv($pdo, $raw, $cfg);
if (!$res['ok']) {
    // Distinguish a transient key outage (retryable) from a bad/forged signature.
    if (($res['reason'] ?? '') === 'unknown key_id' && ar_ssv_keys($pdo, $cfg) === []) {
        http_response_code(503);
        echo 'verifier keys unavailable';
        exit;
    }
    http_response_code(200); // definitively rejected — do not ask AdMob to retry
    echo 'rejected: ' . ($res['reason'] ?? 'invalid');
    exit;
}

$deviceId = $res['device_id'] ?? '';
$nonce    = $res['nonce'] ?? '';
if ($deviceId === '' || $nonce === '') {
    http_response_code(200);
    echo 'rejected: missing user_id/transaction_id';
    exit;
}

try {
    $out = ar_confirm_reward($pdo, $deviceId, $nonce, 'ssv', true, $cfg);
    http_response_code(200);
    echo !empty($out['granted']) ? 'ok granted' : (!empty($out['already']) ? 'ok duplicate' : 'ok held');
} catch (\Throwable $e) {
    http_response_code(503); // transient server error — allow AdMob retry
    echo 'error';
}
