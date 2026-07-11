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
const NO_TOKEN_ACTIONS = ['submit-tunnel-log'];

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
        quota_bytes_total  INTEGER DEFAULT 1073741824,
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
            'packages'          => $packages,
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

    if ($action === 'get-transfers') {
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        ok(['transfers' => qe_transfer_history($pdo, $deviceId, 50)]);
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
                     manufacturer, model, sdk_version, android_version, abi, android_id_hash, last_ip, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online')"
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

        $srv = fetch_bootstrap_server($pdo);
        ok([
            'device_id'           => $dev['device_id'],
            'user_id'             => $dev['user_id']        ?? '',
            'referral_code'       => $dev['referral_code'],
            'plan'                => $dev['plan'],
            'quota_bytes_total'   => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'    => (int)$dev['quota_bytes_used'],
            'valid_until'         => $dev['valid_until'],
            'blocked'             => (bool)$dev['blocked'],
            'server'              => $srv,
            'invite_count'        => (int)($dev['invite_count'] ?? 0),
            'active_invite_count' => 0,
            'stealth_unlocked'    => (bool)($dev['stealth_unlocked'] ?? 0),
            'country'             => $dev['country'] ?? '',
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

        if ($riskStatus === 'credited') {
            // Credit both parties through the ledger (keeps the breakdown invariant).
            qe_ledger_add($pdo, $deviceId,            'referral_reward', $bonus, 'referral ' . $refCode);
            qe_ledger_add($pdo, $ownerRow['device_id'], 'referral_reward', $bonus, 'referrer of ' . $deviceId);

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
        ok(['logged' => true]);
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

    err('unknown action');
}

err('method not allowed');
