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
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Client');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

define('V1_DB_PATH', __DIR__ . '/../data/analytics.db');

// Rewarded ads + hidden recovery quota (shared logic; brings quota_economy too).
require_once __DIR__ . '/../lib/ads_recovery.php';
// Premium payments (USDT + REAL token).
require_once __DIR__ . '/../lib/payments.php';
// Node intelligence — connect telemetry.
require_once __DIR__ . '/../lib/node_intel.php';

/** Read a POST field from form-encoded body or a JSON body. */
function v1_body(string $key, string $default = ''): string {
    if (isset($_POST[$key])) return trim((string)$_POST[$key]);
    static $json;
    if ($json === null) {
        $raw  = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true) ?: [];
    }
    return isset($json[$key]) ? trim((string)$json[$key]) : $default;
}

/** Best-effort client IP (honours a single proxy hop) for ad anti-abuse. */
function v1_client_ip(): string {
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') { $p = trim(explode(',', $xff)[0]); if ($p !== '') return $p; }
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

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
// Per-device UUID overrides for diagnostic isolation (keyed by device ID fragment).
// These map to dedicated VLESS users on fi-hel port 8443 so individual device
// traffic is identifiable in the access log without sharing the shared fi-tester slot.
const V1_FI_HEL_DEVICE_UUIDS = [
    'sl-ec58c486' => '06f75644-a38a-4591-a063-294673bbbcb4',   // SL-227-6888F163
    'sl-6341972a' => '2bae0b05-ca90-4abe-89ce-21bcdc9c64c2',   // SL-227-FEF6C131
    'sl-a7bf102e' => '61cbd9b6-e617-4ae5-9d31-17d6a9f8c56b',   // SL-227-2DA1D1C0
];

function v1_helsinki_node(?string $deviceId = null): array {
    // Per-device credential isolation: if this device has a dedicated UUID on fi-hel,
    // use it so we can distinguish their traffic in xray access.log.
    $uuid = '92a861cd-6029-4882-9de5-35d9291e0828';
    if ($deviceId !== null) {
        foreach (V1_FI_HEL_DEVICE_UUIDS as $fragment => $devUuid) {
            if (str_contains($deviceId, $fragment)) {
                $uuid = $devUuid;
                break;
            }
        }
    }
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
            'uuid'        => $uuid,
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
            // Real multi-SNI: each is a dedicated Reality inbound on the node with a
            // matching dest cert (8444=microsoft, 8445=apple), routed by nginx SNI on
            // :443. Same keypair/UUID/shortId as the cloudflare profile — only the SNI
            // (and client fingerprint) differs. Verified end-to-end 2026-06-16.
            'altProfiles' => [
                [
                    'uuid'        => '92a861cd-6029-4882-9de5-35d9291e0828',
                    'address'     => '65.109.183.7',
                    'port'        => 443,
                    'publicKey'   => 'eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU',
                    'shortId'     => 'b3a824bd',
                    'sni'         => 'www.microsoft.com',
                    'flow'        => 'xtls-rprx-vision',
                    'fingerprint' => 'chrome',
                ],
                [
                    'uuid'        => '92a861cd-6029-4882-9de5-35d9291e0828',
                    'address'     => '65.109.183.7',
                    'port'        => 443,
                    'publicKey'   => 'eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU',
                    'shortId'     => 'b3a824bd',
                    'sni'         => 'www.apple.com',
                    'flow'        => 'xtls-rprx-vision',
                    'fingerprint' => 'safari',
                ],
            ],
        ],
    ];
}

function v1_nodes(PDO $pdo, ?string $deviceId = null): array {
    $p = v1_primary_node($pdo);
    $h = v1_helsinki_node($deviceId);
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
// Relative path after /v1 (works with PATH_INFO or a rewritten REQUEST_URI).
// Computed BEFORE the bearer guard so genuinely public routes can be exempted.
$rel = $_SERVER['PATH_INFO'] ?? '';
if ($rel === '') {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '';
    $rel = preg_replace('#^.*?/v1#', '', $uri);
}
$rel = '/' . ltrim($rel, '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Public, no-bearer routes: the Premium catalog must render prices before a user
// has any identity. A 401 here makes the app log out (and blanks the Profile tab),
// so these are exempt from the bearer guard.
$publicRoutes = ($rel === '/payments/packages' && $method === 'GET');

$tok = v1_bearer();
if ($tok === '' && !$publicRoutes) {
    // 401 makes the app log out; only do it when there is no credential at all.
    v1_send(['message' => 'missing bearer token'], 401);
}
$deviceId = null;
if (strncmp($tok, 'device-', 7) === 0)      $deviceId = substr($tok, 7);
elseif (strncmp($tok, 'anon-token-', 11) === 0) $deviceId = null;          // valid but anonymous
// Unknown token shapes are treated as anonymous (NOT 401) to avoid logging users out.

$pdo   = v1_db();

// ── Rewarded ads + recovery quota ────────────────────────────────────────────
// These require a registered device identity (device-<id> bearer). Server is the
// single source of truth; the client never grants quota locally.
if ($rel === '/quota/status' || strncmp($rel, '/ads/', 5) === 0 || $rel === '/quota/recovery/enter') {
    ar_init_tables($pdo);
    $cfg = ar_config($pdo);
    if ($deviceId === null || $deviceId === '') v1_send(['message' => 'device identity required'], 403);

    if ($rel === '/quota/status' && $method === 'GET') {
        $state = ar_recovery_state($pdo, $deviceId, $cfg);
        v1_send([
            'visible_remaining_bytes'  => $state['visible_remaining_bytes'],
            'visible_total_bytes'      => $state['visible_total_bytes'],
            'in_recovery_eligible'     => $state['eligible'],
            'recovery_remaining_bytes' => $state['recovery_remaining_bytes'],
            'recovery_total_bytes'     => $state['recovery_total_bytes'],
            'ads'                      => ar_ad_stats($pdo, $deviceId, $cfg),
        ]);
    }

    if ($rel === '/ads/reward/init' && $method === 'POST') {
        $nonce = v1_body('nonce');
        v1_send(ar_init_reward($pdo, $deviceId, $nonce, v1_client_ip(), $cfg));
    }

    if ($rel === '/ads/reward/confirm' && $method === 'POST') {
        // Trusted grants come from AdMob SSV (ssv.php). This client path only
        // grants when explicitly enabled for staging; otherwise it is a no-op
        // acknowledgement so the app can poll status for the SSV-applied reward.
        $nonce = v1_body('nonce');
        if ((int)$cfg['dev_allow_client_confirm'] === 1) {
            v1_send(ar_confirm_reward($pdo, $deviceId, $nonce, 'client', false, $cfg));
        }
        v1_send(['granted' => false, 'pending_ssv' => true,
                 'state' => ar_recovery_state($pdo, $deviceId, $cfg),
                 'ads'   => ar_ad_stats($pdo, $deviceId, $cfg)]);
    }

    if ($rel === '/quota/recovery/enter' && $method === 'POST') {
        try {
            v1_send(ar_recovery_enter($pdo, $deviceId, $cfg));
        } catch (\RuntimeException $e) {
            v1_send(['message' => $e->getMessage()], 409);
        }
    }

    v1_send(['message' => 'method not allowed'], 405);
}

// ── Premium payments (USDT + REAL) ────────────────────────────────────────────
if ($rel === '/payments/packages' || strncmp($rel, '/payments/', 10) === 0) {
    $pcfg = pay_config($pdo);

    // Catalog is public (no device needed) so the Premium screen can render prices.
    if ($rel === '/payments/packages' && $method === 'GET') {
        v1_send([
            'packages' => pay_packages($pdo, true, $pcfg),
            'methods'  => pay_methods_status($pcfg),   // app hides methods that aren't ready
            'real'     => [
                'discount_percent' => (float)$pcfg['real_discount_percent'],
                'token_address'    => $pcfg['real_token_address'],
                'usd_rate'         => (float)$pcfg['real_usd_rate'],      // USD value of 1 REAL (0 = unknown)
                'rate_updated_at'  => (string)$pcfg['real_rate_updated_at'],
            ],
        ]);
    }

    // Intent + status require a registered device identity.
    if ($deviceId === null || $deviceId === '') v1_send(['message' => 'device identity required'], 403);

    if ($rel === '/payments/intent' && $method === 'POST') {
        try {
            v1_send(pay_create_intent($pdo, $deviceId, v1_body('package_id'), strtoupper(v1_body('payment_method')), $pcfg));
        } catch (\RuntimeException $e) {
            v1_send(['message' => $e->getMessage()], 400);
        }
    }

    if ($rel === '/payments/status' && $method === 'GET') {
        $pid = (int)($_GET['id'] ?? 0);
        $i = pay_intent($pdo, $pid);
        if (!$i || $i['device_id'] !== $deviceId) v1_send(['message' => 'payment not found'], 404);
        v1_send(pay_check($pdo, $pid, $pcfg));
    }

    v1_send(['message' => 'method not allowed'], 405);
}

$nodes = v1_nodes($pdo, $deviceId);

// ── Connect telemetry ─────────────────────────────────────────────────────────
// POST /v1/telemetry/connect — anonymous connect outcome upload.
// No PII stored: country is geo-derived server-side; ISP/carrier are hashed.
// Intentionally lenient: always returns 200 so a failed telemetry POST never
// interrupts the user experience.
if ($rel === '/telemetry/connect' && $method === 'POST') {
    try {
        ni_init_tables($pdo);
        // Capture raw event before ni_valid_event normalises it (needed to detect 'disconnect')
        $rawTelemetryEvent = v1_body('event');
        // Derive country from the client IP (best-effort, may be empty).
        $clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
        if (str_contains($clientIp, ',')) $clientIp = trim(explode(',', $clientIp)[0]);
        if (!ni_telemetry_gate($pdo, $clientIp)) { v1_send(['ok' => true, 'throttled' => true]); }
        $country = '';
        if ($clientIp && $clientIp !== '127.0.0.1' && $clientIp !== '::1'
            && !str_starts_with($clientIp, '10.') && !str_starts_with($clientIp, '192.168.')) {
            // Use cached geo lookup if available in the analytics DB
            try {
                $gc = $pdo->prepare("SELECT country FROM geo_cache WHERE ip=? LIMIT 1");
                $gc->execute([$clientIp]);
                $country = (string)($gc->fetchColumn() ?: '');
            } catch (\Throwable $_) {}
            if ($country === '') {
                $ctx = stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]]);
                $raw = @file_get_contents("http://ip-api.com/json/{$clientIp}?fields=countryCode", false, $ctx);
                if ($raw) {
                    $j = json_decode($raw, true);
                    $country = substr((string)($j['countryCode'] ?? ''), 0, 4);
                }
            }
        }
        ni_record($pdo, [
            'event'         => $rawTelemetryEvent,
            'node_id'       => v1_body('node_id') ?: 'primary',
            'profile_id'    => v1_body('profile_id') ?: null,
            'sni'           => v1_body('sni'),
            'protocol'      => v1_body('protocol'),
            'platform'      => v1_body('platform'),
            'app_version'   => v1_body('app_version'),
            'build_number'  => (int)v1_body('build_number'),
            'network_type'  => v1_body('network_type'),
            'isp'           => v1_body('isp'),
            'carrier'       => v1_body('carrier'),
            'country'       => $country,
            'failure_stage' => v1_body('failure_stage'),
            'latency_ms'    => v1_body('latency_ms') !== '' ? v1_body('latency_ms') : null,
            'internet_ok'   => v1_body('internet_ok') !== '' ? v1_body('internet_ok') : null,
            'exit_ip_ok'    => v1_body('exit_ip_ok')  !== '' ? v1_body('exit_ip_ok')  : null,
            'probe_google'         => v1_body('probe_google')         !== '' ? v1_body('probe_google')         : null,
            'probe_apple'          => v1_body('probe_apple')          !== '' ? v1_body('probe_apple')          : null,
            'probe_telegram'       => v1_body('probe_telegram')       !== '' ? v1_body('probe_telegram')       : null,
            'probe_cloudflare'     => v1_body('probe_cloudflare')     !== '' ? v1_body('probe_cloudflare')     : null,
            'probe_instagram'      => v1_body('probe_instagram')      !== '' ? v1_body('probe_instagram')      : null,
            'disconnect_reason'    => v1_body('disconnect_reason'),
            'session_duration_secs'=> v1_body('session_duration_secs') !== '' ? (int)v1_body('session_duration_secs') : null,
            'bytes_sent'           => v1_body('bytes_sent')           !== '' ? (int)v1_body('bytes_sent')           : null,
            'bytes_recv'           => v1_body('bytes_recv')           !== '' ? (int)v1_body('bytes_recv')           : null,
            'dns_ok'               => v1_body('dns_ok')               !== '' ? v1_body('dns_ok')               : null,
            'time_to_connect_ms'   => v1_body('time_to_connect_ms')   !== '' ? (int)v1_body('time_to_connect_ms')   : null,
            'error_category'       => v1_body('error_category'),
            'carrier_name'         => v1_body('carrier_name'),
            'nat_type'             => v1_body('nat_type'),
            'ip_version'           => v1_body('ip_version'),
            'rtt_ms'               => v1_body('rtt_ms') !== '' ? (int)v1_body('rtt_ms') : null,
            'network_switched'     => v1_body('network_switched') !== '' ? v1_body('network_switched') : null,
            // Build 68 checkpoint fields
            'tunnel_mode'          => v1_body('tunnel_mode'),
            'cp1_readable'         => v1_body('cp1_readable'),
            'cp4_connections'      => v1_body('cp4_connections') !== '' ? (int)v1_body('cp4_connections') : null,
            'cp4_first_dest'       => v1_body('cp4_first_dest'),
            // Build 69 device context fields
            'ios_version'          => v1_body('ios_version'),
            'device_model'         => v1_body('device_model'),
        ]);
        ni_telemetry_rotate($pdo);
        // Auto-create structured diagnostic session for every disconnect event (build 68+).
        // Disconnect events carry CP1/CP4 summary data accumulated during the session.
        if ($rawTelemetryEvent === 'disconnect') {
            try {
                $telemetryRowId = (int)$pdo->lastInsertId();
                if ($telemetryRowId > 0) {
                    ni_create_diag_session($pdo, [
                        'node_id'             => v1_body('node_id') ?: 'primary',
                        'tunnel_mode'         => v1_body('tunnel_mode'),
                        'cp1_readable'        => v1_body('cp1_readable'),
                        'cp4_connections'     => v1_body('cp4_connections') !== '' ? (int)v1_body('cp4_connections') : 0,
                        'cp4_first_dest'      => v1_body('cp4_first_dest'),
                        'platform'            => v1_body('platform'),
                        'app_version'         => v1_body('app_version'),
                        'build_number'        => v1_body('build_number'),
                        'country'             => $country,
                        'ios_version'         => v1_body('ios_version'),
                        'device_model'        => v1_body('device_model'),
                        'network_type'        => v1_body('network_type'),
                        'carrier_name'        => v1_body('carrier_name'),
                        'disconnect_reason'   => v1_body('disconnect_reason'),
                        'session_duration_secs' => v1_body('session_duration_secs'),
                    ], $telemetryRowId);
                }
            } catch (\Throwable $_) {}
        }
    } catch (\Throwable $_) { /* swallow — telemetry must never break the user flow */ }
    v1_send(['ok' => true]);
}

if ($rel === '/servers') {
    $health = v1_health();
    // Load telemetry-derived success scores (last 7 days) for ranking.
    $scores = [];
    try { ni_init_tables($pdo); $scores = ni_node_scores($pdo, 7); } catch (\Throwable $_) {}
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
        // Annotate telemetry-based success score (0-100) when data exists.
        if (isset($scores[$id]['success_rate'])) {
            $meta['successScore'] = (float)$scores[$id]['success_rate'];
        }
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
