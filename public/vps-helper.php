<?php
/**
 * ReaLink VPS Helper — device-facing API (STANDALONE endpoint).
 *
 * Served at setalink.no/vps-helper.php — deliberately separate from api.php so
 * the mobile bootstrap / Smart Mode path is provably untouched. Same token gate
 * and device-id model as the rest of the mobile API.
 *
 *   GET  ?mobile=1&action=vps-helper-status   &_token=..&device_id=..
 *   POST ?mobile=1&action=vps-helper-provision  body: _token, device_id
 *   POST ?mobile=1&action=vps-helper-revoke     body: _token, device_id
 *
 * Returns { ok, data } where data is vh_public_view(): status +, when active,
 * the single install_command the user pastes into their VPS. No UUID/profile is
 * ever surfaced separately.
 */
declare(strict_types=1);

if (($_GET['mobile'] ?? '') !== '1') { http_response_code(404); exit; }

const MOBILE_TOKEN = 'setalink-mobile-diag-v1';
define('DB_PATH', __DIR__ . '/../data/analytics.db');
require_once __DIR__ . '/../lib/vps_helper.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
$token  = ($method === 'POST') ? ($_POST['_token'] ?? $_GET['_token'] ?? '') : ($_GET['_token'] ?? '');

function vok($d): never { echo json_encode(['ok' => true,  'data'  => $d]); exit; }
function verr($m): never { echo json_encode(['ok' => false, 'error' => $m]); exit; }

if (!hash_equals(MOBILE_TOKEN, (string)$token)) verr('invalid token');

$device = trim((string)($_POST['device_id'] ?? $_GET['device_id'] ?? ''));
$ip     = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
$ip     = trim(explode(',', $ip)[0]);
if ($device === '') verr('device_id required');

try {
    $db = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec("PRAGMA journal_mode=WAL");
    $db->exec("PRAGMA busy_timeout=3000");
    vh_init($db);
} catch (\Throwable $e) {
    verr('backend unavailable');
}

$actor = "device:$device";

if ($method === 'GET' && $action === 'vps-helper-status') {
    vok(vh_public_view(vh_get($db, $device)));
}
if ($method === 'POST' && $action === 'vps-helper-provision') {
    $r = vh_request_provision($db, $device, $actor, $ip);
    if (!$r['ok']) verr($r['error']);
    vok(vh_public_view($r['row']));
}
if ($method === 'POST' && $action === 'vps-helper-revoke') {
    $r = vh_request_revoke($db, $device, $actor, $ip);
    if (!$r['ok']) verr($r['error']);
    vok(vh_public_view($r['row']));
}

http_response_code(404);
verr('unknown action');
