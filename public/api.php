<?php
/**
 * Public mobile API — served at setalink.no/api.php
 * No nginx auth_basic. Token-protected only.
 *
 * GET  ?mobile=1&action=remote-config&_token=...
 * GET  ?mobile=1&action=bootstrap&_token=...
 * GET  ?mobile=1&action=sync-entitlement&_token=...&device_id=...
 * POST ?mobile=1&action=register-device     body: _token, device_id, platform
 * POST ?mobile=1&action=use-referral        body: _token, device_id, referral_code
 * POST ?mobile=1&action=report-usage        body: _token, device_id, bytes_used
 */

if (($_GET['mobile'] ?? '') !== '1') {
    http_response_code(404);
    exit;
}

const MOBILE_TOKEN = 'setalink-mobile-diag-v1';
// Referrals scoring at or above this are held for admin review (no auto-reward).
const RISK_HOLD_THRESHOLD = 75;
define('DB_PATH', __DIR__ . '/../data/analytics.db');

// Shared quota-economy ledger / transfer / milestone / package logic.
require_once __DIR__ . '/../lib/quota_economy.php';
// Rewarded ads + hidden recovery quota (shared logic).
require_once __DIR__ . '/../lib/ads_recovery.php';
// User-to-user messaging (v0.9.33).
require_once __DIR__ . '/../lib/messaging.php';
// TrustAI referral trust scoring (optional service, local heuristic fallback).
require_once __DIR__ . '/../lib/trustai.php';
// REAL token economy — account linking + server-verified redemption (A2).
require_once __DIR__ . '/../lib/real_economy.php';
// Ads performance comparison (AdsGram vs AdMob ingestion + query helpers).
require_once __DIR__ . '/../lib/ads_perf.php';
// Provider-agnostic ad event model (ad_events/ad_daily_metrics) — RealGram Admin monetization page.
require_once __DIR__ . '/../lib/ad_monetization.php';

header('Content-Type: application/json');
// CORS — React Native OkHttp doesn't enforce CORS, but WebView and reverse
// proxies may. Token auth remains the gate regardless of Origin.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Token check
$token = ($method === 'POST')
    ? ($_POST['_token'] ?? $_GET['_token'] ?? '')
    : ($_GET['_token'] ?? '');

// Diagnostic-only endpoints are exempt from the token gate: they are written by
// the PacketTunnelExtension / VPN service, which has no access to the app's token
// store, and they are device_id-validated + size-clamped in their handlers. The
// token itself ships inside the app binary, so it is not a real secret anyway.
const NO_TOKEN_ACTIONS = ['submit-tunnel-log', 'push-adsgram-perf', 'push-adsgram-events', 'ecosystem-referral-import'];

if (!in_array($action, NO_TOKEN_ACTIONS, true) && !hash_equals(MOBILE_TOKEN, $token)) {
    echo json_encode(['ok' => false, 'error' => 'invalid token']);
    exit;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec("PRAGMA journal_mode=WAL");
    init_device_tables($pdo);
    qe_init_tables($pdo);
    dm_init_tables($pdo);
    return $pdo;
}

function init_device_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS devices (
        device_id          TEXT PRIMARY KEY,
        referral_code      TEXT UNIQUE,
        plan               TEXT    DEFAULT 'free',
        quota_bytes_total  INTEGER DEFAULT 5368709120,
        quota_bytes_used   INTEGER DEFAULT 0,
        valid_until        TEXT    DEFAULT NULL,
        blocked            INTEGER DEFAULT 0,
        platform           TEXT    DEFAULT 'android',
        created_at         TEXT    DEFAULT (datetime('now')),
        last_seen          TEXT    DEFAULT (datetime('now')),
        app_version        TEXT    DEFAULT '',
        active_protocol    TEXT    DEFAULT '',
        status             TEXT    DEFAULT 'offline',
        country            TEXT    DEFAULT '',
        language           TEXT    DEFAULT ''
    )");
    $migrations = [
        "ALTER TABLE devices ADD COLUMN app_version TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN active_protocol TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN status TEXT DEFAULT 'offline'",
        "ALTER TABLE devices ADD COLUMN country TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN language TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN user_id TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN manufacturer TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN model TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN sdk_version INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN android_id_hash TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN last_ip TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN country_name TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN dns_ok INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN internet_ok INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN active_sni TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN rx_bytes INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN tx_bytes INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN latency_ms INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN last_failure_category TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN last_failure_at TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN android_version TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN abi TEXT DEFAULT ''",
        // Geo: country/country_name now track the LATEST location; first_country
        // preserves the first-seen one; country_updated_at = when it last changed.
        "ALTER TABLE devices ADD COLUMN first_country TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN country_updated_at TEXT DEFAULT ''",
    ];
    foreach ($migrations as $sql) {
        try { $pdo->exec($sql); } catch (\Exception $e) { /* column already exists */ }
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS referral_uses (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        referral_code      TEXT DEFAULT '',
        used_by            TEXT DEFAULT '',
        referrer_device_id TEXT DEFAULT '',
        new_device_id      TEXT DEFAULT '',
        bonus_bytes        INTEGER DEFAULT 0,
        used_at            TEXT DEFAULT (datetime('now')),
        created_at         TEXT DEFAULT (datetime('now'))
    )");
    foreach ([
        "ALTER TABLE referral_uses ADD COLUMN referrer_device_id TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN new_device_id TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN bonus_bytes INTEGER DEFAULT 0",
        "ALTER TABLE referral_uses ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
        "ALTER TABLE referral_uses ADD COLUMN referrer_ip TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN new_user_ip TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN risk_score INTEGER DEFAULT 0",
        "ALTER TABLE referral_uses ADD COLUMN risk_flags TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN status TEXT DEFAULT 'credited'",
        "ALTER TABLE devices ADD COLUMN stealth_unlocked INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN invite_count INTEGER DEFAULT 0",
    ] as $m) { try { $pdo->exec($m); } catch (\Exception $e) {} }
}

// Derive country from request IP using ip-api.com (free tier, 45 req/min, 2s timeout).
// Returns ['code' => 'NO', 'name' => 'Norway'] or empty strings on failure.
function detect_country_from_ip(string $ip): array {
    if (!$ip || $ip === '127.0.0.1' || $ip === '::1' || str_starts_with($ip, '10.') || str_starts_with($ip, '192.168.')) {
        return ['code' => '', 'name' => ''];
    }
    $ctx = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]);
    $raw = @file_get_contents("http://ip-api.com/json/$ip?fields=countryCode,country", false, $ctx);
    if (!$raw) return ['code' => '', 'name' => ''];
    $data = json_decode($raw, true);
    return [
        'code' => substr((string)($data['countryCode'] ?? ''), 0, 4),
        'name' => substr((string)($data['country']     ?? ''), 0, 80),
    ];
}

// Admin → user in-app messages (same tables as admin/api.php).
function init_message_tables(PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS admin_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_device_id TEXT NOT NULL DEFAULT "",
        title TEXT NOT NULL DEFAULT "",
        body  TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    $pdo->exec('CREATE TABLE IF NOT EXISTS admin_message_acks (
        message_id INTEGER NOT NULL,
        device_id  TEXT NOT NULL,
        acked_at   TEXT NOT NULL DEFAULT (datetime(\'now\')),
        PRIMARY KEY (message_id, device_id))');
}

/** Deliver a system notification to one device's Inbox (Announcements tab),
 *  reusing the admin_messages poll transport. Best-effort; never throws. */
function push_device_message(PDO $pdo, string $deviceId, string $title, string $body): void {
    if ($deviceId === '') return;
    try {
        init_message_tables($pdo);
        $pdo->prepare('INSERT INTO admin_messages (target_device_id,title,body) VALUES (?,?,?)')
            ->execute([$deviceId, $title, $body]);
    } catch (\Throwable $e) { /* notification is non-critical */ }
}

/** Format a byte count as a compact GB string (matches the client's 1024^3 GB). */
function fmt_gb(int $bytes): string {
    $gb = $bytes / (1024 * 1024 * 1024);
    return rtrim(rtrim(number_format($gb, 2, '.', ''), '0'), '.');
}

// Egress IPs of our own infrastructure — a request arriving from one of
// these travelled through the tunnel (or is a local test), so it does not
// identify the client. 178.104.77.231 = live Reality box, 5.249.252.221 =
// this panel/edge box itself.
const VPN_EGRESS_IPS = ['178.104.77.231', '5.249.252.221'];

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $h) {
        $v = $_SERVER[$h] ?? '';
        if (!$v) continue;
        $ip = trim(explode(',', $v)[0]);
        // Requests sent while the VPN is up exit xray's freedom outbound on
        // this box, so REMOTE_ADDR is 127.0.0.1. Return '' for loopback or
        // private ranges so callers never overwrite a stored real IP.
        if (filter_var($ip, FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) continue;
        if (in_array($ip, VPN_EGRESS_IPS, true)) continue;
        return $ip;
    }
    return '';
}

// Refresh last_ip + country from any non-tunneled request, so the admin always
// reflects the user's LATEST location (not the first-seen one). When the public
// IP changes we re-geo and overwrite country/country_name; first_country keeps
// the original. Devices also heal as soon as the app talks to us with the VPN off.
function touch_ip_geo(PDO $pdo, string $deviceId, array $dev = []): void {
    $ip = client_ip();
    if (!$ip) return;
    if (!array_key_exists('country', $dev)) {
        $st = $pdo->prepare("SELECT last_ip, country, first_country FROM devices WHERE device_id=?");
        $st->execute([$deviceId]);
        $dev = $st->fetch() ?: [];
    }
    $hasCountry = ($dev['country'] ?? '') !== '';
    $ipChanged  = ($dev['last_ip'] ?? null) !== $ip;
    // Nothing to do: same IP and we already know the country.
    if (!$ipChanged && $hasCountry) return;

    // Re-geo when the IP changed or we have no country yet.
    $cc = ''; $cn = '';
    if ($ipChanged || !$hasCountry) {
        $geo = detect_country_from_ip($ip);
        $cc = $geo['code']; $cn = $geo['name'];
    }

    if ($cc !== '') {
        // New reliable signal → overwrite latest country, seed first_country once.
        $pdo->prepare(
            "UPDATE devices SET last_ip=?, country=?, country_name=?,
                 first_country=CASE WHEN (first_country='' OR first_country IS NULL) THEN ? ELSE first_country END,
                 country_updated_at=datetime('now')
             WHERE device_id=?")
            ->execute([$ip, $cc, $cn, $cc, $deviceId]);
    } else {
        // Geo lookup failed (rate-limited / private IP): still record the new IP,
        // keep the previously known country rather than blanking it.
        $pdo->prepare("UPDATE devices SET last_ip=? WHERE device_id=?")
            ->execute([$ip, $deviceId]);
    }
}

function generate_referral_code(PDO $pdo): string {
    do {
        $code = strtoupper(substr(bin2hex(random_bytes(4)), 0, 7));
        $exists = $pdo->query("SELECT 1 FROM devices WHERE referral_code='$code'")->fetchColumn();
    } while ($exists);
    return $code;
}

// Generates a public SL-227-XXXXXXXX user identity — stable, unique, support-friendly.
function generate_user_id(PDO $pdo): string {
    for ($i = 0; $i < 20; $i++) {
        $uid = 'SL-227-' . strtoupper(bin2hex(random_bytes(4)));
        $st  = $pdo->prepare("SELECT 1 FROM devices WHERE user_id=?");
        $st->execute([$uid]);
        if (!$st->fetchColumn()) return $uid;
    }
    return 'SL-227-' . strtoupper(bin2hex(random_bytes(4)));
}

function hardcoded_bootstrap(): array {
    // Ground truth from /etc/setalink/setalink.env — used only if DB settings are missing.
    return [
        'uuid'        => 'b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3',
        'address'     => '178.104.77.231',
        'port'        => 443,
        'publicKey'   => 'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
        'shortId'     => '7f81892e',
        'sni'         => 'www.cloudflare.com',
        'flow'        => 'xtls-rprx-vision',
        'fingerprint' => 'chrome',
        'country'     => 'Germany',
        'flag'        => '🇩🇪',
        'city'        => 'Hetzner · Cloudflare :443',
        'edgeAddress' => 'edge.setalink.no',
        'edgePort'    => 443,
        'wsPath'      => '/ws',
        'xhttpPath'   => '/xhttp/',
        'httpupPath'  => '/httpup',
        'altProfiles' => [
            [
                'uuid'        => '9280e04d-ffdb-45b4-9558-66b9d6f89b49',
                'publicKey'   => 'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
                'shortId'     => '82ab1a310f0aeb06',
                'sni'         => 'www.microsoft.com',
                'port'        => 443,
                'address'     => '178.104.77.231',
                'flow'        => 'xtls-rprx-vision',
                'fingerprint' => 'chrome',
            ],
            [
                'uuid'        => 'b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3',
                'publicKey'   => 'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
                'shortId'     => '7f81892e',
                'sni'         => 'www.bing.com',
                'port'        => 443,
                'address'     => '178.104.77.231',
                'flow'        => 'xtls-rprx-vision',
                'fingerprint' => 'chrome',
            ],
        ],
    ];
}

function fetch_bootstrap_server(PDO $pdo): array {
    // Admin stores bootstrap as individual bootstrap_* keys
    $r = $pdo->query(
        "SELECT key, value FROM settings WHERE key LIKE 'bootstrap_%'"
    )->fetchAll(PDO::FETCH_KEY_PAIR);
    if (empty($r['bootstrap_uuid']) || empty($r['bootstrap_pubkey'])) {
        return hardcoded_bootstrap();
    }
    return [
        'uuid'        => $r['bootstrap_uuid'],
        'address'     => $r['bootstrap_address'] ?? '',
        'port'        => (int)($r['bootstrap_port'] ?? 443),
        'publicKey'   => $r['bootstrap_pubkey'],
        'shortId'     => $r['bootstrap_shortid'] ?? '',
        'sni'         => $r['bootstrap_sni'] ?? 'www.cloudflare.com',
        'flow'        => $r['bootstrap_flow'] ?? '',
        'fingerprint' => $r['bootstrap_fp'] ?? 'chrome',
        'country'     => $r['bootstrap_country'] ?? 'Germany',
        'flag'        => $r['bootstrap_flag']    ?? '🇩🇪',
        'city'        => $r['bootstrap_city']    ?? 'SetaLink Cloudflare',
        'edgeAddress' => $r['bootstrap_edge_address'] ?? '',
        'edgePort'    => (int)($r['bootstrap_edge_port'] ?? 443),
        'wsPath'      => $r['bootstrap_ws_path']    ?? '/ws',
        'xhttpPath'   => $r['bootstrap_xhttp_path'] ?? '/xhttp',
        'httpupPath'  => $r['bootstrap_httpup_path'] ?? '/httpup',
        'altProfiles' => json_decode($r['bootstrap_alt_profiles'] ?? '[]', true) ?: [],
    ];
}

function ok($data): void  { echo json_encode(['ok' => true,  'data'  => $data]); exit; }
function err($msg): void  { echo json_encode(['ok' => false, 'error' => $msg]);  exit; }

// ── Routes ───────────────────────────────────────────────────────────────────

if ($method === 'GET') {

    if ($action === 'remote-config') {
        $pdo = db();
        // Load all rc_* and support settings from DB
        $rcRows = [];
        try {
            $rcRows = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'rc_%' OR key IN ('support_url','edge_host')")->fetchAll(PDO::FETCH_KEY_PAIR);
        } catch (\Exception $e) {}
        $decodeArr = function(string $key, array $def) use ($rcRows): array {
            if (!isset($rcRows[$key])) return $def;
            $v = json_decode($rcRows[$key], true);
            return is_array($v) ? $v : $def;
        };
        // Build composite config from DB settings
        $cfg = [
            'version'                => (int)($rcRows['rc_version'] ?? 1),
            'sni_priorities'         => $decodeArr('rc_sni_priorities', ['www.microsoft.com', 'www.bing.com', 'www.apple.com', 'www.samsung.com']),
            'kill_switches'          => $decodeArr('rc_kill_switches', []),
            'protocol_order'         => $decodeArr('rc_protocol_order', ['Reality', 'XHTTP', 'WebSocket']),
            'emergency_sni'          => (string)($rcRows['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order'         => $decodeArr('rc_iran_sni_order', ['www.microsoft.com', 'www.bing.com', 'www.apple.com']),
            'ttl'                    => (int)($rcRows['rc_ttl'] ?? 3600),
            'updated_at'             => (string)($rcRows['rc_updated_at'] ?? ''),
            'support_url'            => (string)($rcRows['support_url'] ?? 'https://t.me/SetaLink3'),
            'edge_host'              => (string)($rcRows['edge_host'] ?? 'edge.setalink.no'),
            'emergency_profiles'     => $decodeArr('rc_emergency_profiles', []),
            'stealth_profiles'       => $decodeArr('rc_stealth_profiles', []),
            'update_required'        => (bool)(int)($rcRows['rc_update_required'] ?? '0'),
            'min_supported_version'  => (string)($rcRows['rc_min_supported'] ?? '0.9.7'),
            'profile_bundle_version' => (int)($rcRows['rc_profile_bundle_version'] ?? 1),
            // Adaptive network flags
            'failover_max_nodes'     => (int)($rcRows['rc_failover_max_nodes'] ?? 2),
            'nodes_disabled'         => $decodeArr('rc_nodes_disabled', []),
            'telemetry_enabled'      => (bool)(int)($rcRows['rc_telemetry_enabled'] ?? 1),
            'rollout'                => json_decode((string)($rcRows['rc_rollout'] ?? '{}'), true) ?: (object)[],
            'extra_logging_platform' => ($rcRows['rc_extra_logging_platform'] ?? '') ?: null,
            'extra_logging_node'     => ($rcRows['rc_extra_logging_node'] ?? '') ?: null,
            // Ecosystem promotion (REAL / Shahnameh / TrustAI) — campaign copy,
            // targets and visibility pushed without an app release. Promos are
            // objects: {id, url, emoji?, image?, title_en, title_fa, sub_en, ...}.
            'ecosystem'              => [
                'banner_enabled' => (bool)(int)($rcRows['rc_ecosystem_banner_enabled'] ?? 1),
                'promos'         => $decodeArr('rc_ecosystem_promos', []),
                // Default OFF: the wallet card only makes sense once the
                // Shahnameh-side wallet API is live (TASK_SPLIT.md B-1/B-2).
                'wallet_enabled' => (bool)(int)($rcRows['rc_real_wallet_enabled'] ?? 0),
                // Default OFF: gates the "Link TrustAI account" card on Profile
                // (A-14); flip rc_trustai_link_enabled once B-9 is verified.
                'trustai_link_enabled' => (bool)(int)($rcRows['rc_trustai_link_enabled'] ?? 0),
            ],
        ];
        // If there's a legacy composite blob, merge it but let per-key values win
        try {
            $blobRow = $pdo->query("SELECT value FROM settings WHERE key='remote_config' LIMIT 1")->fetch();
            if ($blobRow) {
                $blob = json_decode($blobRow['value'], true);
                if (is_array($blob)) {
                    // Only use blob fields not already populated by per-key settings
                    foreach ($blob as $bk => $bv) {
                        if (!array_key_exists($bk, $cfg)) $cfg[$bk] = $bv;
                    }
                }
            }
        } catch (\Exception $e) {}
        ok($cfg);
    }

    if ($action === 'profile-bundle') {
        $pdo = db();
        $rows = [];
        try { $rows = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'bundle_%'")->fetchAll(PDO::FETCH_KEY_PAIR); } catch (\Exception $e) {}
        $sni_candidates = json_decode($rows['bundle_sni_candidates'] ?? '[]', true) ?: ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net'];
        $spoof_snis     = json_decode($rows['bundle_spoof_snis'] ?? '[]', true) ?: ['auth.vercel.com','cdn.jsdelivr.net','hcaptcha.com','assets.vercel.com','images.unsplash.com','cloudflare.com'];
        $backup_ips     = json_decode($rows['bundle_backup_ips'] ?? '[]', true) ?: ['178.104.77.231'];
        $backup_domains = json_decode($rows['bundle_backup_domains'] ?? '[]', true) ?: ['vpn.setalink.no'];
        ok([
            'version'        => (int)($rows['bundle_version'] ?? 1),
            'published_at'   => $rows['bundle_published_at'] ?? date('Y-m-d'),
            'sni_candidates' => $sni_candidates,
            'spoof_snis'     => $spoof_snis,
            'backup_ips'     => $backup_ips,
            'backup_domains' => $backup_domains,
            'profiles'       => [],
        ]);
    }

    if ($action === 'bootstrap') {
        $pdo = db();
        $srv = fetch_bootstrap_server($pdo);
        ok([
            'id'          => 'server-emergency',
            'label'       => 'SetaLink Cloudflare',
            'country'     => $srv['country']     ?? 'Germany',
            'flag'        => $srv['flag']        ?? '🇩🇪',
            'city'        => $srv['city']        ?? 'SetaLink Cloudflare',
            'uuid'        => $srv['uuid']        ?? '',
            'address'     => $srv['address']     ?? '',
            'port'        => (int)($srv['port']  ?? 443),
            'publicKey'   => $srv['publicKey']   ?? '',
            'shortId'     => $srv['shortId']     ?? '',
            'sni'         => $srv['sni']         ?? 'www.cloudflare.com',
            'flow'        => $srv['flow']        ?? '',
            'fingerprint' => $srv['fingerprint'] ?? 'chrome',
            'edgeAddress' => $srv['edgeAddress'] ?? '',
            'edgePort'    => (int)($srv['edgePort'] ?? 443),
            'wsPath'      => $srv['wsPath']      ?? '/ws',
            'xhttpPath'   => $srv['xhttpPath']   ?? '/xhttp',
            'httpupPath'  => $srv['httpupPath']  ?? '/httpup',
            'altProfiles' => $srv['altProfiles'] ?? [],
        ]);
    }

    if ($action === 'get-messages') {
        // Unacked admin messages for this device (targeted or broadcast),
        // max 30 days back. Polled at app launch and on the heartbeat.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        init_message_tables($pdo);
        $st = $pdo->prepare(
            "SELECT m.id, m.title, m.body, m.created_at
             FROM admin_messages m
             WHERE (m.target_device_id='' OR m.target_device_id=?)
               AND m.created_at >= datetime('now','-30 days')
               AND NOT EXISTS (SELECT 1 FROM admin_message_acks a
                               WHERE a.message_id=m.id AND a.device_id=?)
             ORDER BY m.id ASC LIMIT 10");
        $st->execute([$deviceId, $deviceId]);
        ok(['messages' => $st->fetchAll()]);
    }

    if ($action === 'sync-entitlement') {
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        $row = $pdo->prepare("SELECT * FROM devices WHERE device_id=?");
        $row->execute([$deviceId]);
        $dev = $row->fetch();
        if (!$dev) err('device not found');
        touch_ip_geo($pdo, $deviceId, $dev);
        // Backfill user_id on sync if missing
        if (empty($dev['user_id'])) {
            $uid = generate_user_id($pdo);
            $pdo->prepare("UPDATE devices SET user_id=? WHERE device_id=? AND (user_id='' OR user_id IS NULL)")
                ->execute([$uid, $deviceId]);
            $dev['user_id'] = $uid;
        }
        $srv = fetch_bootstrap_server($pdo);
        // Real-time invite count + stealth unlock — granted referrals only;
        // pending/rejected rows never count toward rewards or unlocks.
        $ic = $pdo->prepare(
            "SELECT COUNT(*) FROM referral_uses WHERE referrer_device_id=? AND status IN ('credited','approved')");
        $ic->execute([$deviceId]);
        $inviteCount = (int)$ic->fetchColumn();
        $activeIc = $pdo->prepare("
            SELECT COUNT(*) FROM referral_uses ru
            JOIN devices d ON d.device_id = ru.new_device_id
            WHERE ru.referrer_device_id=?
              AND ru.status IN ('credited','approved')
              AND (d.internet_ok=1 OR d.last_seen >= datetime('now','-7 days'))
        ");
        $activeIc->execute([$deviceId]);
        $activeInvites = (int)$activeIc->fetchColumn();
        $stealthUnlocked = (bool)($dev['stealth_unlocked'] ?? 0) || ($activeInvites >= 3);
        if ($stealthUnlocked && !$dev['stealth_unlocked']) {
            $pdo->prepare("UPDATE devices SET stealth_unlocked=1 WHERE device_id=?")->execute([$deviceId]);
        }

        // Grant any newly-reached milestone rewards (idempotent), then read the
        // server-side quota ledger breakdown the profile screen renders.
        try { qe_evaluate_milestones($pdo, $deviceId); } catch (\Exception $e) {}
        $summary   = qe_summary($pdo, $deviceId);
        $milestones = qe_milestone_progress($pdo, $deviceId);
        $packages  = qe_packages($pdo, $deviceId);
        // Re-read total — a milestone grant may have just changed it.
        $row->execute([$deviceId]);
        $dev = $row->fetch() ?: $dev;

        ok([
            'device_id'         => $dev['device_id'],
            'user_id'           => $dev['user_id']        ?? '',
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            // Test-account flag, orthogonal to plan — lets a premium tester
            // keep quota while exercising free-tier-gated features (ads).
            'test_mode'         => (int)($dev['test_mode'] ?? 0) === 1,
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)$dev['blocked'],
            'server'            => $srv,
            'invite_count'      => $inviteCount,
            'active_invite_count' => $activeInvites,
            'stealth_unlocked'  => (bool)($dev['stealth_unlocked'] ?? 0),
            'country'           => $dev['country'] ?? '',
            'quota'             => $summary,
            'milestones'        => $milestones,
            'packages'            => $packages,
            // REAL-ID: ecosystem account shared across Shahnameh, 3REAL, TrustAI, RealGram.
            'linked_real_account' => (string)($dev['linked_real_account'] ?? ''),
        ]);
    }

    if ($action === 'quota-summary') {
        // Server-side quota ledger breakdown + milestone progress + packages.
        // All profile cards read from this — no client-side derivation.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        try { qe_evaluate_milestones($pdo, $deviceId); } catch (\Exception $e) {}
        ok([
            'quota'      => qe_summary($pdo, $deviceId),
            'milestones' => qe_milestone_progress($pdo, $deviceId),
            'packages'   => qe_packages($pdo, $deviceId),
        ]);
    }

    if ($action === 'get-packages') {
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        ok(['packages' => qe_packages($pdo, $deviceId)]);
    }

    if ($action === 'real-wallet') {
        // A3: everything the wallet card needs in one call. balance is null
        // when the ecosystem backend can't answer (unconfigured/unreachable) —
        // the app shows the link state and rates regardless. The app never
        // holds real_api_key; the panel proxies (TASK_SPLIT.md contract 3).
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        $account = re_linked_account($pdo, $deviceId);
        // B-23 (2026-07-19): full wallet detail (balance/zar/conversion_rate)
        // from contract §3 v2 — falls back to a balance-only shape if the
        // ecosystem is unreachable, same fail-open posture as before.
        $wallet = $account !== '' ? re_fetch_wallet_detail($pdo, $account) : null;
        ok([
            'linked_account'       => $account,
            'balance'              => $wallet['balance']         ?? null,
            'zar'                  => $wallet['zar']             ?? null,
            'conversion_rate'      => $wallet['conversion_rate'] ?? null,
            'rates'                => re_settings($pdo),
            'redeemed_today_bytes' => re_redeemed_today($pdo, $deviceId),
        ]);
    }

    if ($action === 'realgram-profile-summary') {
        // Contract §9 (shahnameh-backend main@6b725e1): one-call profile data
        // for RealGram's native ProfileScreen. Same proxy posture as
        // 'real-wallet' above — the app never holds real_api_key.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        $account = re_linked_account($pdo, $deviceId);
        if ($account === '') $account = re_ensure_real_id($pdo, $deviceId);
        $summary = re_fetch_profile_summary($pdo, $account);
        if ($summary === null) err('profile_unavailable');
        ok($summary);
    }

    if ($action === 'get-transfers') {
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        ok(['transfers' => qe_transfer_history($pdo, $deviceId, 50)]);
    }

    if ($action === 'activity-timeline') {
        // §5.10.3: one merged feed across RealGram/VPN/Wallet/Shahnameh instead
        // of four separate lists — mirrors the same merge already built for the
        // admin panel (admin/api.php 'user-profile' timeline block), scoped to
        // the calling device instead of admin-wide, plus three sources that
        // admin version doesn't include: quota_transfer, real_redemptions,
        // milestone_claims.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');

        $offset  = max(0, (int)($_GET['offset'] ?? 0));
        $limit   = min(50, max(5, (int)($_GET['limit'] ?? 20)));
        $fetchN  = $offset + $limit * 3 + 30; // enough raw rows per source to fill a page after merging

        $timeline = [];

        $sess = $pdo->prepare("SELECT protocol, bytes_sent, bytes_recv, duration_secs, started_at
                                FROM vpn_sessions WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $sess->execute([$deviceId, $fetchN]);
        foreach ($sess->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $timeline[] = ['ts' => $s['started_at'], 'type' => 'vpn', 'icon' => '🌐',
                'label'  => 'Connected via ' . ($s['protocol'] ?? '?'),
                'detail' => round(((int)$s['bytes_recv'] + (int)$s['bytes_sent']) / 1048576, 1) . ' MB · '
                          . round(($s['duration_secs'] ?? 0) / 60) . 'm'];
        }

        $ref = $pdo->prepare("SELECT d.user_id, ru.status, ru.created_at
                               FROM referral_uses ru JOIN devices d ON d.device_id = ru.new_device_id
                               WHERE ru.referrer_device_id = ? ORDER BY ru.id DESC LIMIT ?");
        $ref->execute([$deviceId, $fetchN]);
        foreach ($ref->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $timeline[] = ['ts' => $r['created_at'], 'type' => 'referral', 'icon' => '👥',
                'label' => 'Invited ' . ($r['user_id'] ?: 'new user'), 'detail' => $r['status'] ?? 'credited'];
        }

        $tx = $pdo->prepare("SELECT type, bytes, created_at FROM quota_transactions
                              WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $tx->execute([$deviceId, $fetchN]);
        foreach ($tx->fetchAll(PDO::FETCH_ASSOC) as $t) {
            $gb = round(abs((int)$t['bytes']) / 1073741824, 2);
            $timeline[] = ['ts' => $t['created_at'], 'type' => 'quota', 'icon' => '💰',
                'label' => ucfirst(str_replace('_', ' ', $t['type'])),
                'detail' => (((int)$t['bytes']) > 0 ? '+' : '-') . $gb . ' GB'];
        }

        // Allowlist only — app_events is mostly diagnostic noise (AD_LOAD_ERROR
        // alone is the majority of all rows). §5.10.3 wants a narrative of real
        // activity ("Watched rewarded ad", "Connected via Starlink"), not error
        // logs, so only events that represent something the user actually did
        // surface here. Extend this list as more meaningful events are added —
        // do not just switch to "all events" again.
        $appEventAllowlist = ['PAYMENT_CONFIRMED_REAL', 'TONKEEPER_OPENED'];
        $placeholders = implode(',', array_fill(0, count($appEventAllowlist), '?'));
        $app = $pdo->prepare("SELECT event, props, created_at FROM app_events
                               WHERE device_id=? AND event IN ($placeholders) ORDER BY id DESC LIMIT ?");
        $app->execute([$deviceId, ...$appEventAllowlist, $fetchN]);
        foreach ($app->fetchAll(PDO::FETCH_ASSOC) as $e) {
            $timeline[] = ['ts' => $e['created_at'], 'type' => 'app', 'icon' => '🎮',
                'label'  => ucfirst(str_replace('_', ' ', $e['event'])),
                'detail' => strlen($e['props'] ?? '') < 80 ? ($e['props'] ?? '') : substr($e['props'], 0, 77) . '…'];
        }

        // Sent/received transfers — sender and receiver both see it, worded from
        // their own side.
        $sent = $pdo->prepare("SELECT receiver_device, bytes, created_at FROM quota_transfer
                                WHERE sender_device=? AND status='completed' ORDER BY id DESC LIMIT ?");
        $sent->execute([$deviceId, $fetchN]);
        foreach ($sent->fetchAll(PDO::FETCH_ASSOC) as $tr) {
            $timeline[] = ['ts' => $tr['created_at'], 'type' => 'transfer', 'icon' => '🔄',
                'label' => 'Sent ' . round((int)$tr['bytes'] / 1073741824, 2) . ' GB', 'detail' => ''];
        }
        $recv = $pdo->prepare("SELECT sender_device, bytes, created_at FROM quota_transfer
                                WHERE receiver_device=? AND status='completed' ORDER BY id DESC LIMIT ?");
        $recv->execute([$deviceId, $fetchN]);
        foreach ($recv->fetchAll(PDO::FETCH_ASSOC) as $tr) {
            $timeline[] = ['ts' => $tr['created_at'], 'type' => 'transfer', 'icon' => '🎁',
                'label' => 'Received ' . round((int)$tr['bytes'] / 1073741824, 2) . ' GB', 'detail' => ''];
        }

        $redeem = $pdo->prepare("SELECT real_amount, quota_bytes, status, created_at FROM real_redemptions
                                  WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $redeem->execute([$deviceId, $fetchN]);
        foreach ($redeem->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $timeline[] = ['ts' => $r['created_at'], 'type' => 'redemption', 'icon' => '💎',
                'label'  => 'Redeemed ' . (int)$r['real_amount'] . ' REAL',
                'detail' => round((int)$r['quota_bytes'] / 1073741824, 2) . ' GB · ' . ($r['status'] ?? '')];
        }

        $mile = $pdo->prepare("SELECT milestone, bytes, claimed_at FROM milestone_claims
                                WHERE device_id=? ORDER BY claimed_at DESC LIMIT ?");
        $mile->execute([$deviceId, $fetchN]);
        foreach ($mile->fetchAll(PDO::FETCH_ASSOC) as $m) {
            $timeline[] = ['ts' => $m['claimed_at'], 'type' => 'milestone', 'icon' => '🏆',
                'label'  => 'Milestone ' . (int)$m['milestone'] . ' reached',
                'detail' => round((int)$m['bytes'] / 1073741824, 2) . ' GB'];
        }

        usort($timeline, fn($a, $b) => strcmp($b['ts'], $a['ts']));
        $total    = count($timeline);
        $timeline = array_slice($timeline, $offset, $limit);

        ok(['timeline' => $timeline, 'total' => $total, 'offset' => $offset, 'limit' => $limit]);
    }

    if ($action === 'referral-earnings') {
        // Ambassador model: the referrer earns a fixed % of each active
        // invitee's usage, ongoing ("forever"). Powers the profile donut chart
        // that shows how much comes in from each person they invited. This is a
        // read-only computation (display) — the % is admin-tunable via the
        // referral_earn_pct setting (default 10). Only credited/approved
        // referrals count (TrustAI/risk-gated at referral time), so fraud
        // doesn't inflate earnings.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        $pct = 10.0;
        try {
            $v = $pdo->query("SELECT value FROM settings WHERE key='referral_earn_pct'")->fetchColumn();
            if (is_numeric($v) && (float)$v > 0) $pct = (float)$v;
        } catch (\Exception $e) {}
        $st = $pdo->prepare(
            "SELECT r.new_device_id AS did, COALESCE(d.user_id,'') AS uid,
                    COALESCE(d.quota_bytes_used,0) AS used
             FROM referral_uses r JOIN devices d ON d.device_id = r.new_device_id
             WHERE r.referrer_device_id = ? AND r.status IN ('credited','approved')
             ORDER BY used DESC"
        );
        $st->execute([$deviceId]);
        $invitees = []; $total = 0;
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $earned = (int)floor((int)$row['used'] * $pct / 100);
            $total += $earned;
            $invitees[] = [
                'label'        => $row['uid'] !== '' ? $row['uid'] : ('SL-…' . substr((string)$row['did'], -6)),
                'used_bytes'   => (int)$row['used'],
                'earned_bytes' => $earned,
            ];
        }
        ok([
            'pct'                => $pct,
            'count'              => count($invitees),
            'total_earned_bytes' => $total,
            'invitees'           => $invitees,
        ]);
    }

    if ($action === 'sso-token') {
        // Ecosystem SSO (contract 6): mint a short-lived JWT for the device's
        // linked REAL account so the in-app game (and any ecosystem WebView)
        // authenticates without a separate login. Fails safe: 'unlinked' → app
        // prompts to link; 'unavailable' → app loads the game as a guest. The
        // game_url / issuer come from remote-config so they rotate without a
        // release. The app never holds real_api_key — the panel proxies.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        $rc = [];
        try {
            $rc = $pdo->query("SELECT key, value FROM settings WHERE key IN ('rc_game_url','rc_ecosystem_sso_enabled')")
                      ->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
        } catch (\Exception $e) {}
        // Phase 2 opt-in: only 'game=1' callers get the REAL-ID auto-fallback
        // (Agent B's design — this action is shared with TrustAiLinkScreen,
        // a separate product neither of us owns; must not change its
        // behavior). The app's forGame=true path (GameScreen/ssoService)
        // sets this once it ships; older installed builds omit it and see
        // the original 'unlinked'/'ok' behavior unchanged.
        $allowRealIdFallback = ($_GET['game'] ?? '') === '1';
        $result = re_sso_token($pdo, $deviceId, $allowRealIdFallback);
        ok([
            'status'      => $result['status'],                     // ok | unlinked | unavailable
            'token'       => $result['token']      ?? '',
            'expires_in'  => $result['expires_in'] ?? 0,
            'account'     => $result['account']    ?? '',
            'game_url'    => (string)($rc['rc_game_url'] ?? 'https://shahnameh.setaei.com'),
            'sso_enabled' => (bool)(int)($rc['rc_ecosystem_sso_enabled'] ?? 1),
        ]);
    }

    if ($action === 'handle-lookup' || $action === 'handle-reserve' || $action === 'handle-resolve') {
        // Identity layer (A-11): unique, addressable @handles for ReaLink users.
        // The registry lives on the panel because the panel owns the devices
        // table (natural uniqueness authority). The app is local-first and only
        // gates on this when reachable, so it degrades cleanly.
        //   handle-lookup   -> availability (read-only)
        //   handle-reserve  -> claim it for a device (+ optional profile)
        //   handle-resolve  -> friend-add: handle -> public mini-profile
        $pdo = db();
        $pdo->exec("CREATE TABLE IF NOT EXISTS device_handles (
            handle       TEXT PRIMARY KEY,
            device_id    TEXT NOT NULL UNIQUE,
            display_name TEXT DEFAULT '',
            avatar_emoji TEXT DEFAULT '',
            avatar_color TEXT DEFAULT '',
            created_at   TEXT DEFAULT (datetime('now')),
            updated_at   TEXT DEFAULT (datetime('now'))
        )");

        // Server-side normalize + validate (mirrors utils/handle.ts).
        $handle = strtolower(trim($_GET['handle'] ?? ''));
        $handle = ltrim($handle, '@');
        $handle = preg_replace('/\s+/', '', $handle);
        $validHandle = (strlen($handle) >= 3 && strlen($handle) <= 20
                        && preg_match('/^[a-z][a-z0-9_]*$/', $handle) === 1);

        if ($action === 'handle-resolve') {
            if (!$validHandle) err('invalid handle');
            $st = $pdo->prepare(
                "SELECT h.handle, h.device_id, COALESCE(d.user_id,'') AS user_id,
                        h.display_name, h.avatar_emoji, h.avatar_color
                 FROM device_handles h LEFT JOIN devices d ON d.device_id = h.device_id
                 WHERE h.handle = ?");
            $st->execute([$handle]);
            $row = $st->fetch(PDO::FETCH_ASSOC);
            if (!$row) ok(['found' => false]);
            ok([
                'found'        => true,
                'handle'       => $row['handle'],
                'device_id'    => $row['device_id'],
                'user_id'      => $row['user_id'],
                'display_name' => $row['display_name'],
                'avatar_emoji' => $row['avatar_emoji'],
                'avatar_color' => $row['avatar_color'],
            ]);
        }

        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$validHandle) ok(['available' => false, 'reason' => 'invalid']);

        // Who (if anyone) currently owns this handle?
        $st = $pdo->prepare("SELECT device_id FROM device_handles WHERE handle = ?");
        $st->execute([$handle]);
        $owner = $st->fetchColumn();
        $ownedByMe = ($owner !== false && $deviceId !== '' && $owner === $deviceId);
        $available = ($owner === false || $ownedByMe);

        if ($action === 'handle-lookup') {
            ok(['available' => $available, 'reason' => $available ? '' : 'taken']);
        }

        // handle-reserve — claim it.
        if ($deviceId === '') err('missing device_id');
        if (!$available) ok(['available' => false, 'reason' => 'taken']);
        // UTF-8-safe truncation without mbstring (not installed on this host).
        $cut = function (string $s, int $n): string {
            $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
            return $chars === false ? substr($s, 0, $n) : implode('', array_slice($chars, 0, $n));
        };
        $displayName = $cut(trim($_GET['display_name'] ?? ''), 40);
        $emoji       = $cut(trim($_GET['avatar_emoji'] ?? ''), 4);
        $color       = $cut(trim($_GET['avatar_color'] ?? ''), 9);
        $pdo->beginTransaction();
        try {
            // A device holds at most one handle — release the old one first.
            $del = $pdo->prepare("DELETE FROM device_handles WHERE device_id = ?");
            $del->execute([$deviceId]);
            $ins = $pdo->prepare(
                "INSERT INTO device_handles
                    (handle, device_id, display_name, avatar_emoji, avatar_color, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))");
            $ins->execute([$handle, $deviceId, $displayName, $emoji, $color]);
            $pdo->commit();
        } catch (\Exception $e) {
            $pdo->rollBack();
            // Lost a race for the same handle (UNIQUE) — report as taken.
            ok(['available' => false, 'reason' => 'taken']);
        }
        ok(['available' => true, 'reason' => '', 'reserved' => true]);
    }

    if ($action === 'resolve-recipient') {
        // Look up a transfer recipient by device_id / user_id / referral_code so
        // the Send-GB confirmation screen can show who will receive the quota.
        $param = trim($_GET['recipient'] ?? '');
        if ($param === '') err('missing recipient');
        $pdo = db();
        $r = qe_resolve_device($pdo, $param);
        if (!$r) err('recipient not found');
        ok([
            'device_id' => $r['device_id'],
            'user_id'   => $r['user_id'] ?? '',
            'country'   => $r['country'] ?? '',
            'blocked'   => (bool)($r['blocked'] ?? 0),
        ]);
    }

    if ($action === 'list-messages') {
        // Direct-message inbox/outbox for this device (v0.9.33). Bodies are
        // decrypted server-side; peers are identified by SetaLink ID only.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        ok([
            'messages' => dm_list($pdo, $deviceId),
            'unread'   => dm_unread_count($pdo, $deviceId),
        ]);
    }

    if ($action === 'get-typing') {
        // Polled every 2.5s while a DM thread is open (InboxScreen.tsx) — TTL-based,
        // no explicit "stopped typing" call (see MSG_TYPING_TTL_SECS).
        $deviceId = trim($_GET['device_id'] ?? '');
        $peer     = trim($_GET['peer'] ?? '');
        if (!$deviceId || $peer === '') err('missing params');
        $pdo = db();
        ok(['typing' => dm_get_typing($pdo, $deviceId, $peer)]);
    }

    if ($action === 'realgram-link-gate') {
        // Web linking page loaded inside an in-app WebView for the RealGram path
        // (GameScreen's RealIdGate -> RealGramLinkWebView, source: {uri}). This
        // MUST live in the GET block -- a WebView's source.uri always issues a
        // GET request, never POST. This handler previously lived inside the
        // if ($method === 'POST') block below, so every real load hit THIS
        // block's 'unknown action' fallback instead -- the WebView rendered
        // that raw JSON error and looked blank/broken to the user (reported
        // 2026-07-19, build 106: "REAL button -> WebView -> blank white
        // screen"). Moved here, 2026-07-19.
        //
        // Delegates to the ecosystem /link-gate which handles Telegram auth and
        // mints the HMAC proof; the ecosystem then returns a
        // setalink://link-real-account deep-link the WebView intercepts.
        // If the ecosystem is not configured, serves a fallback HTML page that
        // guides the user to the Telegram bot — no app release needed to update.
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        $cfg    = re_service_config($pdo);
        $apiUrl = rtrim($cfg['api_url'], '/');

        if ($apiUrl !== '') {
            // Ecosystem is configured: delegate to /link-gate
            $gate = $apiUrl . '/link-gate?' . http_build_query([
                'device_id'       => $deviceId,
                'callback_scheme' => 'setalink',
                'src'             => 'realink',
            ]);
            header('Location: ' . $gate, true, 302);
            exit;
        }

        // Fallback: ecosystem not yet reachable via web — serve inline HTML.
        header('Content-Type: text/html; charset=utf-8');
        $safeId = htmlspecialchars($deviceId, ENT_QUOTES, 'UTF-8');
        echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>RealGram Login</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#0d0d0f;
           color:#e8e8ea; display:flex; flex-direction:column; align-items:center;
           justify-content:center; min-height:100vh; padding:32px; box-sizing:border-box; text-align:center; }
    h2   { color:#D4AF37; margin-bottom:12px; }
    p    { color:#9CA3AF; line-height:1.6; margin-bottom:28px; }
    .btn { display:inline-block; padding:14px 32px; background:#D4AF37;
           color:#0d0d0f; border-radius:12px; text-decoration:none;
           font-weight:700; font-size:15px; margin-top:8px; }
    .sub { font-size:12px; color:#6B7280; margin-top:20px; }
  </style>
</head>
<body>
  <h2>⚔ RealGram Login</h2>
  <p>Link your REAL-ID to unlock Shahnameh and earn across all REAL apps.<br>
     Open the Telegram bot to verify your identity — no account registration required.</p>
  <a class="btn" href="https://t.me/shahnameh_bot?start=linkvpn_{$safeId}">
    Continue with Telegram
  </a>
  <p class="sub">Your REAL-ID is your Telegram identity.<br>
     It works across ReaLink, RealGram, Shahnameh, TrustAI and 3REAL.</p>
</body>
</html>
HTML;
        exit;
    }

    err('unknown action');
}

if ($method === 'POST') {

    if ($action === 'register-device') {
        $deviceId      = trim($_POST['device_id']       ?? '');
        $platform      = substr(trim($_POST['platform']      ?? 'android'), 0, 20);
        $appVersion    = substr(trim($_POST['app_version']   ?? ''), 0, 20);
        $language      = substr(trim($_POST['language']      ?? ''), 0, 30);
        $country       = substr(trim($_POST['country']       ?? ''), 0, 80);
        $androidIdHash = substr(trim($_POST['android_id_hash'] ?? ''), 0, 64);
        $manufacturer  = substr(trim($_POST['manufacturer']  ?? ''), 0, 80);
        $model         = substr(trim($_POST['model']         ?? ''), 0, 120);
        $sdkVersion    = (int)($_POST['sdk_version'] ?? 0);
        $androidVer    = substr(trim($_POST['android_version'] ?? ''), 0, 20);
        $abi           = substr(trim($_POST['abi']             ?? ''), 0, 80);
        // Carrier/operator name -> feeds per-operator learned routing.
        $carrier       = substr(trim($_POST['carrier']         ?? ''), 0, 80);
        if (!$deviceId) err('missing device_id');

        $clientIp = client_ip();
        $pdo      = db();

        // Fingerprint-based deduplication: if the same hardware (android_id_hash) already
        // registered under a different device_id, use the canonical existing device_id.
        $canonicalId = $deviceId;
        if ($androidIdHash) {
            $fp = $pdo->prepare("SELECT device_id FROM devices WHERE android_id_hash=? AND android_id_hash!='' LIMIT 1");
            $fp->execute([$androidIdHash]);
            $fpRow = $fp->fetch();
            if ($fpRow && $fpRow['device_id'] !== $deviceId) {
                $canonicalId = $fpRow['device_id'];
            }
        }
        $deviceId = $canonicalId;

        $stmt = $pdo->prepare("SELECT * FROM devices WHERE device_id=?");
        $stmt->execute([$deviceId]);
        $dev  = $stmt->fetch();

        // Auto-detect country from request IP if not provided by client
        if (!$country && $clientIp) {
            $geo     = detect_country_from_ip($clientIp);
            $country = $geo['code'];
            $countryName = $geo['name'];
        } else {
            $countryName = '';
        }

        if (!$dev) {
            $code = generate_referral_code($pdo);
            $uid  = generate_user_id($pdo);
            $pdo->prepare(
                "INSERT INTO devices
                    (device_id, user_id, referral_code, platform, app_version, language, country, country_name,
                     manufacturer, model, sdk_version, android_version, abi, android_id_hash, last_ip, status,
                     quota_bytes_total)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', 5368709120)"
            )->execute([$deviceId, $uid, $code, $platform, $appVersion, $language,
                        $country, $countryName, $manufacturer, $model, $sdkVersion,
                        $androidVer, $abi, $androidIdHash, $clientIp]);
            $stmt->execute([$deviceId]);
            $dev = $stmt->fetch();
        } else {
            // Backfill user_id if missing (existing devices before this migration)
            if (empty($dev['user_id'])) {
                $uid = generate_user_id($pdo);
                $pdo->prepare("UPDATE devices SET user_id=? WHERE device_id=? AND (user_id='' OR user_id IS NULL)")
                    ->execute([$uid, $deviceId]);
                $dev['user_id'] = $uid;
            }
            $pdo->prepare(
                "UPDATE devices SET
                    last_seen=datetime('now'), platform=?, app_version=?, language=?,
                    country=CASE WHEN ?!='' THEN ? ELSE country END,
                    country_name=CASE WHEN ?!='' THEN ? ELSE country_name END,
                    manufacturer=CASE WHEN ?!='' THEN ? ELSE manufacturer END,
                    model=CASE WHEN ?!='' THEN ? ELSE model END,
                    sdk_version=CASE WHEN ?>0 THEN ? ELSE sdk_version END,
                    android_version=CASE WHEN ?!='' THEN ? ELSE android_version END,
                    abi=CASE WHEN ?!='' THEN ? ELSE abi END,
                    android_id_hash=CASE WHEN ?!='' THEN ? ELSE android_id_hash END,
                    last_ip=CASE WHEN ?!='' THEN ? ELSE last_ip END,
                    status='online'
                 WHERE device_id=?"
            )->execute([
                $platform, $appVersion, $language,
                $country, $country,
                $countryName, $countryName,
                $manufacturer, $manufacturer,
                $model, $model,
                $sdkVersion, $sdkVersion,
                $androidVer, $androidVer,
                $abi, $abi,
                $androidIdHash, $androidIdHash,
                $clientIp, $clientIp,
                $deviceId,
            ]);
            $stmt->execute([$deviceId]);
            $dev = $stmt->fetch();
        }

        if ($carrier !== '') {
            try { $pdo->prepare("UPDATE devices SET carrier=? WHERE device_id=?")->execute([$carrier, $deviceId]); }
            catch (\Exception $e) { /* carrier column absent on very old schemas */ }
        }

        $srv = fetch_bootstrap_server($pdo);
        ok([
            'device_id'           => $dev['device_id'],
            'user_id'             => $dev['user_id']        ?? '',
            'referral_code'       => $dev['referral_code'],
            'plan'                => $dev['plan'],
            'test_mode'           => (int)($dev['test_mode'] ?? 0) === 1,
            'quota_bytes_total'   => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'    => (int)$dev['quota_bytes_used'],
            'valid_until'         => $dev['valid_until'],
            'blocked'             => (bool)$dev['blocked'],
            'server'              => $srv,
            'invite_count'        => (int)($dev['invite_count'] ?? 0),
            'active_invite_count' => 0,
            'stealth_unlocked'    => (bool)($dev['stealth_unlocked'] ?? 0),
            'country'             => $dev['country'] ?? '',
            // REAL-ID: ecosystem account shared across Shahnameh, 3REAL, TrustAI,
            // RealGram. Was missing here (only sync-entitlement had it) — meant
            // a fresh install could never detect an already-linked REAL-ID at
            // registration time, forcing a new @handle even on hardware the
            // fingerprint dedup above (android_id_hash) already recognized as
            // returning (Khabat, 2026-07-19).
            'linked_real_account' => (string)($dev['linked_real_account'] ?? ''),
        ]);
    }

    if ($action === 'report-install') {
        // OTA install outcome telemetry. Mirrors admin/api.php?mobile=1 —
        // the app posts here (setalink.no), so the action must exist here too.
        $event = trim($_POST['event'] ?? '');
        if (!in_array($event, ['install_success', 'install_failure', 'download_started'], true)) {
            err('invalid event');
        }
        $pdo = db();
        $pdo->exec("CREATE TABLE IF NOT EXISTS install_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       TEXT DEFAULT '',
            event           TEXT DEFAULT '',
            current_version TEXT DEFAULT '',
            target_version  TEXT DEFAULT '',
            device_model    TEXT DEFAULT '',
            android_version TEXT DEFAULT '',
            android_sdk     INTEGER DEFAULT 0,
            abi             TEXT DEFAULT '',
            error           TEXT DEFAULT '',
            client_ip       TEXT DEFAULT '',
            created_at      TEXT DEFAULT (datetime('now'))
        )");
        $pdo->prepare("INSERT INTO install_events
                (device_id,event,current_version,target_version,device_model,android_version,android_sdk,abi,error,client_ip)
             VALUES (?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                substr(trim($_POST['device_id']       ?? ''), 0, 128),
                $event,
                substr(trim($_POST['current_version'] ?? ''), 0, 20),
                substr(trim($_POST['target_version']  ?? ''), 0, 20),
                substr(trim($_POST['device_model']    ?? ''), 0, 120),
                substr(trim($_POST['android_version'] ?? ''), 0, 20),
                max(0, (int)($_POST['android_sdk'] ?? 0)),
                substr(trim($_POST['abi']             ?? ''), 0, 80),
                substr(trim($_POST['error']           ?? ''), 0, 300),
                client_ip(),
            ]);
        ok(['recorded' => true]);
    }

    if ($action === 'use-referral') {
        $deviceId = trim($_POST['device_id']    ?? '');
        $refCode  = strtoupper(trim($_POST['referral_code'] ?? ''));
        if (!$deviceId || !$refCode) err('missing params');

        $pdo  = db();
        // Primary: the real referral_code. Fallback: the user_id suffix form that
        // older app builds (≤0.9.26) shared, so invites from already-installed
        // clients still resolve. user_id is SL-227-XXXXXXXX; the suffix is XXXXXXXX.
        $owner = $pdo->prepare(
            "SELECT device_id FROM devices WHERE referral_code=? OR UPPER(user_id) LIKE ? LIMIT 1"
        );
        $owner->execute([$refCode, 'SL-%-' . $refCode]);
        $ownerRow = $owner->fetch();
        if (!$ownerRow)                         err('invalid referral code');
        if ($ownerRow['device_id'] === $deviceId) err('cannot use own referral code');

        $already = $pdo->prepare(
            "SELECT 1 FROM referral_uses WHERE new_device_id=? OR (new_device_id='' AND used_by=?)"
        );
        $already->execute([$deviceId, $deviceId]);
        if ($already->fetchColumn()) err('referral already used');

        // ── Anti-fraud scoring ─────────────────────────────────────────
        $newUserIp   = client_ip();
        $referrerRow = $pdo->prepare("SELECT last_ip, android_id_hash FROM devices WHERE device_id=?");
        $referrerRow->execute([$ownerRow['device_id']]);
        $referrerDev = $referrerRow->fetch();
        $referrerIp  = $referrerDev['referrer_ip'] ?? $referrerDev['last_ip'] ?? '';

        $riskScore = 0;
        $riskFlags = [];
        if ($newUserIp && $referrerIp && $newUserIp === $referrerIp) {
            $riskScore += 50;
            $riskFlags[] = 'same_ip';
        }
        // Rapid signups: >2 referrals from same new-user IP in last 24h
        $rapidCheck = $pdo->prepare(
            "SELECT COUNT(*) FROM referral_uses WHERE new_user_ip=? AND created_at >= datetime('now','-1 day')"
        );
        $rapidCheck->execute([$newUserIp]);
        if ((int)$rapidCheck->fetchColumn() >= 2) {
            $riskScore += 30;
            $riskFlags[] = 'rapid_signup';
        }
        // Same android_id_hash on both devices
        $newDevRow = $pdo->prepare("SELECT android_id_hash FROM devices WHERE device_id=?");
        $newDevRow->execute([$deviceId]);
        $newDev = $newDevRow->fetch();
        if (!empty($referrerDev['android_id_hash']) && !empty($newDev['android_id_hash'])
            && $referrerDev['android_id_hash'] === $newDev['android_id_hash']) {
            $riskScore += 80;
            $riskFlags[] = 'same_device';
        }
        // TrustAI enrichment: when the service is configured it replaces the
        // local heuristic score, but can never LOWER a score the local rules
        // already flagged (a broken/poisoned TrustAI must not unlock fraud).
        // Local flags are kept alongside for audit. Unconfigured/unreachable
        // TrustAI leaves the local score untouched.
        try {
            $tai = trustai_score_referral($pdo, [
                'event'              => 'referral_use',
                'referrer_device_id' => $ownerRow['device_id'],
                'new_device_id'      => $deviceId,
                'referral_code'      => $refCode,
                'referrer_ip'        => $referrerIp,
                'new_user_ip'        => $newUserIp,
                'referrer_fp'        => (string)($referrerDev['android_id_hash'] ?? ''),
                'new_device_fp'      => (string)($newDev['android_id_hash'] ?? ''),
                'local_risk_score'   => $riskScore,
                'local_risk_flags'   => $riskFlags,
            ]);
            if ($tai !== null) {
                $riskScore = max($riskScore, $tai['score']);
                $riskFlags = array_merge($riskFlags, $tai['flags'], ['trustai_scored']);
            }
        } catch (\Exception $e) { /* local heuristic remains authoritative */ }
        // Risk gate: at or above the threshold the reward is HELD, not granted.
        // 'pending' rows carry the intended bonus in bonus_bytes but credit
        // nothing until an admin approves (admin/api.php referral-approve).
        // Statuses: credited (auto) | pending | approved (by admin) | rejected.
        $riskStatus = $riskScore >= RISK_HOLD_THRESHOLD ? 'pending' : 'credited';
        $riskFlagsJson = json_encode($riskFlags);

        $bonus = 1073741824; // 1 GB
        $pdo->prepare(
            "INSERT INTO referral_uses (referral_code, used_by, referrer_device_id, new_device_id, bonus_bytes,
             referrer_ip, new_user_ip, risk_score, risk_flags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )->execute([$refCode, $deviceId, $ownerRow['device_id'], $deviceId, $bonus,
                    $referrerIp, $newUserIp, $riskScore, $riskFlagsJson, $riskStatus]);

        $rewardReal   = [];  // party => grant status, for the response (C3)
        if ($riskStatus === 'credited') {
            // Reward mode (plan C3): 'quota' (default) grants VPN quota as
            // before; 'real' grants REAL to a linked account instead (falling
            // back to quota when unlinked so nobody goes unrewarded); 'both'
            // grants quota AND REAL. Default is 'quota' → behaviour unchanged.
            re_ensure_schema($pdo);  // referral grants share the real_redemptions ledger
            $rw = re_referral_settings($pdo);
            $grantParty = function (string $dev, string $txRef, string $meta) use ($pdo, $rw, $bonus) {
                $status = 'quota';
                if ($rw['mode'] !== 'quota') {
                    $status = re_referral_grant($pdo, $dev, $rw['real_reward'], $txRef);
                }
                // Grant quota unless this was a REAL-only grant that succeeded/pending.
                $realHandled = in_array($status, ['credited', 'pending'], true);
                if ($rw['mode'] === 'quota' || $rw['mode'] === 'both' || !$realHandled) {
                    qe_ledger_add($pdo, $dev, 'referral_reward', $bonus, $meta);
                }
                return $status;
            };
            $rewardReal['invitee']  = $grantParty($deviceId, 'refgrant-' . $refCode . '-' . $deviceId, 'referral ' . $refCode);
            $rewardReal['referrer'] = $grantParty($ownerRow['device_id'], 'refgrant-' . $refCode . '-' . $ownerRow['device_id'], 'referrer of ' . $deviceId);

            // ── Viral loop: ≥3 active GRANTED referrals unlock stealth ─────
            $activeRefs = $pdo->prepare("
                SELECT COUNT(*) FROM referral_uses ru
                JOIN devices d ON d.device_id = ru.new_device_id
                WHERE ru.referrer_device_id=?
                  AND ru.status IN ('credited','approved')
                  AND (d.internet_ok=1 OR d.last_seen >= datetime('now','-7 days'))
            ");
            $activeRefs->execute([$ownerRow['device_id']]);
            if ((int)$activeRefs->fetchColumn() >= 3) {
                $pdo->prepare("UPDATE devices SET stealth_unlocked=1 WHERE device_id=?")
                    ->execute([$ownerRow['device_id']]);
            }
            // Update invite_count cache on referrer (granted referrals only)
            $invCount = $pdo->prepare(
                "SELECT COUNT(*) FROM referral_uses WHERE referrer_device_id=? AND status IN ('credited','approved')");
            $invCount->execute([$ownerRow['device_id']]);
            $pdo->prepare("UPDATE devices SET invite_count=? WHERE device_id=?")
                ->execute([(int)$invCount->fetchColumn(), $ownerRow['device_id']]);

            // Referrer just gained an approved invite — grant any milestone it crossed.
            try { qe_evaluate_milestones($pdo, $ownerRow['device_id']); } catch (\Exception $e) {}
        }

        $dev = $pdo->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?");
        $dev->execute([$deviceId]);
        $row = $dev->fetch();
        ok([
            'status'          => $riskStatus === 'credited' ? 'approved' : 'pending_review',
            'bonus_bytes'     => $riskStatus === 'credited' ? $bonus : 0,
            'new_total_bytes' => (int)$row['quota_bytes_total'],
            'risk_score'      => $riskScore,
            'risk_flags'      => $riskFlags,
            // C3: per-party REAL grant outcome ('quota'|'credited'|'pending'|
            // 'rejected'|'skipped'). Absent/all-'quota' = classic quota reward.
            'real_reward'     => $rewardReal,
        ]);
    }

    if ($action === 'ack-message') {
        $deviceId  = trim($_POST['device_id'] ?? '');
        $messageId = (int)($_POST['message_id'] ?? 0);
        if (!$deviceId || $messageId <= 0) err('missing params');
        $pdo = db();
        init_message_tables($pdo);
        $pdo->prepare('INSERT OR IGNORE INTO admin_message_acks (message_id, device_id) VALUES (?,?)')
            ->execute([$messageId, $deviceId]);
        ok(['acked' => $messageId]);
    }

    if ($action === 'report-usage') {
        // Heartbeat / remaining-quota read ONLY. Quota is accumulated server-side
        // by report-session (single writer, delta model) — report-usage must NOT
        // mutate quota or it double-counts. The client historically passed a
        // cumulative total here, which a "+=" turned into runaway inflation.
        $deviceId  = trim($_POST['device_id']  ?? '');
        if (!$deviceId) err('missing device_id');

        $pdo = db();
        $pdo->prepare("UPDATE devices SET last_seen=datetime('now') WHERE device_id=?")
            ->execute([$deviceId]);

        $dev = $pdo->prepare("SELECT quota_bytes_total, quota_bytes_used FROM devices WHERE device_id=?");
        $dev->execute([$deviceId]);
        $row = $dev->fetch();
        if (!$row) err('device not found');

        ok(['remaining_bytes' => max(0, (int)$row['quota_bytes_total'] - (int)$row['quota_bytes_used'])]);
    }

    if ($action === 'update-status') {
        $deviceId        = trim($_POST['device_id']          ?? '');
        $status          = trim($_POST['status']              ?? 'offline');
        $protocol        = substr(trim($_POST['active_protocol'] ?? ''), 0, 60);
        $activeSni       = substr(trim($_POST['active_sni']      ?? ''), 0, 120);
        $failureCat      = substr(trim($_POST['failure_category'] ?? ''), 0, 80);
        $dnsOk      = isset($_POST['dns_ok'])      ? (int)$_POST['dns_ok']      : null;
        $internetOk = isset($_POST['internet_ok']) ? (int)$_POST['internet_ok'] : null;
        $rxBytes    = isset($_POST['rx_bytes'])    ? (int)$_POST['rx_bytes']    : null;
        $txBytes    = isset($_POST['tx_bytes'])    ? (int)$_POST['tx_bytes']    : null;
        $latencyMs  = isset($_POST['latency_ms'])  ? (int)$_POST['latency_ms']  : null;
        if (!$deviceId) err('missing device_id');
        if (!in_array($status, ['online', 'offline'], true)) $status = 'offline';

        $pdo  = db();
        $clientIp = client_ip();

        // Build update dynamically — only overwrite active_protocol/sni when provided
        // to avoid clearing them on disconnect (client sends no protocol on offline).
        $sets = ["status=?", "last_seen=datetime('now')"];
        $vals = [$status];
        if ($protocol !== '')      { $sets[] = "active_protocol=?";       $vals[] = $protocol; }
        if ($activeSni !== '')     { $sets[] = "active_sni=?";            $vals[] = $activeSni; }
        if ($dnsOk     !== null)   { $sets[] = "dns_ok=?";                $vals[] = $dnsOk; }
        if ($internetOk !== null)  { $sets[] = "internet_ok=?";           $vals[] = $internetOk; }
        if ($rxBytes   !== null)   { $sets[] = "rx_bytes=?";              $vals[] = $rxBytes; }
        if ($txBytes   !== null)   { $sets[] = "tx_bytes=?";              $vals[] = $txBytes; }
        if ($latencyMs !== null)   { $sets[] = "latency_ms=?";            $vals[] = $latencyMs; }
        if ($clientIp)             { $sets[] = "last_ip=?";               $vals[] = $clientIp; }
        // Track last failure category so admin can see per-device why routing fails
        if ($failureCat !== '') {
            $sets[] = "last_failure_category=?";   $vals[] = $failureCat;
            $sets[] = "last_failure_at=datetime('now')";
        }
        $vals[] = $deviceId;

        $pdo->prepare("UPDATE devices SET " . implode(', ', $sets) . " WHERE device_id=?")->execute($vals);
        if ($clientIp) touch_ip_geo($pdo, $deviceId);
        ok(['status' => $status]);
    }

    if ($action === 'profile-bundle') {
        // GET action (but POST path also accepted)
        $pdo = db();
        // Read bundle config from settings table (admin-editable)
        $rows = [];
        try { $rows = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'bundle_%'")->fetchAll(PDO::FETCH_KEY_PAIR); } catch (\Exception $e) {}

        $sni_candidates = json_decode($rows['bundle_sni_candidates'] ?? '[]', true) ?: [
            'www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net',
        ];
        $spoof_snis = json_decode($rows['bundle_spoof_snis'] ?? '[]', true) ?: [
            'auth.vercel.com','cdn.jsdelivr.net','hcaptcha.com','assets.vercel.com','images.unsplash.com','cloudflare.com',
        ];
        $backup_ips     = json_decode($rows['bundle_backup_ips']     ?? '[]', true) ?: ['178.104.77.231'];
        $backup_domains = json_decode($rows['bundle_backup_domains'] ?? '[]', true) ?: ['vpn.setalink.no'];

        ok([
            'version'        => (int)($rows['bundle_version'] ?? 1),
            'published_at'   => $rows['bundle_published_at'] ?? date('Y-m-d'),
            'sni_candidates' => $sni_candidates,
            'spoof_snis'     => $spoof_snis,
            'backup_ips'     => $backup_ips,
            'backup_domains' => $backup_domains,
            'profiles'       => [],
        ]);
    }

    // Accept both action names: the app posts 'payment-submit', older docs/handlers
    // used 'submit-payment'. Supporting both prevents an "unknown action" failure
    // for installed clients.
    if ($action === 'submit-payment' || $action === 'payment-submit') {
        $deviceId = trim($_POST['device_id']  ?? '');
        $uid      = substr(trim($_POST['user_id'] ?? ''), 0, 64);
        $pkg      = trim($_POST['package']     ?? '');
        $memo     = substr(trim($_POST['memo'] ?? ''), 0, 255);
        $tx       = substr(trim($_POST['tx_hash'] ?? ''), 0, 100);
        $amt      = (float)($_POST['amount_usdt'] ?? 0);
        $validPkgs = ['7days','30days','unlimited','10GB','20GB','30GB'];
        if (!$deviceId) err('missing device_id');
        if (!in_array($pkg, $validPkgs, true)) err('invalid package');
        // Derive user_id from memo when the client only sent it as the memo.
        if (!$uid && preg_match('/^SL-\d+-[A-Z0-9]+$/i', $memo)) $uid = $memo;

        $pdo = db();
        $pdo->exec("CREATE TABLE IF NOT EXISTS payment_queue (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   TEXT NOT NULL,
            memo        TEXT DEFAULT '',
            package     TEXT NOT NULL DEFAULT '30days',
            amount_usdt REAL DEFAULT 0,
            tx_hash     TEXT DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')),
            reviewed_at  TEXT DEFAULT NULL,
            reviewed_by  TEXT DEFAULT '',
            note         TEXT DEFAULT ''
        )");
        try { $pdo->exec("ALTER TABLE payment_queue ADD COLUMN user_id TEXT DEFAULT ''"); } catch (\Exception $e) {}
        $pdo->prepare("INSERT INTO payment_queue (device_id, user_id, package, memo, tx_hash, amount_usdt) VALUES (?,?,?,?,?,?)")
            ->execute([$deviceId, $uid, $pkg, $memo, $tx, $amt]);
        ok(['payment_id' => (int)$pdo->lastInsertId()]);
    }

    if ($action === 'report-session') {
        // SINGLE source of quota accumulation (delta model). Each session adds its
        // own bytes exactly once; report-usage does not touch quota. A client-supplied
        // session_id makes retries idempotent so a re-sent disconnect cannot double-book.
        $deviceId     = trim($_POST['device_id']     ?? '');
        $protocol     = substr(trim($_POST['protocol']  ?? ''), 0, 60);
        $bytesSent    = max(0, (int)($_POST['bytes_sent']    ?? 0));
        $bytesRecv    = max(0, (int)($_POST['bytes_recv']    ?? 0));
        $durationSecs = (int)($_POST['duration_secs'] ?? 0);
        $appVersion   = substr(trim($_POST['app_version'] ?? ''), 0, 20);
        $sessionId    = substr(trim($_POST['session_id'] ?? ''), 0, 80);
        $rawProbe     = trim($_POST['probe_result'] ?? '');
        $probeResult  = in_array($rawProbe, ['ok', 'fail', 'unknown'], true) ? $rawProbe : 'unknown';
        $errorReason  = substr(trim($_POST['error_reason'] ?? ''), 0, 300);
        // recovery=1 → bytes are metered against the hidden reserve, NOT visible quota.
        $isRecovery   = (int)($_POST['recovery'] ?? 0) === 1;
        if (!$deviceId || $durationSecs < 1) err('invalid session data');

        $pdo = db();
        // Create sessions table if not exists
        $pdo->exec("CREATE TABLE IF NOT EXISTS vpn_sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id     TEXT,
            protocol      TEXT,
            bytes_sent    INTEGER DEFAULT 0,
            bytes_recv    INTEGER DEFAULT 0,
            duration_secs INTEGER DEFAULT 0,
            app_version   TEXT    DEFAULT '',
            started_at    TEXT,
            ended_at      TEXT    DEFAULT (datetime('now')),
            client_ip     TEXT    DEFAULT ''
        )");
        // Idempotency column + unique index (added lazily for existing DBs).
        try { $pdo->exec("ALTER TABLE vpn_sessions ADD COLUMN session_id TEXT DEFAULT ''"); } catch (\Exception $e) {}
        try { $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_devsid ON vpn_sessions(device_id, session_id) WHERE session_id <> ''"); } catch (\Exception $e) {}
        // Probe + error diagnostics (added lazily — surfaced in device-detail modal).
        try { $pdo->exec("ALTER TABLE vpn_sessions ADD COLUMN probe_result TEXT DEFAULT ''"); } catch (\Exception $e) {}
        try { $pdo->exec("ALTER TABLE vpn_sessions ADD COLUMN error_reason TEXT DEFAULT ''"); } catch (\Exception $e) {}

        // Fall back to a synthetic key when the client sends none, so older clients
        // still log (but without cross-retry dedup).
        if ($sessionId === '') $sessionId = $deviceId . '-' . (string)(microtime(true));

        $ins = $pdo->prepare(
            "INSERT OR IGNORE INTO vpn_sessions
                (device_id, protocol, bytes_sent, bytes_recv, duration_secs, app_version,
                 started_at, ended_at, client_ip, session_id, probe_result, error_reason)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', ? || ' seconds'), datetime('now'), ?, ?, ?, ?)"
        );
        $ins->execute([
            $deviceId, $protocol, $bytesSent, $bytesRecv,
            $durationSecs, $appVersion,
            '-' . $durationSecs,
            $_SERVER['REMOTE_ADDR'] ?? '',
            $sessionId,
            $probeResult,
            $errorReason,
        ]);

        // Accumulate quota ONLY when this is a new (non-duplicate) session row,
        // and clamp so used can never exceed total. Recovery-mode bytes are metered
        // against the hidden reserve instead of the visible package.
        $total = $bytesSent + $bytesRecv;
        if ($ins->rowCount() > 0 && $total > 0) {
            if ($isRecovery) {
                ar_meter_recovery($pdo, $deviceId, $total);
                $pdo->prepare("UPDATE devices SET last_seen=datetime('now') WHERE device_id=?")
                    ->execute([$deviceId]);
            } else {
                $pdo->prepare(
                    "UPDATE devices
                        SET quota_bytes_used = MIN(quota_bytes_total, quota_bytes_used + ?),
                            last_seen = datetime('now')
                      WHERE device_id = ?"
                )->execute([$total, $deviceId]);
            }
        }
        ok(['recorded' => $ins->rowCount() > 0, 'recovery' => $isRecovery]);
    }

    if ($action === 'track-event') {
        // Lightweight client analytics sink (fire-and-forget). Used by the Premium
        // screen and others. Best-effort logging only — never authoritative.
        $deviceId   = trim($_POST['device_id'] ?? '');
        $event      = substr(trim($_POST['event'] ?? ''), 0, 64);
        $props      = substr((string)($_POST['props'] ?? ''), 0, 1000);
        $appVersion = substr(trim($_POST['app_version'] ?? ''), 0, 20);
        if ($event === '') err('missing event');
        $pdo = db();
        $pdo->exec("CREATE TABLE IF NOT EXISTS app_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   TEXT NOT NULL DEFAULT '',
            event       TEXT NOT NULL,
            props       TEXT NOT NULL DEFAULT '',
            app_version TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )");
        $pdo->prepare("INSERT INTO app_events (device_id, event, props, app_version) VALUES (?,?,?,?)")
            ->execute([$deviceId, $event, $props, $appVersion]);
        $appEventId = (int)$pdo->lastInsertId();

        // Real-value AdMob banner impressions (onPaid, client-reported) also mirror
        // into the provider-agnostic model live, so the Overview tab doesn't lag a
        // full day behind waiting for the backfill/rollup job.
        if ($event === 'AD_BANNER_IMPRESSION') {
            try {
                $propsArr = json_decode($props, true) ?: [];
                am_event_insert($pdo, [
                    'provider'          => 'admob',
                    'event_type'        => 'banner_impression',
                    'placement'         => (string)($propsArr['slot'] ?? ''),
                    'provider_event_id' => 'admob-banner:' . $appEventId,
                    'user_id'           => $deviceId,
                    'provider_revenue'  => isset($propsArr['value']) ? (float)$propsArr['value'] : null,
                    'currency'          => (string)($propsArr['currency'] ?? 'USD'),
                    'reward_type'       => 'none',
                    'validation_status' => 'unverified',
                    'app_version'       => $appVersion,
                    'source_type'       => 'LOCAL_SDK_EVENT',
                ]);
            } catch (\Exception $e) { /* best-effort — never break track-event over analytics */ }
        }
        ok(['logged' => true]);
    }

    if ($action === 'ecosystem-referral-import') {
        // Contract §7 (new, 2026-07-19): Shahnameh → panel, the reverse
        // direction of §2-6. Service-to-service only (exempted from
        // MOBILE_TOKEN above, NO_TOKEN_ACTIONS) — authenticates instead
        // with the SAME shared secret (real_api_key) already used for
        // panel→Shahnameh calls, just checked from this side now. Imports
        // resolved (both sides already SSO-linked) inviter/invitee pairs
        // from Shahnameh's referral history into ecosystem_referrals —
        // separate from ReaLink's own device-based referral_uses table,
        // which this does not touch.
        $authHeader = '';
        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $k) {
            if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; }
        }
        $presented = '';
        if (preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) $presented = trim($m[1]);
        $pdo = db();
        $expected = (string)($pdo->query(
            "SELECT value FROM settings WHERE key='real_api_key'"
        )->fetchColumn() ?: '');
        if ($expected === '' || !hash_equals($expected, $presented)) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'unauthorized']);
            exit;
        }

        $body = json_decode((string)file_get_contents('php://input'), true);
        $rows = is_array($body['referrals'] ?? null) ? $body['referrals'] : [];
        if (count($rows) === 0) err('missing referrals');
        if (count($rows) > 1000) $rows = array_slice($rows, 0, 1000); // sanity clamp

        $pdo->exec("CREATE TABLE IF NOT EXISTS ecosystem_referrals (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            inviter_real_account  TEXT NOT NULL,
            invitee_real_account  TEXT NOT NULL,
            source                TEXT NOT NULL,
            original_ts           TEXT,
            imported_at           TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(inviter_real_account, invitee_real_account, source)
        )");
        $ins = $pdo->prepare(
            "INSERT OR IGNORE INTO ecosystem_referrals
                (inviter_real_account, invitee_real_account, source, original_ts)
             VALUES (?,?,?,?)"
        );
        $imported = 0; $skipped = 0;
        $pdo->beginTransaction();
        foreach ($rows as $r) {
            if (!is_array($r)) { $skipped++; continue; }
            $inviter = trim((string)($r['inviter_real_account'] ?? ''));
            $invitee = trim((string)($r['invitee_real_account'] ?? ''));
            $source  = substr(trim((string)($r['source'] ?? '')), 0, 32);
            $ts      = trim((string)($r['original_ts'] ?? ''));
            if ($inviter === '' || $invitee === '' || $source === '') { $skipped++; continue; }
            $ins->execute([$inviter, $invitee, $source, $ts !== '' ? $ts : null]);
            if ($ins->rowCount() > 0) $imported++; else $skipped++; // rowCount=0 => UNIQUE hit, already imported
        }
        $pdo->commit();
        ok(['imported' => $imported, 'skipped_or_duplicate' => $skipped, 'received' => count($rows)]);
    }

    if ($action === 'track-taps-batch') {
        // Batched UI tap telemetry (B-24). Client buffers taps and flushes
        // periodically instead of one HTTP call per tap — keep this cheap
        // and best-effort, same posture as track-event above.
        //
        // protocol/node (2026-07-19, REALGRAM_UNIFIED_PLATFORM.md §B, "tap
        // data should anonymously inform speed/stability/node-quality
        // analysis"): optional, sent only when the device is VPN-connected
        // at tap time (client already knows this from vpnStore — no new
        // client-side lookup). Deliberately kept on THIS anonymous UI-tap
        // table, not the ZAR-earning tap-sync action above — tap
        // responsiveness/frequency correlated with active protocol/node is
        // a connection-quality signal, unrelated to and never gating the
        // ZAR economy.
        $deviceId   = trim($_POST['device_id'] ?? '');
        $appVersion = substr(trim($_POST['app_version'] ?? ''), 0, 20);
        $taps       = json_decode((string)($_POST['taps'] ?? ''), true);
        if (!is_array($taps) || count($taps) === 0) err('missing taps');
        if (count($taps) > 200) $taps = array_slice($taps, 0, 200); // abuse clamp
        $pdo = db();
        $pdo->exec("CREATE TABLE IF NOT EXISTS tap_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   TEXT,
            screen      TEXT NOT NULL,
            element     TEXT NOT NULL,
            ts          INTEGER NOT NULL,
            received_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            app_version TEXT
        )");
        try { $pdo->exec("ALTER TABLE tap_events ADD COLUMN protocol TEXT NOT NULL DEFAULT ''"); }
        catch (\Exception $e) { /* column exists */ }
        try { $pdo->exec("ALTER TABLE tap_events ADD COLUMN node TEXT NOT NULL DEFAULT ''"); }
        catch (\Exception $e) { /* column exists */ }
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_tap_events_screen ON tap_events(screen)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_tap_events_ts ON tap_events(ts)");
        $ins = $pdo->prepare(
            "INSERT INTO tap_events (device_id, screen, element, ts, app_version, protocol, node) VALUES (?,?,?,?,?,?,?)"
        );
        $pdo->beginTransaction();
        $inserted = 0;
        foreach ($taps as $t) {
            if (!is_array($t)) continue;
            $screen   = substr(trim((string)($t['screen'] ?? '')), 0, 64);
            $element  = substr(trim((string)($t['element'] ?? '')), 0, 64);
            $ts       = (int)($t['ts'] ?? 0);
            $protocol = substr(trim((string)($t['protocol'] ?? '')), 0, 16);
            $node     = substr(trim((string)($t['node'] ?? '')), 0, 64);
            if ($screen === '' || $element === '' || $ts <= 0) continue;
            $ins->execute([$deviceId, $screen, $element, $ts, $appVersion, $protocol, $node]);
            $inserted++;
        }
        $pdo->commit();
        ok(['logged' => $inserted]);
    }

    if ($action === 'transfer-quota') {
        // Send GB to a friend. Atomic, audited (quota_transfer + two ledger rows).
        // Starter quota is never transferable; min 100 MB; max = transferable balance.
        $deviceId  = trim($_POST['device_id'] ?? '');
        $recipient = trim($_POST['recipient'] ?? '');  // device_id | user_id | referral_code
        $bytes     = (int)($_POST['bytes'] ?? 0);
        if (!$deviceId || $recipient === '') err('missing params');
        $pdo = db();
        try {
            $result = qe_transfer($pdo, $deviceId, $recipient, $bytes, 'mobile transfer');
        } catch (\RuntimeException $e) {
            err($e->getMessage());
        }
        // Inbox notifications for both parties (BUG-2). Best-effort.
        $senderId   = '';
        $sIdRow = $pdo->prepare('SELECT user_id FROM devices WHERE device_id=?');
        $sIdRow->execute([$deviceId]);
        $senderId   = (string)($sIdRow->fetchColumn() ?: $deviceId);
        $receiverId = (string)($result['receiver_user_id'] ?: $result['receiver_device']);
        $gbStr      = fmt_gb((int)$result['bytes']);
        push_device_message($pdo, $result['receiver_device'], 'Gigabytes received',
            "User {$senderId} sent you {$gbStr} GB.");
        push_device_message($pdo, $deviceId, 'Gigabytes sent',
            "You sent {$gbStr} GB to {$receiverId}.");
        ok($result);
    }

    if ($action === 'send-message') {
        // User-to-user direct message (v0.9.33). Recipient addressed by
        // SetaLink ID (device_id | user_id | referral_code). Rate-limited,
        // body encrypted at rest. No phone/email/IP is touched.
        // expire_secs (optional, v0.9.58): disappearing-message timer — the row
        // is hard-deleted expire_secs after the recipient READS it (0 = never).
        $deviceId   = trim($_POST['device_id'] ?? '');
        $recipient  = trim($_POST['recipient'] ?? '');
        $body       = (string)($_POST['body'] ?? '');
        $expireSecs = (int)($_POST['expire_secs'] ?? 0);
        if (!$deviceId || $recipient === '') err('missing params');
        $pdo = db();
        try {
            $result = dm_send($pdo, $deviceId, $recipient, $body, $expireSecs);
        } catch (\RuntimeException $e) {
            err($e->getMessage());
        }
        ok($result);
    }

    if ($action === 'mark-message-read') {
        $deviceId  = trim($_POST['device_id'] ?? '');
        $messageId = (int)($_POST['message_id'] ?? 0);
        if (!$deviceId || $messageId <= 0) err('missing params');
        $pdo = db();
        ok(['updated' => dm_mark_read($pdo, $deviceId, $messageId)]);
    }

    if ($action === 'delete-message') {
        // Per-user soft-delete (v0.9.35): hides the message from this device only.
        $deviceId  = trim($_POST['device_id'] ?? '');
        $messageId = (int)($_POST['message_id'] ?? 0);
        if (!$deviceId || $messageId <= 0) err('missing params');
        $pdo = db();
        ok(['deleted' => dm_delete_message($pdo, $deviceId, $messageId)]);
    }

    if ($action === 'delete-thread') {
        // Per-user soft-delete of a whole conversation (by peer SetaLink ID).
        $deviceId = trim($_POST['device_id'] ?? '');
        $peer     = trim($_POST['peer'] ?? '');
        if (!$deviceId || $peer === '') err('missing params');
        $pdo = db();
        ok(['deleted' => dm_delete_thread($pdo, $deviceId, $peer)]);
    }

    if ($action === 'react-message') {
        // Toggle a reaction (2026-07-22): the mobile client (entitlementService.ts,
        // DM_REACTIONS) has called this since the chat pass shipped, but nothing
        // server-side implemented it until now — every real tap was silently
        // failing (caught, logged, UI just never updated). See lib/messaging.php's
        // dm_react() for the toggle/replace/validation rules.
        $deviceId  = trim($_POST['device_id'] ?? '');
        $messageId = (int)($_POST['message_id'] ?? 0);
        $emoji     = trim($_POST['emoji'] ?? '');
        if (!$deviceId || $messageId <= 0 || $emoji === '') err('missing params');
        $pdo = db();
        try {
            $result = dm_react($pdo, $deviceId, $messageId, $emoji);
        } catch (\RuntimeException $e) {
            err($e->getMessage());
        }
        ok($result);
    }

    if ($action === 'set-typing') {
        // Fire-and-forget, debounced client-side to once per 2.5s (InboxScreen.tsx).
        // Same gap as react-message above: client has called this since the chat
        // pass shipped, nothing server-side existed to receive it.
        $deviceId = trim($_POST['device_id'] ?? '');
        $peer     = trim($_POST['peer'] ?? '');
        if (!$deviceId || $peer === '') err('missing params');
        $pdo = db();
        dm_set_typing($pdo, $deviceId, $peer);
        ok(['ok' => true]);
    }

    if ($action === 'link-real-account') {
        // A2: bind this device to a REAL account. Proof minted by Telegram bot
        // (B-3) or RealGram web gate — both yield the same canonical Telegram
        // user_id as the account string, so re-linking from either path is
        // idempotent (no duplicate accounts possible for the same person).
        $deviceId = trim($_POST['device_id'] ?? '');
        $account  = trim($_POST['real_account'] ?? '');
        $ts       = (int)($_POST['ts'] ?? 0);
        $sig      = trim($_POST['sig'] ?? '');
        $source   = in_array($_POST['source'] ?? '', ['telegram','realgram'], true)
                    ? $_POST['source'] : 'unknown';
        if (!$deviceId || $account === '' || !$ts || $sig === '') err('missing params');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!re_verify_link_proof($pdo, $deviceId, $account, $ts, $sig)) err('invalid link proof');
        // Log re-links for dedup audit (same device, different account = suspicious).
        $existing = re_linked_account($pdo, $deviceId);
        if ($existing !== '' && $existing !== $account) {
            try {
                $pdo->prepare(
                    "INSERT OR IGNORE INTO analytics (type, device_id, value, created_at)
                     VALUES ('real_relink', ?, ?, datetime('now'))"
                )->execute([$deviceId, json_encode(['old'=>$existing,'new'=>$account,'src'=>$source])]);
            } catch (\Exception $_) {}
        }
        if (!re_link_account($pdo, $deviceId, $account)) err('unknown device');
        // Stamp the link timestamp for conversion analytics (adp_conversion_series).
        try {
            $pdo->prepare(
                "UPDATE devices SET real_linked_at = datetime('now')
                 WHERE device_id = ? AND (real_linked_at IS NULL OR real_linked_at = '')"
            )->execute([$deviceId]);
        } catch (\Exception $_) {}
        ok(['linked_real_account' => $account]);
    }

    if ($action === 'save-real-profile') {
        // Ecosystem profile write: persists ReaLink identity (handle, avatar,
        // persona) to the shared real_profiles table so all REAL ecosystem apps
        // (Shahnameh, RealGram, TrustAI, 3REAL) can read it without re-asking.
        // Only accepted for devices that have a linked REAL-ID.
        $deviceId = trim($_POST['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        re_ensure_schema($pdo);
        $account = re_linked_account($pdo, $deviceId);
        if ($account === '') err('no linked real account');
        re_save_profile($pdo, $account, [
            'handle'       => trim($_POST['handle']       ?? ''),
            'display_name' => trim($_POST['display_name'] ?? ''),
            'avatar_emoji' => trim($_POST['avatar_emoji'] ?? ''),
            'avatar_color' => trim($_POST['avatar_color'] ?? ''),
            'persona'      => trim($_POST['persona']      ?? ''),
        ]);
        ok(['account' => $account, 'saved' => true]);
    }

    if ($action === 'get-real-profile') {
        // Ecosystem profile read: open to all apps (no device auth required).
        // Returns stored profile for a given REAL account, or {account} only
        // if the user hasn't saved one yet. All ecosystem apps call this to
        // get avatar/handle before a JWT (B-8) is available.
        $account = trim($_GET['account'] ?? '');
        if (!$account) err('missing account');
        $pdo = db();
        re_ensure_schema($pdo);
        $profile = re_get_profile($pdo, $account);
        ok($profile ?: ['account' => $account]);
    }

    if ($action === 'redeem-real') {
        // A2: spend REAL for VPN quota. The spend is verified server-to-server
        // against the ecosystem backend, never on client claims; when that
        // service is unconfigured/unreachable the redemption stays 'pending'
        // for admin review. tx_ref is the idempotency key — a retried request
        // returns the recorded outcome instead of crediting twice.
        $deviceId = trim($_POST['device_id'] ?? '');
        $amount   = (float)($_POST['real_amount'] ?? 0);
        $txRef    = trim($_POST['tx_ref'] ?? '');
        if (!$deviceId || $txRef === '') err('missing params');
        $pdo = db();
        re_ensure_schema($pdo);
        $q = re_quote($pdo, $deviceId, $amount);
        if (isset($q['error'])) err($q['error']);
        $quotaBytes = $q['quota_bytes'];
        $id = re_record($pdo, $deviceId, $q['account'], $amount, $quotaBytes, $txRef);
        if ($id === null) {
            $prev = re_get_by_tx($pdo, $txRef);
            ok(['status'      => $prev['status'] ?? 'pending',
                'quota_bytes' => (int)($prev['quota_bytes'] ?? 0),
                'duplicate'   => true]);
        }
        $verdict = re_verify_spend($pdo, $q['account'], $amount, $txRef);
        if ($verdict === false) {
            re_reject($pdo, $id);
            err('REAL spend could not be verified');
        }
        if ($verdict === true) {
            $total = re_credit($pdo, $id);
            ok(['status' => 'credited', 'quota_bytes' => $quotaBytes, 'new_total' => $total]);
        }
        ok(['status' => 'pending', 'quota_bytes' => $quotaBytes]);
    }

    if ($action === 'redeem-real-spend') {
        // A3: one-tap redeem from the app. The panel orchestrates the debit
        // (contract 4, docs/realgram/TASK_SPLIT.md) instead of requiring a
        // pre-executed spend: quote → server-to-server /v1/spend (idempotent
        // on the client_ref the app generated) → record under the returned
        // tx_ref → credit. The spend response IS the verification, so a
        // successful debit credits immediately; a crashed/retried request
        // reuses the same client_ref and can't debit or credit twice.
        $deviceId  = trim($_POST['device_id'] ?? '');
        $amount    = (float)($_POST['real_amount'] ?? 0);
        $clientRef = trim($_POST['client_ref'] ?? '');
        if (!$deviceId || $clientRef === '' || strlen($clientRef) > 64) err('missing params');
        $pdo = db();
        re_ensure_schema($pdo);
        $q = re_quote($pdo, $deviceId, $amount);
        if (isset($q['error'])) err($q['error']);
        $quotaBytes = $q['quota_bytes'];

        $spend = re_spend($pdo, $q['account'], $amount, 'vpnq-' . $deviceId . '-' . $clientRef);
        if (!$spend['ok']) {
            err($spend['error'] === 'unavailable' ? 'wallet service unavailable' : $spend['error']);
        }
        $id = re_record($pdo, $deviceId, $q['account'], $amount, $quotaBytes, $spend['tx_ref']);
        if ($id === null) {
            // Retry after a crash between spend and credit: the idempotent
            // spend returned the tx_ref we already recorded. Report its state.
            $prev = re_get_by_tx($pdo, $spend['tx_ref']);
            ok(['status'      => $prev['status'] ?? 'pending',
                'quota_bytes' => (int)($prev['quota_bytes'] ?? 0),
                'balance'     => $spend['balance_after'],
                'duplicate'   => true]);
        }
        $total = re_credit($pdo, $id);
        ok(['status'      => 'credited',
            'quota_bytes' => $quotaBytes,
            'new_total'   => $total,
            'balance'     => $spend['balance_after']]);
    }

    if ($action === 'tap-sync') {
        // Contract §8 (2026-07-19, docs/realgram/REALGRAM_UNIFIED_PLATFORM.md
        // §B): server-authoritative ZAR for the tap-to-earn button.
        // Deliberately no realid.enabled-style gate here — unlike sso-token's
        // game=1 opt-in (which had to protect TrustAiLinkScreen's separate
        // behavior), tap-sync is a NEW action nothing else calls, so there's
        // no existing caller to accidentally change.
        $deviceId = trim($_POST['device_id'] ?? '');
        $taps     = (int)($_POST['taps'] ?? 0);
        if (!$deviceId) err('missing device_id');
        if ($taps <= 0) err('missing taps');
        $pdo = db();
        re_ensure_schema($pdo);
        if (!qe_fetch_device($pdo, $deviceId)) err('device not found');
        $result = re_tap_sync($pdo, $deviceId, $taps);
        if (!$result['ok']) err($result['error'] === 'unavailable' ? 'sync unavailable' : $result['error']);
        ok(['zar' => $result['zar'], 'zar_earned' => $result['zar_earned'], 'capped' => $result['capped']]);
    }

    if ($action === 'submit-tunnel-log') {
        $deviceId = trim($_POST['device_id'] ?? '');
        $rawLog   = trim($_POST['log']       ?? '');
        $rawMeta  = trim($_POST['meta']      ?? '');
        $rawCfg   = trim($_POST['config']    ?? '');

        if (!$deviceId || !preg_match('/^[A-Za-z0-9_\-]{4,80}$/', $deviceId)) err('invalid device_id');
        if ($rawLog === '') err('missing log');

        $lines = json_decode($rawLog, true);
        if (!is_array($lines)) err('log must be JSON array');

        // Clamp to 500 lines, 500 chars each.
        $lines = array_slice($lines, 0, 500);
        $lines = array_map(fn($l) => substr((string)$l, 0, 500), $lines);

        $dir  = __DIR__ . '/../data/tunnel-logs';
        if (!is_dir($dir)) err('log dir missing');

        $safe = preg_replace('/[^A-Za-z0-9_\-]/', '', $deviceId);
        $ts   = gmdate('Ymd_His') . '_' . sprintf('%03d', (int)(microtime(true) * 1000) % 1000);
        $base = $dir . '/' . $safe . '_' . $ts;

        // .txt — human-readable log lines
        if (file_put_contents($base . '.txt', implode("\n", $lines) . "\n") === false) err('write failed');

        // .meta.json — structured diagnostic fields
        if ($rawMeta !== '') {
            $meta = json_decode($rawMeta, true);
            if (is_array($meta)) {
                file_put_contents($base . '.meta.json', json_encode($meta, JSON_PRETTY_PRINT) . "\n");
            }
        }

        // .config.json — sanitized xray config (secrets masked by client)
        if ($rawCfg !== '' && strlen($rawCfg) <= 32768) {
            file_put_contents($base . '.config.json', $rawCfg);
        }

        ok(['saved' => $safe . '_' . $ts, 'lines' => count($lines)]);
    }

    // ── push-adsgram-perf ──────────────────────────────────────────────────
    // Server-to-server: Agent B's Shahnameh/bot server pushes daily AdsGram
    // performance stats so the admin panel can compare them against AdMob.
    // Auth: Authorization: Bearer <real_api_key>  (same key as /v1/* endpoints)
    // Body (JSON): { date, active_users, rewarded_views, revenue_usd, ecpm_usd,
    //                fill_rate, gb_granted, avg_watch_time_s }
    if ($action === 'push-adsgram-perf') {
        if ($method !== 'POST') { err('POST required'); }

        $db  = db();
        re_ensure_schema($db);
        $cfg     = re_service_config($db);
        $api_key = trim((string)($cfg['api_key'] ?? ''));
        $auth    = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
        if ($api_key === '' || !hash_equals('Bearer ' . $api_key, $auth)) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'unauthorized']);
            exit;
        }

        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $date = preg_replace('/[^0-9\-]/', '', (string)($body['date'] ?? date('Y-m-d')));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) err('invalid date');

        adp_init_table($db);
        adp_upsert($db, $date, 'adsgram', $body);

        // Mirror into the provider-agnostic model for /admin/monetization. This is
        // one hop removed from AdsGram's own API (relayed through Shahnameh's daily
        // push) — labeled PROVIDER_CALLBACK, not PROVIDER_API. See docs/realgram/
        // MONETIZATION_REPORTING.md for the full source-of-truth explanation.
        try {
            am_daily_metric_upsert($db, [
                'date' => $date, 'provider' => 'adsgram', 'platform' => 'telegram',
                'completions' => (int)($body['rewarded_views'] ?? 0),
                'revenue' => (float)($body['revenue_usd'] ?? 0),
                'currency' => 'USD', 'source_type' => 'PROVIDER_CALLBACK',
            ]);
        } catch (\Exception $e) { /* best-effort mirror — legacy adp_upsert() above is unaffected */ }

        ok(['date' => $date, 'platform' => 'adsgram']);
    }

    // ── push-adsgram-events ──────────────────────────────────────────────────
    // Server-to-server: Shahnameh's `scripts/push_adsgram_events.js` forwards its
    // AdEventLog (ad_event_log Mongo collection) here every 15 minutes, batches
    // of up to 500 unsynced rows. Contract fixed by Agent B, TASK_SPLIT.md
    // B→A(56) — this handler matches that exactly, not a speculative shape.
    // Same auth as push-adsgram-perf. Idempotent on providerTransactionId (the
    // Mongo _id) — a repeat send (their retry-on-anything-but-ok:true design)
    // is a no-op here, never a double reward record. Always returns ok:true for
    // a syntactically valid batch (per-event problems are counted, not fatal) —
    // Shahnameh only distinguishes "whole batch ok" vs "retry everything".
    // Body (JSON): { events: [{ providerTransactionId, account, idType,
    //                 tier, source, status, real, gems, farr, blockId, reason,
    //                 occurredAt }, ...] }
    if ($action === 'push-adsgram-events') {
        if ($method !== 'POST') { err('POST required'); }

        $db  = db();
        re_ensure_schema($db);
        $cfg     = re_service_config($db);
        $api_key = trim((string)($cfg['api_key'] ?? ''));
        $auth    = trim((string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
        if ($api_key === '' || !hash_equals('Bearer ' . $api_key, $auth)) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'unauthorized']);
            exit;
        }

        $body   = json_decode(file_get_contents('php://input'), true) ?: [];
        $events = is_array($body['events'] ?? null) ? $body['events'] : [];
        if (count($events) === 0) err('missing events');
        if (count($events) > 500) $events = array_slice($events, 0, 500); // sanity clamp

        // Transform + insert logic lives in am_ingest_adsgram_event() (lib/
        // ad_monetization.php) so it's unit-tested in isolation — see
        // scripts/test-monetization.php.
        $accepted = 0; $duplicates = 0; $rejected = 0;
        foreach ($events as $ev) {
            try {
                $res = am_ingest_adsgram_event($db, $ev);
                if (!empty($res['rejected'])) $rejected++;
                elseif ($res['duplicate']) $duplicates++;
                else $accepted++;
            } catch (\Exception $e) { $rejected++; }
        }
        ok(['accepted' => $accepted, 'duplicates' => $duplicates, 'rejected' => $rejected]);
    }

    err('unknown action');
}

err('method not allowed');
