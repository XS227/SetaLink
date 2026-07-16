<?php
/**
 * Starlink gateway heartbeat ingestion — standalone endpoint, deliberately
 * separate from public/v1.php (user-facing) and admin/api.php (admin-session
 * auth). Auth here is a per-node secret, unrelated to any user device token
 * or admin cookie, so a leaked heartbeat token cannot be used to impersonate
 * a user or reach the admin panel, and vice versa.
 *
 * Called by the Starlink gateway device (deploy/starlink/gateway/heartbeat.sh)
 * every ~30s over plain HTTPS to the VPS's normal public address — NOT through
 * the WireGuard tunnel itself, so a dead tunnel can still be reported as dead.
 *
 *   POST /starlink-heartbeat.php
 *   Authorization: Bearer starlink-node-<node_id>:<secret>
 *   Body (JSON or form): tunnel_status, latency_ms, packet_loss_pct,
 *     recent_disconnects, measured_download_kbps, measured_upload_kbps,
 *     current_usage_kbps, current_sessions, uptime_secs, software_version,
 *     last_error, public_ipv4, public_ipv6, exit_ip
 */

declare(strict_types=1);

header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method not allowed']);
    exit;
}

require_once __DIR__ . '/../lib/starlink.php';

function hb_send(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function hb_db(): PDO {
    $pdo = new PDO('sqlite:' . __DIR__ . '/../data/analytics.db', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    return $pdo;
}

function hb_bearer(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    return preg_match('/Bearer\s+(.+)/i', $h, $m) ? trim($m[1]) : '';
}

function hb_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    $json = json_decode($raw, true);
    if (is_array($json)) return $json;
    return $_POST;
}

$tok = hb_bearer();
if (!preg_match('/^starlink-node-([a-z0-9-]+):(.+)$/i', $tok, $m)) {
    hb_send(['ok' => false, 'error' => 'invalid bearer format'], 401);
}
$nodeId = $m[1];
$secret = $m[2];

$pdo = hb_db();
st_init_tables($pdo);
$node = st_get($pdo, $nodeId);
if (!$node) hb_send(['ok' => false, 'error' => 'unknown node'], 404);
if (!st_verify_heartbeat_token($node, $secret)) {
    hb_send(['ok' => false, 'error' => 'invalid token'], 401);
}

st_apply_heartbeat($pdo, $nodeId, hb_body());

$fresh = st_get($pdo, $nodeId);
// Config comes back on every heartbeat response — the gateway never needs a
// separate poll/pull request or a redeploy to pick up an admin change
// (enable/disable, maintenance, limits). See st_gateway_config() for exactly
// what's included (never secrets).
hb_send([
    'ok'           => true,
    'health_state' => st_health_state($fresh),
    'config'       => st_gateway_config($fresh),
]);
