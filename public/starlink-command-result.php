<?php
/**
 * Node Console (Phase 1) -- gateway reports the result of a command back to
 * the server. Same per-node bearer auth as public/starlink-heartbeat.php
 * (deliberately, so this never needs its own credential to manage).
 *
 *   POST /starlink-command-result.php
 *   Authorization: Bearer starlink-node-<node_id>:<secret>
 *
 * Two shapes, both handled here:
 *
 * 1. Admin-enqueued command result (command_id present -- verified against
 *    the signed token from the heartbeat response before being accepted):
 *    { command_id, token, success, exit_code, output, duration_ms,
 *      health_before?, health_after? }
 *
 * 2. Watchdog self-heal report (no command_id -- nothing was server-issued;
 *    the node decided on its own to repair something). Only needs valid
 *    node auth, same as heartbeat itself:
 *    { self_heal: true, recovery_action, success, duration_ms,
 *      health_before?, health_after? }
 *
 * See lib/node_console.php and docs/NODE_CONSOLE_ARCHITECTURE.md.
 */

declare(strict_types=1);

header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method not allowed']);
    exit;
}

require_once __DIR__ . '/../lib/starlink.php';
require_once __DIR__ . '/../lib/node_console.php';

function cr_send(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function cr_db(): PDO {
    $pdo = new PDO('sqlite:' . __DIR__ . '/../data/analytics.db', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    return $pdo;
}

function cr_bearer(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    return preg_match('/Bearer\s+(.+)/i', $h, $m) ? trim($m[1]) : '';
}

function cr_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    $json = json_decode($raw, true);
    if (is_array($json)) return $json;
    return $_POST;
}

$tok = cr_bearer();
if (!preg_match('/^starlink-node-([a-z0-9-]+):(.+)$/i', $tok, $m)) {
    cr_send(['ok' => false, 'error' => 'invalid bearer format'], 401);
}
$nodeId = $m[1];
$secret = $m[2];

$pdo = cr_db();
st_init_tables($pdo);
nc_init_tables($pdo);
// Same generic 401 for unknown node_id vs wrong secret -- see
// starlink-heartbeat.php for why (avoid node_id enumeration).
$node = st_get($pdo, $nodeId);
if (!$node || !st_verify_heartbeat_token($node, $secret)) {
    cr_send(['ok' => false, 'error' => 'invalid token'], 401);
}

$body = cr_body();
$durationMs = isset($body['duration_ms']) && $body['duration_ms'] !== '' ? max(0, (int)$body['duration_ms']) : null;
$healthBefore = isset($body['health_before']) ? substr((string)$body['health_before'], 0, 30) : null;
$healthAfter  = isset($body['health_after'])  ? substr((string)$body['health_after'], 0, 30)  : null;
$success = (bool)($body['success'] ?? false);

if (($body['self_heal'] ?? false)) {
    $recoveryAction = substr((string)($body['recovery_action'] ?? 'unknown'), 0, 60);
    nc_report_self_heal($pdo, $nodeId, $recoveryAction, $success, $durationMs, $healthBefore, $healthAfter);
    cr_send(['ok' => true, 'recorded' => 'self_heal']);
}

$commandId = (string)($body['command_id'] ?? '');
$token     = (string)($body['token'] ?? '');
if ($commandId === '' || $token === '') {
    cr_send(['ok' => false, 'error' => 'command_id and token required (or set self_heal:true)'], 400);
}

$exitCode = isset($body['exit_code']) && $body['exit_code'] !== '' ? (int)$body['exit_code'] : null;
$output   = (string)($body['output'] ?? '');

$ok = nc_report_command_result($pdo, $nodeId, $commandId, $token, $success, $exitCode, $output, $durationMs, $healthBefore, $healthAfter);
if (!$ok) cr_send(['ok' => false, 'error' => 'unknown command_id or invalid/expired token'], 400);

cr_send(['ok' => true, 'recorded' => 'command_result']);
