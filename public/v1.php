<?php
/**
 * SetaLink multi-node API (v1).
 *
 * Intended host: https://api.setalink.net/v1/...  (the URL the installed app
 * already calls — see mobile-app/src/services/api/client.ts). Implemented as a
 * standalone file so the action-based bootstrap surface in api.php is untouched
 * (existing bootstrap/entitlement behaviour is preserved verbatim).
 *
 *   GET /v1/servers              -> ServerRecord[]      (node catalog, no secrets)
 *   GET /v1/servers/{id}/config  -> ServerCredentials   (per-node connect params)
 *
 * Auth: Authorization: Bearer device-<device_id>   (registered device)
 *                       Bearer anon-token-<ts>      (anonymous install)
 * Device identity is taken from the bearer token alone (the app sends no
 * device_id on these calls).
 *
 * Routing policy (test-only Helsinki):
 *   - The primary/default node (Denmark prod, from bootstrap_* settings) is
 *     visible and connectable to EVERY valid client. Denmark stays default.
 *   - Test nodes (Helsinki) are visible/connectable ONLY to devices in
 *     node_allowlist. No user is routed automatically.
 *   - Every /config fetch is recorded in node_usage for admin visibility.
 */

declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Client');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

define('V1_DB_PATH', __DIR__ . '/../data/analytics.db');

// ── DB ───────────────────────────────────────────────────────────────────────
function v1_db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . V1_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec("PRAGMA journal_mode=WAL");
    $pdo->exec("CREATE TABLE IF NOT EXISTS node_allowlist (
        device_id TEXT NOT NULL, node_id TEXT NOT NULL, added_at TEXT,
        PRIMARY KEY (device_id, node_id))");
    $pdo->exec("CREATE TABLE IF NOT EXISTS node_usage (
        device_id TEXT NOT NULL, node_id TEXT NOT NULL,
        first_seen TEXT, last_seen TEXT, hits INTEGER DEFAULT 0,
        PRIMARY KEY (device_id, node_id))");
    return $pdo;
}

function v1_send($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// ── Auth: extract device identity from the bearer token ───────────────────────
function v1_bearer(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    return preg_match('/Bearer\s+(.+)/i', $h, $m) ? trim($m[1]) : '';
}

// ── Node registry ─────────────────────────────────────────────────────────────
// Primary/default node: read live from the existing bootstrap_* settings so it
// can never drift from what api.php?action=bootstrap already serves users.
function v1_primary_node(PDO $pdo): array {
    $r = [];
    try {
        $r = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'bootstrap_%'")
                 ->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (\Throwable $e) { $r = []; }
    $creds = [
        'uuid'        => $r['bootstrap_uuid']   ?? '',
        'address'     => $r['bootstrap_address'] ?? '',
        'port'        => (int)($r['bootstrap_port'] ?? 443),
        'publicKey'   => $r['bootstrap_pubkey'] ?? '',
        'shortId'     => $r['bootstrap_shortid'] ?? '',
        'sni'         => $r['bootstrap_sni'] ?? 'www.cloudflare.com',
        'flow'        => $r['bootstrap_flow'] ?? '',
        'fingerprint' => $r['bootstrap_fp'] ?? 'chrome',
        'edgeAddress' => $r['bootstrap_edge_address'] ?? '',
        'edgePort'    => (int)($r['bootstrap_edge_port'] ?? 443),
        'wsPath'      => $r['bootstrap_ws_path'] ?? '/ws',
        'xhttpPath'   => $r['bootstrap_xhttp_path'] ?? '/xhttp',
        'httpupPath'  => $r['bootstrap_httpup_path'] ?? '/httpup',
        'altProfiles' => json_decode($r['bootstrap_alt_profiles'] ?? '[]', true) ?: [],
    ];
    return [
        'id'   => 'primary',
        'test' => false,
        'meta' => [
            'id'       => 'primary',
            'country'  => $r['bootstrap_country'] ?? 'Germany',
            'city'     => $r['bootstrap_city'] ?? 'SetaLink Cloudflare',
            'flag'     => $r['bootstrap_flag'] ?? '🇩🇪',
            'ping'     => 0,
            'load'     => 0,
            'protocol' => 'Reality',
            'transport'=> 'reality',
            'tags'     => ['Recommended'],
            'premium'  => false,
        ],
        'creds' => $creds,
    ];
}

// Helsinki secondary TEST node. Public key / shortId are non-secret; the test
// UUID is a dedicated test credential (not a real user). Private keys live only
// on the Helsinki box. Mirrors the prod inbound structure (Reality + edge).
function v1_helsinki_node(): array {
    return [
        'id'   => 'fi-hel',
        'test' => false,   // promoted to public routing (v0.9.35) — visible & connectable to all
        'meta' => [
            'id'       => 'fi-hel',
            'country'  => 'Finland',
            'city'     => 'Helsinki',
            'flag'     => '🇫🇮',
            'ping'     => 0,
            'load'     => 0,
            'protocol' => 'Reality',
            'transport'=> 'reality',
            'tags'     => ['New'],
            'premium'  => false,
        ],
        'creds' => [
            'uuid'        => '92a861cd-6029-4882-9de5-35d9291e0828',
            'address'     => '65.109.183.7',
            'port'        => 443,
            'publicKey'   => 'eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU',
            'shortId'     => 'b3a824bd',
            'sni'         => 'www.cloudflare.com',
            'flow'        => 'xtls-rprx-vision',
            'fingerprint' => 'chrome',
            'edgeAddress' => 'fi.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            'altProfiles' => [],
        ],
    ];
}

function v1_nodes(PDO $pdo): array {
    $p = v1_primary_node($pdo);
    $h = v1_helsinki_node();
    return [$p['id'] => $p, $h['id'] => $h];
}

// Per-node health written by scripts/check-node-health.sh (cron). Returns the
// node map, or [] when missing/unreadable.
function v1_health(): array {
    static $h;
    if ($h !== null) return $h;
    $h = [];
    $raw = @file_get_contents(__DIR__ . '/../data/node_health.json');
    if ($raw !== false) {
        $j = json_decode($raw, true);
        if (is_array($j) && isset($j['nodes']) && is_array($j['nodes'])) $h = $j['nodes'];
    }
    return $h;
}

// A node is considered DOWN only on a FRESH 'down' reading (≤15 min old). Stale
// health (cron stopped) fails OPEN — we keep serving rather than hide everything.
function v1_node_down(string $id): bool {
    $n = v1_health()[$id] ?? null;
    if (!$n || ($n['status'] ?? '') !== 'down') return false;
    $age = time() - strtotime((string)($n['checked_at'] ?? '1970-01-01'));
    return $age >= 0 && $age <= 900;
}

function v1_device_allowed(PDO $pdo, ?string $deviceId, string $nodeId): bool {
    if ($deviceId === null || $deviceId === '') return false;
    $st = $pdo->prepare("SELECT 1 FROM node_allowlist WHERE device_id = ? AND node_id = ?");
    $st->execute([$deviceId, $nodeId]);
    return (bool)$st->fetchColumn();
}

function v1_record_usage(PDO $pdo, ?string $deviceId, string $nodeId): void {
    if ($deviceId === null || $deviceId === '') return;
    $now = gmdate('c');
    $pdo->prepare(
        "INSERT INTO node_usage (device_id, node_id, first_seen, last_seen, hits)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(device_id, node_id) DO UPDATE SET last_seen = excluded.last_seen, hits = hits + 1"
    )->execute([$deviceId, $nodeId, $now, $now]);
}

// ── Route ──────────────────────────────────────────────────────────────────────
$tok = v1_bearer();
if ($tok === '') {
    // 401 makes the app log out; only do it when there is no credential at all.
    v1_send(['message' => 'missing bearer token'], 401);
}
$deviceId = null;
if (strncmp($tok, 'device-', 7) === 0)      $deviceId = substr($tok, 7);
elseif (strncmp($tok, 'anon-token-', 11) === 0) $deviceId = null;          // valid but anonymous
// Unknown token shapes are treated as anonymous (NOT 401) to avoid logging users out.

// Relative path after /v1 (works with PATH_INFO or a rewritten REQUEST_URI).
$rel = $_SERVER['PATH_INFO'] ?? '';
if ($rel === '') {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '';
    $rel = preg_replace('#^.*?/v1#', '', $uri);
}
$rel = '/' . ltrim($rel, '/');

$pdo   = v1_db();
$nodes = v1_nodes($pdo);

if ($rel === '/servers') {
    $health = v1_health();
    $out = [];
    foreach ($nodes as $id => $n) {
        if ($n['test'] && !v1_device_allowed($pdo, $deviceId, $id)) continue; // hide test nodes
        // Auto-hide a non-primary node that is freshly DOWN, so users aren't
        // routed to a dead box. Primary is never hidden (last-resort default).
        if ($id !== 'primary' && v1_node_down($id)) continue;
        $meta = $n['meta'];
        // Annotate live ping from the latest health probe when available.
        $rtt = $health[$id]['rtt_ms'] ?? null;
        if (is_int($rtt)) $meta['ping'] = $rtt;
        $out[] = $meta;
    }
    v1_send($out);
}

if (preg_match('#^/servers/([^/]+)/config$#', $rel, $m)) {
    $id = $m[1];
    if (!isset($nodes[$id])) v1_send(['message' => 'unknown server'], 404);
    $n = $nodes[$id];
    if ($n['test'] && !v1_device_allowed($pdo, $deviceId, $id)) {
        v1_send(['message' => 'device not authorized for this node'], 403);
    }
    // Refuse to hand out creds for a node that is freshly down (clients fall back
    // to primary / saved bootstrap). Primary is exempt — it's the last resort.
    if ($id !== 'primary' && v1_node_down($id)) {
        v1_send(['message' => 'node temporarily unavailable'], 503);
    }
    v1_record_usage($pdo, $deviceId, $id);
    v1_send($n['creds']);
}

v1_send(['message' => 'not found'], 404);
