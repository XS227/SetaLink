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
// Starlink exit-node registry, health policy, and unlock-status.
require_once __DIR__ . '/../lib/starlink.php';

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
    // Wait for concurrent writers instead of throwing 'database is locked'.
    $pdo->exec("PRAGMA busy_timeout=5000");
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
    'sl-f877790f' => '157b463d-b67c-4148-885b-2d7f2255a972',   // Android Termius-tester (diag isolation 2026-07-03)
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

// Germany (Nürnberg) node — the original primary before the 2026-07-03 Finland
// flip. The box itself is fully healthy (Reality handshake + browsing verified
// from outside 2026-07-06); it is only unreachable FROM IRAN (SYNs arrive, the
// return path is dropped by Iranian filtering of the Hetzner IP). It therefore
// re-enters the catalog as a selectable node, but is geo-hidden for IR callers
// so Iranian users are never offered a node that is dead for them.
function v1_germany_node(): array {
    return [
        'id'   => 'de-nbg',
        'test' => false,
        'meta' => [
            'id'       => 'de-nbg',
            'country'  => 'Germany',
            'city'     => 'Nürnberg',
            'flag'     => '🇩🇪',
            'ping'     => 0,
            'load'     => 0,
            'protocol' => 'Reality',
            'transport'=> 'reality',
            'tags'     => [],
            'premium'  => false,
        ],
        'creds' => [
            // x-ui inbound on :443 (SNI cloudflare) — flow is EMPTY on this node,
            // unlike Finland (vision). Sending vision here breaks the handshake.
            'uuid'        => 'fd709d48-a983-484a-99e3-afc97e2c3692',
            'address'     => '91.107.158.53',
            'port'        => 443,
            'publicKey'   => 'IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8',
            'shortId'     => 'd93af82f2ecb7f6a',
            'sni'         => 'www.cloudflare.com',
            'flow'        => '',
            'fingerprint' => 'chrome',
            'edgeAddress' => 'edge.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            // :8443 (oracle) / :2052 (amazon) inbounds exist on the box but use
            // separate keypairs not registered here — left out until verified.
            'altProfiles' => [],
        ],
    ];
}

// Node 3 — ProISP/One.com box (Copenhagen, AS51468), SAME network as the control
// plane (5.249.252.221), so likely reachable from Iran (unlike Hetzner). Repaired
// 2026-07-06: dest→cloudflare (microsoft broke Reality), and xray now accepts the
// nginx PROXY-protocol header (sockopt.acceptProxyProtocol). Verified externally
// via :443 (google 200, exit 5.249.255.116). NOT geo-hidden — we WANT Iran to try
// it (that's the whole point). flow = vision (like Finland).
function v1_proisp_node(): array {
    return [
        'id'   => 'dk-cph',
        'test' => false,
        'meta' => [
            'id'       => 'dk-cph',
            'country'  => 'Denmark',
            'city'     => 'Copenhagen',
            'flag'     => '🇩🇰',
            'ping'     => 0,
            'load'     => 0,
            'protocol' => 'Reality',
            'transport'=> 'reality',
            'tags'     => ['New'],
            'premium'  => false,
        ],
        'creds' => [
            'uuid'        => '98d9b96f-a441-4462-a01d-267f31dae833',
            'address'     => '5.249.255.116',
            'port'        => 443,
            'publicKey'   => 'O3k2RgLQ29tEo8OSXzB3edIF_tom_9nu0PutucwMojk',
            'shortId'     => '0a1cba3f93dc95e9',
            'sni'         => 'www.cloudflare.com',
            'flow'        => 'xtls-rprx-vision',
            'fingerprint' => 'chrome',
            'edgeAddress' => 'edge.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            'altProfiles' => [],
        ],
    ];
}

// Country code (ISO-2) for the calling IP: geo_cache first, then a 1s ip-api
// lookup cached back into geo_cache. Fails open to '' (nodes stay visible) so
// a geo outage can never empty the server list.
function v1_client_country(PDO $pdo): string {
    static $cc;
    if ($cc !== null) return $cc;
    $cc = '';
    $ip = v1_client_ip();
    if ($ip === '' || $ip === '127.0.0.1' || $ip === '::1'
        || str_starts_with($ip, '10.') || str_starts_with($ip, '192.168.')) return $cc;
    try {
        $st = $pdo->prepare("SELECT country FROM geo_cache WHERE ip = ? LIMIT 1");
        $st->execute([$ip]);
        $cached = (string)($st->fetchColumn() ?: '');
        if ($cached !== '') return $cc = strtoupper($cached);
        $ctx = stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]]);
        $raw = @file_get_contents("http://ip-api.com/json/{$ip}?fields=countryCode", false, $ctx);
        if ($raw) {
            $j = json_decode($raw, true);
            $cc = strtoupper(substr((string)($j['countryCode'] ?? ''), 0, 4));
            if ($cc !== '') {
                $pdo->prepare("INSERT OR REPLACE INTO geo_cache (ip, country) VALUES (?, ?)")
                    ->execute([$ip, $cc]);
            }
        }
    } catch (\Throwable $_) { /* fail open */ }
    return $cc;
}

// Node IDs hidden for specific caller countries (reachability, not policy):
// 2026-07-09: Germany geo-hiding for IR REMOVED. Germany reachable from Iran
// on MCI/Hamrah-e Avval (verified 2026-07-09, tester on 86.55.155.206); the
// Hetzner blackhole is carrier-specific (Irancell/TCI), so let Iranian callers
// try de-nbg. Re-add 'de-nbg' => ['IR'] here to hide it again if needed.
const V1_GEO_HIDDEN_NODES = [];

function v1_node_geo_hidden(PDO $pdo, string $nodeId): bool {
    $hide = V1_GEO_HIDDEN_NODES[$nodeId] ?? null;
    if ($hide === null) return false;
    return in_array(v1_client_country($pdo), $hide, true);
}

// CDN edge node — VLESS-over-WebSocket fronted by Cloudflare (cf.setalink.no,
// orange-cloud → ProISP origin 5.249.255.116). The client connects to
// Cloudflare's anycast IPs over normal HTTPS, so Iran sees only Cloudflare
// traffic (unblockable) and the return path comes from Cloudflare, not the
// filtered ProISP→Iran route that broke direct Reality. Verified end-to-end
// 2026-07-07 (google 200, exit 5.249.255.116). Uses the app's WebSocket
// builder: edgeAddress/wsPath/uuid + built-in TLS fragmentation for DPI.
function v1_cfedge_node(): array {
    return [
        'id'   => 'cf-edge',
        'test' => false,
        'meta' => [
            'id'       => 'cf-edge',
            'country'  => 'Realink',
            'city'     => 'Secure Edge · Stealth',
            'flag'     => '🛡️',
            'ping'     => 0,
            'load'     => 0,
            'protocol' => 'WebSocket',
            'transport'=> 'ws',
            'tags'     => ['Stealth'],
            'premium'  => false,
        ],
        'creds' => [
            'uuid'        => '69205cf6-23a7-4e64-a1a2-865fd49471fe',
            'address'     => 'alanya-turist.no',
            'port'        => 443,
            // WS builder reads edgeAddress (host + SNI + Host header), edgePort,
            // wsPath. Cloudflare presents a valid cert for cf.setalink.no, so
            // allowInsecure stays false.
            'edgeAddress' => 'alanya-turist.no',
            'edgePort'    => 443,
            'wsPath'      => '/cfws',
            'sni'         => 'alanya-turist.no',
            'publicKey'   => '',
            'shortId'     => '',
            'flow'        => '',
            'fingerprint' => 'chrome',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            'altProfiles' => [],
        ],
    ];
}

// Starlink node — 'test' => true so it's gated by the SAME node_allowlist
// mechanism as Helsinki above (v1_device_allowed), not a parallel one. The
// A->B(126) unlock-status fix already self-grants a qualifying device into
// node_allowlist for this exact node_id, so "unlocked" and "shows up in the
// server list" now share one source of truth instead of drifting apart —
// that was the actual bug Khabat hit (unlock-status said unlocked, but this
// function never existed, so the node could never appear in /servers at all,
// for anyone, regardless of allowlist state).
//
// 'creds' => null on purpose: lib/starlink.php's own header describes the
// intended mechanism (a server-side Xray routing rule, keyed to this node's
// dedicated vless_uuid, redirecting a normal VLESS session's egress over a
// WireGuard tunnel to the gateway) — checked the live Xray config directly,
// that routing rule and the WireGuard peer do not exist on this box. The
// gateway itself heartbeats fine (health/telemetry below are real), but
// there is currently no way to hand out creds that would actually route
// traffic through it. Returning primary's creds under a Starlink label would
// silently test the WRONG thing; the /servers/{id}/config handler below
// turns this null into an honest 503 instead.
function v1_starlink_node(PDO $pdo): ?array {
    $row = $pdo->query("SELECT * FROM starlink_nodes WHERE enabled=1 ORDER BY node_id LIMIT 1")->fetch();
    if (!$row) return null;
    return [
        'id'    => $row['node_id'],
        'test'  => true,
        'meta'  => st_meta($row),
        'creds' => null,
    ];
}

function v1_nodes(PDO $pdo, ?string $deviceId = null): array {
    $p = v1_primary_node($pdo);
    $h = v1_helsinki_node($deviceId);
    $g = v1_germany_node();
    $d = v1_proisp_node();
    $c = v1_cfedge_node();
    $out = [$p['id'] => $p, $h['id'] => $h, $g['id'] => $g, $d['id'] => $d, $c['id'] => $c];
    $s = v1_starlink_node($pdo);
    if ($s) $out[$s['id']] = $s;
    return $out;
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
$publicRoutes = ($rel === '/payments/packages' && $method === 'GET')
    // Connect telemetry is anonymous BY DESIGN (no PII, fire-and-forget, the
    // handler itself never errors to the client). The iOS tunnel extension has
    // no device bearer, so gating this route silently killed all telemetry
    // (root-caused 2026-07-05: 401 + wrong-vhost fallthrough to the landing page).
    || ($rel === '/telemetry/connect' && $method === 'POST');

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
        // Posts sent while the tunnel is up arrive from our own exit node, so
        // geo-locating that IP would label the row with the NODE's country
        // (Finland/Denmark), poisoning learned routing. Leave country empty —
        // untunneled posts (connect_fail fires before the tunnel is up) carry
        // the user's real IP and provide the per-country signal.
        $ownExitIps = ['65.109.183.7', '91.107.158.53', '5.249.255.116', '5.249.252.221'];
        if ($clientIp && $clientIp !== '127.0.0.1' && $clientIp !== '::1'
            && !in_array($clientIp, $ownExitIps, true)
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
        // Backfill operator from the device record when the app didn't send
        // one — per-carrier routing needs every row it can get.
        $carrierName = v1_body('carrier_name');
        if ($carrierName === '' || $carrierName === '--') {
            try {
                $cq = $pdo->prepare("SELECT carrier FROM devices WHERE device_id=?");
                $cq->execute([$deviceId]);
                $carrierName = (string)($cq->fetchColumn() ?: '');
            } catch (\Throwable $_) {}
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
            'carrier_name'         => $carrierName,
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

// Powers every Starlink surface client-side (Home hero card, StarlinkScreen,
// first-connect celebration — see mobile-app/src/services/api/starlink.api.ts).
// Was referenced by that client since the b97 addendum but never actually
// routed here — every call 404'd (confirmed live, 2026-07-28). Unlock reasons
// mirror the existing stealth-server pattern above (plan==='premium' /
// devices.test_mode / >=3 active credited referrals) for consistency rather
// than inventing a separate threshold with no spec to match against.
if ($rel === '/starlink/unlock-status' && $method === 'GET') {
    st_init_tables($pdo);

    $unlocked        = false;
    $reason          = null;
    $invitesVerified = 0;
    $invitesRequired = 3;
    $hasConnected    = false;

    // Single node today; first enabled row if/when more exist.
    $node = $pdo->query("SELECT * FROM starlink_nodes WHERE enabled=1 ORDER BY node_id LIMIT 1")->fetch();

    if ($deviceId !== null && $deviceId !== '') {
        $dst = $pdo->prepare("SELECT plan, test_mode FROM devices WHERE device_id=?");
        $dst->execute([$deviceId]);
        $devRow = $dst->fetch();

        if ($devRow) {
            if ((string)($devRow['plan'] ?? '') === 'premium') {
                $unlocked = true; $reason = 'premium';
            } elseif ((int)($devRow['test_mode'] ?? 0) === 1) {
                $unlocked = true; $reason = 'test_mode';
            } else {
                $ic = $pdo->prepare("
                    SELECT COUNT(*) FROM referral_uses ru
                    JOIN devices d ON d.device_id = ru.new_device_id
                    WHERE ru.referrer_device_id=?
                      AND ru.status IN ('credited','approved')
                      AND (d.internet_ok=1 OR d.last_seen >= datetime('now','-7 days'))
                ");
                $ic->execute([$deviceId]);
                $invitesVerified = (int)$ic->fetchColumn();
                if ($invitesVerified >= $invitesRequired) { $unlocked = true; $reason = 'invites'; }
            }
        }

        // Self-granting, same convention as stealth_unlocked's auto-flip above:
        // a qualifying device is added to node_allowlist here rather than
        // requiring a second manual step — node_allowlist is the table that
        // actually gates routability (lib/starlink.php's own header comment),
        // so "shows unlocked" and "can actually connect" never drift apart.
        if ($unlocked && $node) {
            $pdo->prepare("INSERT OR IGNORE INTO node_allowlist (device_id, node_id, added_at) VALUES (?, ?, datetime('now'))")
                ->execute([$deviceId, $node['node_id']]);
        }

        if ($node) {
            $hc = $pdo->prepare("SELECT 1 FROM node_usage WHERE device_id=? AND node_id=?");
            $hc->execute([$deviceId, $node['node_id']]);
            $hasConnected = (bool)$hc->fetchColumn();
        }
    }

    $nodeOut = null;
    if ($node) {
        $health = st_health_state($node);
        $nodeOut = [
            'id'          => $node['node_id'],
            'available'   => st_routable($node),
            'status'      => $health === 'MAINTENANCE' ? 'maintenance' : ($health === 'OFFLINE' ? 'offline' : 'online'),
            'statusNote'  => $health !== 'ONLINE' ? 'auto_returns_when_healthy' : null,
            'maxSessions' => (int)($node['max_sessions'] ?? 0),
            'country'     => $node['country'] ?? 'Norway',
            'health'      => $health,
            'telemetry'   => [
                'latencyMs'            => $node['latency_ms'] !== null ? (int)$node['latency_ms'] : null,
                'packetLossPct'        => $node['packet_loss_pct'] !== null ? (float)$node['packet_loss_pct'] : null,
                'uptimeSecs'           => $node['uptime_secs'] !== null ? (int)$node['uptime_secs'] : null,
                'downloadKbps'         => $node['measured_download_kbps'] !== null ? (int)$node['measured_download_kbps'] : null,
                'uploadKbps'           => $node['measured_upload_kbps'] !== null ? (int)$node['measured_upload_kbps'] : null,
                'sessions'             => (int)($node['current_sessions'] ?? 0),
                'lastHeartbeatAgeSecs' => $node['last_heartbeat_at'] ? (time() - strtotime($node['last_heartbeat_at'])) : null,
            ],
        ];
    }

    v1_send([
        'unlock' => [
            'unlocked'        => $unlocked,
            'reason'          => $reason,
            'invitesVerified' => $invitesVerified,
            'invitesRequired' => $invitesRequired,
        ],
        'node'         => $nodeOut,
        'hasConnected' => $hasConnected,
    ]);
}

if ($rel === '/servers') {
    $health = v1_health();
    // Load telemetry-derived success scores (last 7 days) for ranking.
    $scores = [];
    try { ni_init_tables($pdo); $scores = ni_node_scores($pdo, 7); } catch (\Throwable $_) {}
    $carrierScores = [];
    try {
        $cst = $pdo->prepare("SELECT carrier FROM devices WHERE device_id=?");
        $cst->execute([$deviceId]);
        $fam = ni_carrier_family((string)($cst->fetchColumn() ?: ''));
        // Fallback: carrier sent on the request itself — device registration
        // may predate carrier capture (pre-b89 installs).
        if ($fam === '') $fam = ni_carrier_family((string)($_GET['carrier'] ?? ''));
        if ($fam !== '') $carrierScores = ni_node_scores_by_carrier($pdo, $fam, 21);
    } catch (\Throwable $_) {}
    $out = [];
    foreach ($nodes as $id => $n) {
        if ($n['test'] && !v1_device_allowed($pdo, $deviceId, $id)) continue; // hide test nodes
        // Auto-hide a non-primary node that is freshly DOWN, so users aren't
        // routed to a dead box. Primary is never hidden (last-resort default).
        if ($id !== 'primary' && v1_node_down($id)) continue;
        // Geo-hide nodes that are unreachable from the caller's country.
        if (v1_node_geo_hidden($pdo, $id)) continue;
        $meta = $n['meta'];
        // Annotate live ping from the latest health probe when available.
        $rtt = $health[$id]['rtt_ms'] ?? null;
        if (is_int($rtt)) $meta['ping'] = $rtt;
        // Annotate telemetry-based success score (0-100) when data exists.
        $cs = $carrierScores[$id] ?? null;
        if ($cs !== null && (int)$cs['total'] >= 4 && $cs['success_rate'] !== null) {
            $meta['successScore'] = (float)$cs['success_rate'];
            $meta['scoreBasis']   = 'carrier';
        } elseif (isset($scores[$id]['success_rate'])) {
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
    // Defense in depth: never hand out creds for a node geo-hidden from this
    // caller (it is unreachable from their country anyway).
    if (v1_node_geo_hidden($pdo, $id)) {
        v1_send(['message' => 'node not available in your region'], 403);
    }
    // Refuse to hand out creds for a node that is freshly down (clients fall back
    // to primary / saved bootstrap). Primary is exempt — it's the last resort.
    if ($id !== 'primary' && v1_node_down($id)) {
        v1_send(['message' => 'node temporarily unavailable'], 503);
    }
    // Starlink: visible/allowlisted (above) does not mean routable yet — see
    // v1_starlink_node()'s comment. Honest failure instead of silently
    // handing out another node's creds under this one's label.
    if ($n['creds'] === null) {
        v1_send(['message' => 'node temporarily unavailable'], 503);
    }
    v1_record_usage($pdo, $deviceId, $id);
    v1_send($n['creds']);
}

v1_send(['message' => 'not found'], 404);
