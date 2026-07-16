<?php
/**
 * Starlink gateway self-registration — Phase 2. Standalone endpoint, same
 * pattern as public/starlink-heartbeat.php: separate from v1.php (user-facing)
 * and admin/api.php (admin-session auth), so a leaked enrollment token can't
 * reach the admin panel or impersonate a user device, and vice versa.
 *
 * Phase 1's manual path (admin hand-creates a node row + heartbeat token via
 * admin/api.php's starlink-generate-token) still works unchanged — this is
 * an ADDITIONAL path for a brand-new gateway device with no node_id yet.
 *
 * Flow:
 *   1. Admin mints a one-time enrollment token (admin/api.php action
 *      starlink-create-enrollment-token) and hands it to whoever is
 *      provisioning the new gateway, out of band.
 *   2. The gateway's provisioning script calls this endpoint ONCE with that
 *      token + its own WireGuard public key. Gets back a permanent node_id
 *      + heartbeat token, writes them into its local config, and from then
 *      on behaves exactly like a Phase 1 manually-provisioned node —
 *      heartbeat.sh/heartbeat.ps1 are unchanged.
 *   3. The enrollment token is burned immediately — replay does nothing.
 *
 * Does NOT touch the live WireGuard interface. The submitted public key is
 * stored for an admin to review and add as a `wg` peer — auto-applying that
 * from an unprivileged web request would be a materially different (and
 * unrequested) risk than the identity/credential self-service this endpoint
 * actually provides. New nodes land disabled/testing, same as the Phase 1
 * seed — an admin still has to flip `enabled` before any traffic can route.
 *
 *   POST /starlink-enroll.php
 *   Authorization: Bearer <enrollment_token>
 *   Body (JSON or form): wg_public_key (required), platform (optional:
 *     windows | macos | linux)
 *   → 200 {"ok": true, "node_id": "...", "heartbeat_token": "starlink-node-...:...",
 *          "vps_wg_endpoint": "...", "vps_wg_public_key": "..."}
 *     (the latter two come from the `settings` table — starlink_wg_endpoint /
 *     starlink_wg_public_key, same key/value store as real_link_secret etc.
 *     — null until an admin sets them)
 *     (heartbeat_token shown ONCE, same convention as the admin-panel
 *     generate-token action — the gateway must persist it locally)
 *   → 401 invalid/missing token, 410 expired or already used
 */

declare(strict_types=1);

header('Content-Type: application/json');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method not allowed']);
    exit;
}

require_once __DIR__ . '/../lib/starlink.php';

function en_send(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function en_db(): PDO {
    $pdo = new PDO('sqlite:' . __DIR__ . '/../data/analytics.db', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    return $pdo;
}

function en_bearer(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    return preg_match('/Bearer\s+(.+)/i', $h, $m) ? trim($m[1]) : '';
}

function en_body(): array {
    $raw = file_get_contents('php://input') ?: '';
    $json = json_decode($raw, true);
    if (is_array($json)) return $json;
    return $_POST;
}

$token = en_bearer();
if ($token === '') {
    en_send(['ok' => false, 'error' => 'missing enrollment token'], 401);
}

$body = en_body();
$wgPublicKey = trim((string)($body['wg_public_key'] ?? ''));
if ($wgPublicKey === '') {
    en_send(['ok' => false, 'error' => 'wg_public_key required'], 400);
}
$platform = strtolower(trim((string)($body['platform'] ?? '')));
if (!in_array($platform, ['windows', 'macos', 'linux'], true)) $platform = '';

$pdo = en_db();
st_init_tables($pdo);

$result = st_redeem_enrollment_token($pdo, $token, [
    'wg_public_key' => $wgPublicKey,
    'platform'      => $platform,
]);
if ($result === null) {
    // Deliberately one error for "never existed" / "expired" / "already
    // used" — no reason to help an unauthenticated caller distinguish them.
    en_send(['ok' => false, 'error' => 'invalid or already-used enrollment token'], 410);
}

// Same VPS-side WireGuard peer info an admin would otherwise relay by hand —
// read from the settings table (same key/value store + INSERT OR REPLACE
// convention as real_link_secret/real_api_key/real_api_url — see
// admin/api.php), NOT an OS env var. This repo already has one config
// mechanism; using getenv() here would've been a second one for no reason.
// The rendezvous point has already moved once (docs/STARLINK_WINDOWS_HANDOFF.md
// §13 — the dev VPS's provider silently dropped inbound UDP, fi-hel took
// over) and will again if a node ever moves; a hardcoded value here would go
// stale exactly the way that move already broke a hand-typed config.
$vpsWgEndpoint = null;
$vpsWgPublicKey = null;
try {
    $vpsWgEndpoint   = $pdo->query("SELECT value FROM settings WHERE key='starlink_wg_endpoint'")->fetchColumn() ?: null;
    $vpsWgPublicKey  = $pdo->query("SELECT value FROM settings WHERE key='starlink_wg_public_key'")->fetchColumn() ?: null;
} catch (\Throwable $e) {}

en_send([
    'ok'                => true,
    'node_id'           => $result['node_id'],
    'heartbeat_token'   => $result['heartbeat_token'],
    'vps_wg_endpoint'   => $vpsWgEndpoint,
    'vps_wg_public_key' => $vpsWgPublicKey,
]);
