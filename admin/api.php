<?php
// SetaLink Admin API — AJAX endpoint for the admin dashboard.
// Auth: nginx auth_basic on initial load; subsequent XHR uses session cookie validated here.
// CSRF: HMAC token required for all state-changing POSTs.
declare(strict_types=1);

const CLI          = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE  = '/^[a-z0-9][a-z0-9._-]{0,31}$/';
const VALID_PKGS   = ['7days', '30days', 'unlimited', '10GB', '20GB', '30GB'];

// Shared quota-economy ledger / transfer / milestone / package logic.
require_once __DIR__ . '/../lib/quota_economy.php';
require_once __DIR__ . '/../lib/ads_recovery.php';
require_once __DIR__ . '/../lib/payments.php';
require_once __DIR__ . '/../lib/messaging.php';
require_once __DIR__ . '/../lib/real_economy.php';
require_once __DIR__ . '/../lib/ads_perf.php';
require_once __DIR__ . '/../lib/ad_monetization.php';
require_once __DIR__ . '/../lib/admob_sync.php';
require_once __DIR__ . '/../lib/adsgram_publisher_sync.php';
require_once __DIR__ . '/../lib/calling.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

function api_err(string $msg, int $code = 400): never {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}
function api_ok(mixed $data = null): never {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}
function cli_run(string $action, array $args = [], int $timeout = 0): array {
    $prefix = $timeout > 0 ? 'timeout ' . $timeout . ' ' : '';
    $cmd = $prefix . CLI . ' ' . escapeshellarg($action);
    foreach ($args as $a) $cmd .= ' ' . escapeshellarg($a);
    $cmd .= ' 2>&1';
    exec($cmd, $out, $rc);
    return ['rc' => $rc, 'output' => implode("\n", $out)];
}
function cli_json(string $action, array $args = [], int $timeout = 0): array {
    $r = cli_run($action, $args, $timeout);
    if ($r['rc'] !== 0) return ['_error' => $r['output']];
    $j = json_decode($r['output'], true);
    return is_array($j) ? $j : ['_error' => 'unparseable cli output'];
}
// SEO keyword rank tracking: one row per keyword per measurement date. Lower
// position = better; NULL = not measured / outside top 100.
function seo_ranks_init(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS keyword_ranks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL,
        lang TEXT DEFAULT "fa",
        position REAL,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        source TEXT DEFAULT "manual",
        captured_at TEXT NOT NULL DEFAULT (datetime("now"))
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS kr_kw ON keyword_ranks(keyword, captured_at)');
    // Seed the default target list the first time so the page is never empty.
    $has = (int)$db->query('SELECT COUNT(*) FROM keyword_ranks')->fetchColumn();
    if ($has === 0) seo_ranks_seed($db);
}
// The 10 target search terms (Persian filtershekan intent = Iran's real queries).
// Seeds a marker row (position NULL) per keyword so it shows as tracked before
// any measurement exists. Idempotent — only inserts keywords not already present.
function seo_ranks_seed(PDO $db): int {
    $targets = [
        ['فیلترشکن', 'fa'],
        ['فیلترشکن رایگان', 'fa'],
        ['دانلود فیلترشکن', 'fa'],
        ['فیلترشکن قوی', 'fa'],
        ['فیلترشکن پرسرعت', 'fa'],
        ['بهترین فیلترشکن', 'fa'],
        ['فیلترشکن بدون قطعی', 'fa'],
        ['فیلترشکن اندروید', 'fa'],
        ['فیلترشکن آیفون', 'fa'],
        ['V2Ray ایران', 'fa'],
        // English — Khabat, 2026-07-28: Persian-only so far covered Iran's
        // own search intent; these mirror the same 10-keyword shape (generic
        // / free / download / quality / speed / "best" / reliability /
        // platform / protocol) for the English-language diaspora + general
        // VPN-shopper intent that GSC's setalink.no property also gets
        // impressions for.
        ['VPN for Iran', 'en'],
        ['free VPN for Iran', 'en'],
        ['VPN download', 'en'],
        ['best VPN 2026', 'en'],
        ['fast VPN no disconnect', 'en'],
        ['best VPN for Iran', 'en'],
        ['reliable VPN Iran', 'en'],
        ['VPN Android app', 'en'],
        ['VPN iPhone app', 'en'],
        ['V2Ray VPN client', 'en'],
    ];
    $exists = $db->prepare('SELECT 1 FROM keyword_ranks WHERE keyword=? LIMIT 1');
    $ins = $db->prepare('INSERT INTO keyword_ranks (keyword,lang,position,source) VALUES (?,?,NULL,"seed")');
    $added = 0;
    foreach ($targets as [$kw, $lg]) {
        $exists->execute([$kw]);
        if (!$exists->fetchColumn()) { $ins->execute([$kw, $lg]); $added++; }
    }
    return $added;
}

require_once __DIR__ . '/gsc_sync.php';  // Google Search Console → keyword_ranks
require_once __DIR__ . '/ga4_sync.php';  // Google Analytics (GA4) → dashboard cache

function open_analytics_db(): PDO {
    $db = new PDO('sqlite:' . realpath(__DIR__ . '/../data') . '/analytics.db', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('PRAGMA busy_timeout=3000');
    $db->exec('CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "",
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $db->exec('CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT NOT NULL DEFAULT "unknown",
        network TEXT DEFAULT "",
        server TEXT NOT NULL DEFAULT "",
        port INTEGER NOT NULL DEFAULT 0,
        protocol TEXT NOT NULL DEFAULT "",
        sni TEXT NOT NULL DEFAULT "",
        flow TEXT DEFAULT "",
        fingerprint TEXT DEFAULT "",
        result TEXT NOT NULL DEFAULT "fail",
        error_msg TEXT DEFAULT "",
        tcp_ok INTEGER DEFAULT 0,
        http_ok INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        tested_by TEXT DEFAULT "",
        notes TEXT DEFAULT "",
        recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        device_model TEXT DEFAULT "",
        android_version TEXT DEFAULT "",
        android_sdk INTEGER DEFAULT 0,
        ipv6_enabled INTEGER DEFAULT 0,
        mtu INTEGER DEFAULT 0,
        reconnect_count INTEGER DEFAULT 0,
        no_internet INTEGER DEFAULT 0,
        is_winner INTEGER DEFAULT 0,
        mode TEXT DEFAULT "",
        emergency INTEGER DEFAULT 0,
        fallback_chain TEXT DEFAULT ""
    )');
    $migrations = [
        "ALTER TABLE test_results ADD COLUMN device_model TEXT DEFAULT ''",
        "ALTER TABLE test_results ADD COLUMN android_version TEXT DEFAULT ''",
        "ALTER TABLE test_results ADD COLUMN android_sdk INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN ipv6_enabled INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN mtu INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN reconnect_count INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN no_internet INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN is_winner INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN mode TEXT DEFAULT ''",
        "ALTER TABLE test_results ADD COLUMN emergency INTEGER DEFAULT 0",
        "ALTER TABLE test_results ADD COLUMN fallback_chain TEXT DEFAULT ''",
        "ALTER TABLE test_results ADD COLUMN failure_category TEXT DEFAULT ''",
        "ALTER TABLE test_results ADD COLUMN winning_inbound TEXT DEFAULT ''",
    ];
    foreach ($migrations as $sql) {
        try { $db->exec($sql); } catch (Exception $e) { /* column exists */ }
    }
    return $db;
}

// ── CSRF ──────────────────────────────────────────────────────────────────
function csrf_secret(): string {
    $path = '/etc/setalink/admin/csrf.secret';
    if (is_readable($path)) {
        $s = trim((string)file_get_contents($path));
        if ($s !== '') return $s;
    }
    return hash('sha256', 'setalink-csrf:' . gethostname() . ':' . __DIR__);
}
$csrf_secret = csrf_secret();
$auth_user   = (string)($_SERVER['PHP_AUTH_USER'] ?? $_SERVER['REMOTE_USER'] ?? '');

if (!$auth_user) {
    $sl_cookie = trim((string)($_COOKIE['_sl_session'] ?? ''));
    if ($sl_cookie) {
        $expected = hash_hmac('sha256', 'sl-session:admin', $csrf_secret);
        if (hash_equals($expected, $sl_cookie)) $auth_user = 'admin';
    }
    if (!$auth_user) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Session expired — reload the admin panel.']);
        exit;
    }
}
$csrf_token = hash_hmac('sha256', $auth_user, $csrf_secret);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── Mobile API constants ──────────────────────────────────────────────────
const MOBILE_REPORT_TOKEN  = 'setalink-mobile-diag-v1';
const ONE_GB_BYTES         = 1073741824;
const REFERRAL_BONUS_BYTES = 1073741824;

function init_device_tables(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        referral_code TEXT UNIQUE NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        quota_bytes_total INTEGER NOT NULL DEFAULT 1073741824,
        quota_bytes_used INTEGER NOT NULL DEFAULT 0,
        valid_until TEXT,
        blocked INTEGER NOT NULL DEFAULT 0,
        platform TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        app_version TEXT DEFAULT '',
        active_protocol TEXT DEFAULT '',
        status TEXT DEFAULT 'offline',
        country TEXT DEFAULT '',
        language TEXT DEFAULT ''
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
        "ALTER TABLE devices ADD COLUMN first_country TEXT DEFAULT ''",
        "ALTER TABLE devices ADD COLUMN country_updated_at TEXT DEFAULT ''",
    ];
    foreach ($migrations as $sql) {
        try { $db->exec($sql); } catch (Exception $e) {}
    }
    $db->exec('CREATE TABLE IF NOT EXISTS referral_uses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_device_id TEXT NOT NULL DEFAULT \'\',
        new_device_id TEXT NOT NULL DEFAULT \'\',
        bonus_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        referral_code TEXT DEFAULT \'\',
        used_by TEXT DEFAULT \'\',
        used_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    foreach ([
        "ALTER TABLE referral_uses ADD COLUMN referrer_device_id TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN new_device_id TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN bonus_bytes INTEGER DEFAULT 0",
        "ALTER TABLE referral_uses ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE referral_uses ADD COLUMN referral_code TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN used_by TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN used_at TEXT DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE referral_uses ADD COLUMN referrer_ip TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN new_user_ip TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN risk_score INTEGER DEFAULT 0",
        "ALTER TABLE referral_uses ADD COLUMN risk_flags TEXT DEFAULT ''",
        "ALTER TABLE referral_uses ADD COLUMN status TEXT DEFAULT 'credited'",
        "ALTER TABLE devices ADD COLUMN stealth_unlocked INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN invite_count INTEGER DEFAULT 0",
    ] as $m) { try { $db->exec($m); } catch (Exception $e) {} }
    // Install/update outcome reports from the app (OTA install success/failure).
    $db->exec("CREATE TABLE IF NOT EXISTS install_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT DEFAULT '',
        event TEXT NOT NULL DEFAULT '',
        current_version TEXT DEFAULT '',
        target_version TEXT DEFAULT '',
        device_model TEXT DEFAULT '',
        android_version TEXT DEFAULT '',
        android_sdk INTEGER DEFAULT 0,
        abi TEXT DEFAULT '',
        error TEXT DEFAULT '',
        client_ip TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )");
}
function generate_user_id(int $rowid): string {
    $chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $suffix = '';
    for ($i = 0; $i < 8; $i++) $suffix .= $chars[random_int(0, strlen($chars) - 1)];
    return 'SL-' . $rowid . '-' . $suffix;
}
function ensure_user_id(PDO $db, array &$dev): void {
    if (!empty($dev['user_id'])) return;
    // Fetch the rowid if we don't have it
    $rowid = (int)$db->query("SELECT rowid FROM devices WHERE device_id = " . $db->quote($dev['device_id']))->fetchColumn();
    if (!$rowid) return;
    $uid = generate_user_id($rowid);
    $db->prepare("UPDATE devices SET user_id=? WHERE device_id=?")->execute([$uid, $dev['device_id']]);
    $dev['user_id'] = $uid;
}
function generate_referral_code(PDO $db): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($i = 0; $i < 30; $i++) {
        $code = 'SL-';
        for ($j = 0; $j < 6; $j++) $code .= $chars[random_int(0, strlen($chars) - 1)];
        $st = $db->prepare('SELECT 1 FROM devices WHERE referral_code = ?');
        $st->execute([$code]);
        if (!$st->fetchColumn()) return $code;
    }
    return 'SL-' . strtoupper(substr(md5(uniqid('ref', true)), 0, 6));
}
function fetch_bootstrap_server(PDO $db): array {
    $r = $db->query("SELECT key,value FROM settings WHERE key LIKE 'bootstrap_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
    if (empty($r['bootstrap_uuid']) || empty($r['bootstrap_pubkey'])) {
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
            'city'        => 'RealGram Cloudflare',
            'edgeAddress' => 'edge.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            'altProfiles' => [],
        ];
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
        'city'        => $r['bootstrap_city']    ?? 'RealGram Cloudflare',
        'edgeAddress' => $r['bootstrap_edge_address'] ?? '',
        'edgePort'    => (int)($r['bootstrap_edge_port'] ?? 443),
        'wsPath'      => $r['bootstrap_ws_path']    ?? '/ws',
        'xhttpPath'   => $r['bootstrap_xhttp_path'] ?? '/xhttp/',
        'httpupPath'  => $r['bootstrap_httpup_path'] ?? '/httpup',
        'altProfiles' => [],
    ];
}

// ── Mobile API CORS ───────────────────────────────────────────────────────
// React Native fetch() uses OkHttp (no browser CORS enforcement), but some
// configurations use WebView or a reverse proxy that may enforce CORS.
// Token auth remains the gate — these headers do not weaken security.
if (isset($_GET['mobile']) && $_GET['mobile'] === '1') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    if ($method === 'OPTIONS') { http_response_code(204); exit; }
}

// ── Mobile GET ────────────────────────────────────────────────────────────
if ($method === 'GET' && isset($_GET['mobile']) && $_GET['mobile'] === '1') {
    $tok = (string)($_GET['_token'] ?? '');
    if (!hash_equals(MOBILE_REPORT_TOKEN, $tok)) api_err('invalid token', 403);
    $ma = (string)($_GET['action'] ?? '');

    if ($ma === 'remote-config') {
        $db2  = open_analytics_db();
        $rows2 = $db2->query("SELECT key,value FROM settings")->fetchAll(PDO::FETCH_KEY_PAIR);
        $decode = function(string $key, mixed $def) use ($rows2): mixed {
            if (!isset($rows2[$key])) return $def;
            $v = json_decode($rows2[$key], true);
            return ($v !== null) ? $v : $rows2[$key];
        };
        api_ok([
            'version'        => (int)($rows2['rc_version'] ?? 1),
            'sni_priorities' => $decode('rc_sni_priorities', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'kill_switches'  => $decode('rc_kill_switches', []),
            'protocol_order' => $decode('rc_protocol_order', ['Reality','XHTTP','WebSocket']),
            'emergency_sni'  => (string)($rows2['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order' => $decode('rc_iran_sni_order', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'ttl'            => (int)($rows2['rc_ttl'] ?? 3600),
            'updated_at'     => (string)($rows2['rc_updated_at'] ?? ''),
            'support_url'    => (string)($rows2['support_url'] ?? 'https://t.me/setalink_support'),
            'edge_host'      => (string)($rows2['edge_host'] ?? 'edge.setalink.no'),
        ]);
    }
    if ($ma === 'bootstrap') {
        $db3 = open_analytics_db();
        api_ok(array_merge(['id' => 'server-emergency', 'label' => 'RealGram Edge'], fetch_bootstrap_server($db3)));
    }
    if ($ma === 'sync-entitlement') {
        $device_id = trim((string)($_GET['device_id'] ?? ''));
        if (!$device_id) api_err('device_id required');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if (!$dev) api_err('device not found', 404);
        $db->prepare("UPDATE devices SET last_seen = datetime('now') WHERE device_id = ?")->execute([$device_id]);
        touch_device_ip($db, $device_id);
        ensure_user_id($db, $dev);
        api_ok([
            'device_id'         => $dev['device_id'],
            'user_id'           => $dev['user_id'] ?? '',
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)(int)$dev['blocked'],
            'server'            => fetch_bootstrap_server($db),
        ]);
    }
    api_err('unknown mobile action');
}

// ── Admin → user in-app messages ─────────────────────────────────────────
function init_message_tables(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS admin_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_device_id TEXT NOT NULL DEFAULT "",
        title TEXT NOT NULL DEFAULT "",
        body  TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    $db->exec('CREATE TABLE IF NOT EXISTS admin_message_acks (
        message_id INTEGER NOT NULL,
        device_id  TEXT NOT NULL,
        acked_at   TEXT NOT NULL DEFAULT (datetime(\'now\')),
        PRIMARY KEY (message_id, device_id))');
}

// ── Referral review audit log ────────────────────────────────────────────
// One row per admin approve/reject decision on a held (pending) referral.
function init_referral_audit(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS referral_audit (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        referral_id INTEGER NOT NULL,
        action      TEXT NOT NULL,
        acted_by    TEXT NOT NULL DEFAULT "admin",
        detail      TEXT NOT NULL DEFAULT "",
        acted_at    TEXT NOT NULL DEFAULT (datetime(\'now\')))');
}

// ── Client IP / geo helpers ──────────────────────────────────────────────
// Requests made while the VPN is connected exit xray's freedom outbound on
// this same box, so PHP sees 127.0.0.1. That means "via VPN", not the
// client's address — only a public REMOTE_ADDR identifies the client.
function real_client_ip(): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($ip === '') return '';
    if (filter_var($ip, FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) return '';
    return $ip;
}

// Country for a public IP, cached forever in geo_cache (IP→country rarely
// changes; cache also stores failed lookups as '' to avoid re-querying).
function geo_country(PDO $db, string $ip): array {
    if ($ip === '') return ['', ''];
    $db->exec('CREATE TABLE IF NOT EXISTS geo_cache (
        ip TEXT PRIMARY KEY,
        country TEXT NOT NULL DEFAULT "",
        country_name TEXT NOT NULL DEFAULT "",
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    $st = $db->prepare('SELECT country, country_name FROM geo_cache WHERE ip=?');
    $st->execute([$ip]);
    if ($row = $st->fetch(PDO::FETCH_ASSOC)) return [$row['country'], $row['country_name']];
    $ctx  = stream_context_create(['http' => ['timeout' => 2]]);
    $resp = @file_get_contents('http://ip-api.com/json/' . urlencode($ip)
            . '?fields=status,countryCode,country', false, $ctx);
    $j  = json_decode((string)$resp, true) ?: [];
    $ok = ($j['status'] ?? '') === 'success';
    $cc = $ok ? strtoupper((string)($j['countryCode'] ?? '')) : '';
    $cn = $ok ? (string)($j['country'] ?? '') : '';
    if ($resp !== false) {
        $db->prepare('INSERT OR REPLACE INTO geo_cache (ip,country,country_name) VALUES (?,?,?)')
           ->execute([$ip, $cc, $cn]);
    }
    return [$cc, $cn];
}

// Record the requesting client's real IP and LATEST country. No-op for tunneled
// requests so a real IP is never overwritten by 127.0.0.1. When the IP changes
// we re-geo and overwrite country/country_name (latest-wins); first_country
// keeps the original. Mirrors touch_ip_geo() in public/api.php.
function touch_device_ip(PDO $db, string $device_id): void {
    $ip = real_client_ip();
    if ($ip === '') return;
    $cur = $db->prepare("SELECT last_ip, country FROM devices WHERE device_id=?");
    $cur->execute([$device_id]);
    $row = $cur->fetch(PDO::FETCH_ASSOC) ?: [];
    $hasCountry = ($row['country'] ?? '') !== '';
    $ipChanged  = ($row['last_ip'] ?? null) !== $ip;
    if (!$ipChanged && $hasCountry) return;

    [$cc, $cn] = geo_country($db, $ip);
    if ($cc !== '') {
        $db->prepare(
            "UPDATE devices SET last_ip=?, country=?, country_name=?,
                 first_country=CASE WHEN (first_country='' OR first_country IS NULL) THEN ? ELSE first_country END,
                 country_updated_at=datetime('now')
             WHERE device_id=?")
           ->execute([$ip, $cc, $cn, $cc, $device_id]);
    } else {
        $db->prepare("UPDATE devices SET last_ip=? WHERE device_id=?")->execute([$ip, $device_id]);
    }
}

// Returns the canonical platform for a device row, using hardware markers as
// a fallback so legacy devices that registered before Platform.OS was wired
// up are still displayed correctly without requiring re-registration.
function normalize_platform(array $r): string {
    if (($r['platform'] ?? '') === 'ios') return 'ios';
    $mfr   = strtolower($r['manufacturer'] ?? '');
    $model = strtolower($r['model'] ?? '');
    if ($mfr === 'apple'
        || str_starts_with($model, 'iphone')
        || str_starts_with($model, 'ipad')) return 'ios';
    return 'android';
}

// ── Mobile POST ───────────────────────────────────────────────────────────
if ($method === 'POST' && isset($_GET['mobile']) && $_GET['mobile'] === '1') {
    $tok = (string)($_POST['_token'] ?? $_GET['_token'] ?? '');
    if (!hash_equals(MOBILE_REPORT_TOKEN, $tok)) api_err('invalid token', 403);
    $ma = (string)($_GET['action'] ?? $_POST['action'] ?? '');

    if ($ma === 'register-device') {
        $device_id   = trim((string)($_POST['device_id']    ?? ''));
        $platform    = substr(trim((string)($_POST['platform']    ?? 'android')), 0, 20);
        $app_version = substr(trim((string)($_POST['app_version'] ?? '')), 0, 20);
        $language    = substr(trim((string)($_POST['language']    ?? '')), 0, 30);
        $country     = substr(trim((string)($_POST['country']     ?? '')), 0, 80);
        $manufacturer = substr(trim((string)($_POST['manufacturer']    ?? '')), 0, 60);
        $model        = substr(trim((string)($_POST['model']           ?? '')), 0, 120);
        $sdk_version  = max(0, (int)($_POST['sdk_version'] ?? 0));
        $android_ver  = substr(trim((string)($_POST['android_version'] ?? '')), 0, 20);
        $abi          = substr(trim((string)($_POST['abi']             ?? '')), 0, 80);
        if (!$device_id || strlen($device_id) > 128) api_err('invalid device_id');
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9\-_]{5,126}$/', $device_id)) api_err('invalid device_id format');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if ($dev) {
            $db->prepare("UPDATE devices SET last_seen=datetime('now'),platform=?,app_version=?,language=?,status='online',
                          country=CASE WHEN ?!='' THEN ? ELSE country END,
                          manufacturer=CASE WHEN ?!='' THEN ? ELSE manufacturer END,
                          model=CASE WHEN ?!='' THEN ? ELSE model END,
                          sdk_version=CASE WHEN ?>0 THEN ? ELSE sdk_version END,
                          android_version=CASE WHEN ?!='' THEN ? ELSE android_version END,
                          abi=CASE WHEN ?!='' THEN ? ELSE abi END
                          WHERE device_id=?")
               ->execute([$platform, $app_version, $language, $country, $country,
                          $manufacturer, $manufacturer, $model, $model,
                          $sdk_version, $sdk_version, $android_ver, $android_ver,
                          $abi, $abi, $device_id]);
        } else {
            $ref = generate_referral_code($db);
            $db->prepare("INSERT INTO devices (device_id,referral_code,plan,quota_bytes_total,quota_bytes_used,platform,app_version,language,country,status,manufacturer,model,sdk_version,android_version,abi) VALUES (?,?,'free',?,0,?,?,?,?,'online',?,?,?,?,?)")
               ->execute([$device_id, $ref, ONE_GB_BYTES, $platform, $app_version, $language, $country, $manufacturer, $model, $sdk_version, $android_ver, $abi]);
            // Generate user_id immediately using the new rowid
            $rowid = (int)$db->lastInsertId();
            $uid   = generate_user_id($rowid);
            $db->prepare("UPDATE devices SET user_id=? WHERE device_id=?")->execute([$uid, $device_id]);
            $st->execute([$device_id]);
            $dev = $st->fetch(PDO::FETCH_ASSOC);
        }
        touch_device_ip($db, $device_id);
        ensure_user_id($db, $dev);
        api_ok([
            'device_id'         => $dev['device_id'],
            'user_id'           => $dev['user_id'] ?? '',
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)(int)$dev['blocked'],
            'server'            => fetch_bootstrap_server($db),
        ]);
    }
    if ($ma === 'report-install') {
        // App reports OTA install outcome: after tapping "update", the app
        // persists the target version; on next boot it compares the running
        // build against the target and reports success or failure here.
        $event = trim((string)($_POST['event'] ?? ''));
        if (!in_array($event, ['install_success', 'install_failure', 'download_started'], true)) {
            api_err('invalid event');
        }
        $db = open_analytics_db();
        init_device_tables($db);
        $db->prepare("INSERT INTO install_events (device_id,event,current_version,target_version,device_model,android_version,android_sdk,abi,error,client_ip) VALUES (?,?,?,?,?,?,?,?,?,?)")
           ->execute([
               substr(trim((string)($_POST['device_id']       ?? '')), 0, 128),
               $event,
               substr(trim((string)($_POST['current_version'] ?? '')), 0, 20),
               substr(trim((string)($_POST['target_version']  ?? '')), 0, 20),
               substr(trim((string)($_POST['device_model']    ?? '')), 0, 120),
               substr(trim((string)($_POST['android_version'] ?? '')), 0, 20),
               max(0, (int)($_POST['android_sdk'] ?? 0)),
               substr(trim((string)($_POST['abi']             ?? '')), 0, 80),
               substr(trim((string)($_POST['error']           ?? '')), 0, 300),
               $_SERVER['REMOTE_ADDR'] ?? '',
           ]);
        api_ok(['recorded' => true]);
    }
    if ($ma === 'use-referral') {
        $device_id     = trim((string)($_POST['device_id'] ?? ''));
        $referral_code = strtoupper(trim((string)($_POST['referral_code'] ?? '')));
        if (!$device_id || !$referral_code) api_err('device_id and referral_code required');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE referral_code = ?');
        $st->execute([$referral_code]);
        $referrer = $st->fetch(PDO::FETCH_ASSOC);
        if (!$referrer) api_err('referral code not found', 404);
        if ($referrer['device_id'] === $device_id) api_err('cannot use own referral code');
        $st2 = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st2->execute([$device_id]);
        $new_dev = $st2->fetch(PDO::FETCH_ASSOC);
        if (!$new_dev) api_err('device not found', 404);
        $st3 = $db->prepare('SELECT id FROM referral_uses WHERE new_device_id = ?');
        $st3->execute([$device_id]);
        if ($st3->fetchColumn()) api_err('referral already used');

        // Anti-fraud gate — same policy as the public API (setalink.no/api.php):
        // score ≥75 = HOLD for review, no automatic reward. Without this the
        // admin-host endpoint would be a bypass around the fraud hold.
        $risk_score = 0;
        $risk_flags = [];
        $cli_ip = real_client_ip();
        if ($cli_ip && ($referrer['last_ip'] ?? '') === $cli_ip) {
            $risk_score += 50; $risk_flags[] = 'same_ip';
        }
        if (!empty($referrer['android_id_hash']) && !empty($new_dev['android_id_hash'])
            && $referrer['android_id_hash'] === $new_dev['android_id_hash']) {
            $risk_score += 80; $risk_flags[] = 'same_device';
        }
        $rapid = $db->prepare(
            "SELECT COUNT(*) FROM referral_uses WHERE new_user_ip=? AND new_user_ip!='' AND created_at >= datetime('now','-1 day')");
        $rapid->execute([$cli_ip]);
        if ($cli_ip && (int)$rapid->fetchColumn() >= 2) {
            $risk_score += 30; $risk_flags[] = 'rapid_signup';
        }
        $hold = $risk_score >= 75;
        $ru_status = $hold ? 'pending' : 'credited';

        $db->prepare('INSERT INTO referral_uses
                (referrer_device_id,new_device_id,bonus_bytes,referral_code,used_by,
                 referrer_ip,new_user_ip,risk_score,risk_flags,status)
             VALUES (?,?,?,?,?,?,?,?,?,?)')
           ->execute([$referrer['device_id'], $device_id, REFERRAL_BONUS_BYTES, $referral_code, $device_id,
                      $referrer['last_ip'] ?? '', $cli_ip, $risk_score, json_encode($risk_flags), $ru_status]);

        if ($hold) {
            api_ok(['status' => 'pending_review', 'bonus_bytes' => 0, 'referrer_credited' => false,
                    'new_total_bytes' => (int)$new_dev['quota_bytes_total'],
                    'risk_score' => $risk_score, 'risk_flags' => $risk_flags]);
        }

        $db->prepare('UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?')
           ->execute([REFERRAL_BONUS_BYTES, $referrer['device_id']]);
        $db->prepare('UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?')
           ->execute([REFERRAL_BONUS_BYTES, $device_id]);
        api_ok(['status' => 'approved', 'bonus_bytes' => REFERRAL_BONUS_BYTES, 'referrer_credited' => true,
                'new_total_bytes' => (int)$new_dev['quota_bytes_total'] + REFERRAL_BONUS_BYTES]);
    }
    if ($ma === 'report-usage') {
        $device_id  = trim((string)($_POST['device_id'] ?? ''));
        $bytes_used = max(0, (int)($_POST['bytes_used'] ?? 0));
        if (!$device_id) api_err('device_id required');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if (!$dev) api_err('device not found', 404);
        $new_used = min((int)$dev['quota_bytes_total'], $bytes_used);
        $db->prepare("UPDATE devices SET quota_bytes_used=?,last_seen=datetime('now') WHERE device_id=?")
           ->execute([$new_used, $device_id]);
        api_ok(['quota_bytes_used' => $new_used, 'quota_bytes_total' => (int)$dev['quota_bytes_total'],
                'remaining_bytes' => max(0, (int)$dev['quota_bytes_total'] - $new_used)]);
    }
    if ($ma === 'update-status') {
        $device_id        = trim((string)($_POST['device_id']        ?? ''));
        $status           = trim((string)($_POST['status']           ?? 'offline'));
        $active_protocol  = substr(trim((string)($_POST['active_protocol']  ?? '')), 0, 60);
        $active_sni       = substr(trim((string)($_POST['active_sni']       ?? '')), 0, 120);
        $internet_ok      = isset($_POST['internet_ok'])  ? (int)(bool)$_POST['internet_ok']  : null;
        $dns_ok           = isset($_POST['dns_ok'])       ? (int)(bool)$_POST['dns_ok']       : null;
        $rx_bytes         = isset($_POST['rx_bytes'])     ? max(0, (int)$_POST['rx_bytes'])    : null;
        $tx_bytes         = isset($_POST['tx_bytes'])     ? max(0, (int)$_POST['tx_bytes'])    : null;
        $latency_ms       = isset($_POST['latency_ms'])   ? max(0, (int)$_POST['latency_ms'])  : null;
        $failure_category = substr(trim((string)($_POST['failure_category'] ?? '')), 0, 80);
        if (!$device_id) api_err('device_id required');
        if (!in_array($status, ['online','offline'], true)) $status = 'offline';
        $db = open_analytics_db();
        init_device_tables($db);
        // Build dynamic SET clause — only overwrite optional fields when provided
        $sets   = ["status=?", "active_protocol=?", "last_seen=datetime('now')"];
        $params = [$status, $active_protocol];
        if ($active_sni !== '')       { $sets[] = 'active_sni=?';            $params[] = $active_sni; }
        if ($internet_ok !== null)    { $sets[] = 'internet_ok=?';           $params[] = $internet_ok; }
        if ($dns_ok !== null)         { $sets[] = 'dns_ok=?';                $params[] = $dns_ok; }
        if ($rx_bytes !== null)       { $sets[] = 'rx_bytes=?';              $params[] = $rx_bytes; }
        if ($tx_bytes !== null)       { $sets[] = 'tx_bytes=?';              $params[] = $tx_bytes; }
        if ($latency_ms !== null)     { $sets[] = 'latency_ms=?';            $params[] = $latency_ms; }
        if ($failure_category !== '') {
            $sets[] = 'last_failure_category=?';  $params[] = $failure_category;
            $sets[] = "last_failure_at=datetime('now')";
        }
        $params[] = $device_id;
        $db->prepare("UPDATE devices SET " . implode(',', $sets) . " WHERE device_id=?")
           ->execute($params);
        touch_device_ip($db, $device_id);
        api_ok(['status' => $status]);
    }
    if ($ma === 'report-session') {
        $device_id     = trim((string)($_POST['device_id']     ?? ''));
        $protocol      = substr(trim((string)($_POST['protocol']  ?? '')), 0, 60);
        $bytes_sent    = max(0, (int)($_POST['bytes_sent']    ?? 0));
        $bytes_recv    = max(0, (int)($_POST['bytes_recv']    ?? 0));
        $duration_secs = max(1, (int)($_POST['duration_secs'] ?? 1));
        $app_version   = substr(trim((string)($_POST['app_version'] ?? '')), 0, 20);
        $probe_result  = in_array($_POST['probe_result'] ?? '', ['ok','fail','unknown'], true)
                         ? (string)$_POST['probe_result'] : 'unknown';
        $error_reason  = substr(trim((string)($_POST['error_reason'] ?? '')), 0, 255);
        if (!$device_id) api_err('device_id required');
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS vpn_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT, protocol TEXT,
            bytes_sent INTEGER DEFAULT 0, bytes_recv INTEGER DEFAULT 0,
            duration_secs INTEGER DEFAULT 0, app_version TEXT DEFAULT '',
            probe_result TEXT DEFAULT 'unknown', error_reason TEXT DEFAULT '',
            started_at TEXT, ended_at TEXT DEFAULT (datetime('now')), client_ip TEXT DEFAULT ''
        )");
        $migrations_sess = [
            "ALTER TABLE vpn_sessions ADD COLUMN probe_result TEXT DEFAULT 'unknown'",
            "ALTER TABLE vpn_sessions ADD COLUMN error_reason TEXT DEFAULT ''",
        ];
        foreach ($migrations_sess as $sql) { try { $db->exec($sql); } catch (Exception $e) {} }
        $db->prepare("INSERT INTO vpn_sessions (device_id,protocol,bytes_sent,bytes_recv,duration_secs,app_version,probe_result,error_reason,started_at,ended_at,client_ip) VALUES (?,?,?,?,?,?,?,?,datetime('now',? || ' seconds'),datetime('now'),?)")
           ->execute([$device_id,$protocol,$bytes_sent,$bytes_recv,$duration_secs,$app_version,$probe_result,$error_reason,'-'.$duration_secs,$_SERVER['REMOTE_ADDR']??'']);
        $total = $bytes_sent + $bytes_recv;
        if ($total > 0) {
            $db->prepare("UPDATE devices SET quota_bytes_used=quota_bytes_used+?,last_seen=datetime('now') WHERE device_id=?")
               ->execute([$total, $device_id]);
        }
        touch_device_ip($db, $device_id);
        api_ok(['recorded' => true]);
    }
    // Mobile telemetry
    $allowed_results = ['success','fail','partial','tcp_only'];
    $country     = substr(trim((string)($_POST['country']     ?? 'unknown')), 0, 80);
    $network     = substr(trim((string)($_POST['network']     ?? 'unknown')), 0, 80);
    $server      = substr(trim((string)($_POST['server']      ?? '')), 0, 120);
    $port        = max(1, min(65535, (int)($_POST['port']     ?? 0)));
    $protocol    = substr(trim((string)($_POST['protocol']    ?? 'VLESS+Reality')), 0, 60);
    $sni         = substr(trim((string)($_POST['sni']         ?? '')), 0, 120);
    $flow        = substr(trim((string)($_POST['flow']        ?? '')), 0, 60);
    $fingerprint = substr(trim((string)($_POST['fingerprint'] ?? '')), 0, 60);
    $result      = (string)($_POST['result'] ?? 'fail');
    $error_msg   = substr(trim((string)($_POST['error_msg']   ?? '')), 0, 500);
    $tcp_ok      = (int)(bool)($_POST['tcp_ok']   ?? 0);
    $http_ok     = (int)(bool)($_POST['http_ok']  ?? 0);
    $latency_ms  = max(0, (int)($_POST['latency_ms']  ?? 0));
    $tested_by   = substr(trim((string)($_POST['tested_by']   ?? 'mobile')), 0, 60);
    $notes       = substr(trim((string)($_POST['notes']       ?? '')), 0, 500);
    $device_model  = substr(trim((string)($_POST['device_model']    ?? '')), 0, 120);
    $android_ver   = substr(trim((string)($_POST['android_version'] ?? '')), 0, 20);
    $android_sdk   = max(0, (int)($_POST['android_sdk']      ?? 0));
    $ipv6_enabled  = (int)(bool)($_POST['ipv6_enabled']      ?? 0);
    $mtu           = max(0, (int)($_POST['mtu']               ?? 0));
    $reconnect_cnt = max(0, (int)($_POST['reconnect_count']   ?? 0));
    $no_internet   = (int)(bool)($_POST['no_internet']        ?? 0);
    $is_winner     = (int)(bool)($_POST['is_winner']          ?? 0);
    $mode          = substr(trim((string)($_POST['mode']       ?? '')), 0, 20);
    $emergency     = (int)(bool)($_POST['emergency']          ?? 0);
    $fallback_chain    = substr(trim((string)($_POST['fallback_chain']    ?? '')), 0, 500);
    $failure_category  = substr(trim((string)($_POST['failure_category']  ?? '')), 0, 80);
    $winning_inbound   = substr(trim((string)($_POST['winning_inbound']   ?? '')), 0, 40);
    if (!in_array($result, $allowed_results, true)) $result = 'fail';
    if (!$server) api_err('server required');
    $db = open_analytics_db();
    $st = $db->prepare('INSERT INTO test_results
        (country,network,server,port,protocol,sni,flow,fingerprint,result,error_msg,
         tcp_ok,http_ok,latency_ms,tested_by,notes,
         device_model,android_version,android_sdk,ipv6_enabled,mtu,
         reconnect_count,no_internet,is_winner,mode,emergency,fallback_chain,failure_category,winning_inbound)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $st->execute([$country,$network,$server,$port,$protocol,$sni,$flow,$fingerprint,$result,$error_msg,
                  $tcp_ok,$http_ok,$latency_ms,$tested_by,$notes,
                  $device_model,$android_ver,$android_sdk,$ipv6_enabled,$mtu,
                  $reconnect_cnt,$no_internet,$is_winner,$mode,$emergency,$fallback_chain,$failure_category,$winning_inbound]);
    api_ok(['id' => (int)$db->lastInsertId()]);
}

// ── Admin POST (state-changing) ───────────────────────────────────────────
if ($method === 'POST') {
    $body   = (string)file_get_contents('php://input');
    $parsed = json_decode($body, true);
    if (!is_array($parsed)) api_err('invalid JSON body');
    $sent = (string)($parsed['_csrf'] ?? '');
    if (!hash_equals($csrf_token, $sent)) api_err('csrf token mismatch', 403);
    $action = (string)($parsed['action'] ?? '');
    $name   = trim((string)($parsed['name'] ?? ''));
    $pkg    = trim((string)($parsed['package'] ?? ''));

    if ($action === 'device-block' || $action === 'device-unblock') {
        $did   = trim((string)($parsed['device_id'] ?? ''));
        if (!$did) api_err('device_id required');
        $block = $action === 'device-block' ? 1 : 0;
        $db    = open_analytics_db();
        init_device_tables($db);
        $db->prepare("UPDATE devices SET blocked=? WHERE device_id=?")->execute([$block, $did]);
        api_ok(['blocked' => (bool)$block]);
    }
    // Permanent device removal — for inert registrations (Apple/Google review
    // installs that open the app but never connect). Refuses real devices
    // (any vpn_session or non-zero quota_bytes_used) unless force=true is
    // explicitly sent, so this can't accidentally wipe an active user.
    // Accepts either a single device_id or a device_ids array for batch
    // cleanup (App Review devices recur in batches every re-review).
    if ($action === 'device-delete') {
        $ids = [];
        if (!empty($parsed['device_ids']) && is_array($parsed['device_ids'])) {
            $ids = array_values(array_filter(array_map('strval', $parsed['device_ids'])));
        } elseif (!empty($parsed['device_id'])) {
            $ids = [(string)$parsed['device_id']];
        }
        if (!$ids) api_err('device_id or device_ids required');
        $force = !empty($parsed['force']);
        $db = open_analytics_db();
        init_device_tables($db);

        $ph = implode(',', array_fill(0, count($ids), '?'));
        // Same session_count proxy the devices-list view uses for the
        // apple_review classification (COUNT from vpn_sessions).
        $st = $db->prepare("SELECT d.device_id, d.quota_bytes_used,
                                    COALESCE(s.session_count,0) AS session_count
                             FROM devices d
                             LEFT JOIN (SELECT device_id, COUNT(*) AS session_count
                                        FROM vpn_sessions GROUP BY device_id) s
                                    ON s.device_id = d.device_id
                             WHERE d.device_id IN ($ph)");
        $st->execute($ids);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);

        $found  = array_column($rows, 'device_id');
        $notFound = array_values(array_diff($ids, $found));
        $blocked  = [];
        $toDelete = [];
        foreach ($rows as $r) {
            $hasActivity = ((int)$r['session_count'] > 0) || ((int)$r['quota_bytes_used'] > 0);
            if ($hasActivity && !$force) {
                $blocked[] = $r['device_id'];
            } else {
                $toDelete[] = $r['device_id'];
            }
        }

        $deleted = [];
        if ($toDelete) {
            $ph2 = implode(',', array_fill(0, count($toDelete), '?'));
            $db->prepare("DELETE FROM devices WHERE device_id IN ($ph2)")->execute($toDelete);
            // node_usage has no bytes/session data, just per-node touch counts --
            // harmless to cascade-clean so it doesn't accumulate orphaned rows.
            $db->prepare("DELETE FROM node_usage WHERE device_id IN ($ph2)")->execute($toDelete);
            $deleted = $toDelete;
        }
        api_ok([
            'deleted'   => $deleted,
            'blocked'   => $blocked,   // had real activity, needs force=true
            'not_found' => $notFound,
        ]);
    }
    // Multi-node test allowlist — grant/revoke a device access to a test node
    // (e.g. node_id="fi-hel" for Helsinki). Does NOT route anyone automatically.
    if ($action === 'node-allowlist-add' || $action === 'node-allowlist-remove') {
        $did = trim((string)($parsed['device_id'] ?? ''));
        $nid = trim((string)($parsed['node_id'] ?? ''));
        if (!$did || !$nid) api_err('device_id and node_id required');
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS node_allowlist (device_id TEXT, node_id TEXT, added_at TEXT, PRIMARY KEY(device_id,node_id))");
        if ($action === 'node-allowlist-add') {
            $db->prepare("INSERT OR IGNORE INTO node_allowlist (device_id,node_id,added_at) VALUES (?,?,?)")
               ->execute([$did, $nid, gmdate('c')]);
            api_ok(['allowed' => true, 'device_id' => $did, 'node_id' => $nid]);
        } else {
            $db->prepare("DELETE FROM node_allowlist WHERE device_id=? AND node_id=?")->execute([$did, $nid]);
            api_ok(['allowed' => false, 'device_id' => $did, 'node_id' => $nid]);
        }
    }
    // Starlink exit-node admin controls (Phase 1 — single test node, disabled
    // by default). Every mutation is logged to starlink_admin_log for audit
    // (docs/CLAUDE_REALINK_RULES.md Rule 3: admin visibility for new network
    // features). Device allowlisting reuses node-allowlist-add/remove above —
    // a Starlink node is just another node_id there.
    if (in_array($action, [
        'starlink-toggle-enabled', 'starlink-set-maintenance', 'starlink-force-fallback',
        'starlink-generate-token', 'starlink-update-node',
    ], true)) {
        require_once __DIR__ . '/../lib/starlink.php';
        $db  = open_analytics_db();
        st_init_tables($db);
        $nid = trim((string)($parsed['node_id'] ?? 'starlink-no-01'));
        $node = st_get($db, $nid);
        if (!$node) api_err('unknown starlink node', 404);

        if ($action === 'starlink-toggle-enabled') {
            $enabled = !empty($parsed['enabled']) ? 1 : 0;
            $db->prepare("UPDATE starlink_nodes SET enabled=?, updated_at=datetime('now') WHERE node_id=?")
               ->execute([$enabled, $nid]);
            st_log($db, $nid, $auth_user, $enabled ? 'enable' : 'disable');
            api_ok(['node_id' => $nid, 'enabled' => (bool)$enabled]);
        }
        if ($action === 'starlink-set-maintenance') {
            $maint = !empty($parsed['maintenance']) ? 1 : 0;
            $db->prepare("UPDATE starlink_nodes SET maintenance_mode=?, updated_at=datetime('now') WHERE node_id=?")
               ->execute([$maint, $nid]);
            st_log($db, $nid, $auth_user, $maint ? 'maintenance-on' : 'maintenance-off');
            api_ok(['node_id' => $nid, 'maintenance_mode' => (bool)$maint]);
        }
        if ($action === 'starlink-force-fallback') {
            // Stop routing new sessions here immediately without removing the
            // node from the catalog — marks the tunnel down so health policy
            // (st_health_state) reports OFFLINE until the next real heartbeat.
            $db->prepare("UPDATE starlink_nodes SET tunnel_status='down', last_error=?, updated_at=datetime('now') WHERE node_id=?")
               ->execute(['forced fallback by admin', $nid]);
            st_log($db, $nid, $auth_user, 'force-fallback');
            api_ok(['node_id' => $nid, 'forced' => true]);
        }
        if ($action === 'starlink-generate-token') {
            // Returned ONCE in plaintext — only the hash is persisted. The
            // admin must copy it into the gateway's heartbeat script now.
            $secret = st_generate_heartbeat_token($db, $nid);
            st_log($db, $nid, $auth_user, 'rotate-heartbeat-token');
            api_ok(['node_id' => $nid, 'heartbeat_token' => "starlink-node-{$nid}:{$secret}"]);
        }
        if ($action === 'starlink-windows-installer') {
            // Generate a new heartbeat token + return a self-installing
            // PowerShell setup script the admin runs once on the Windows gateway.
            // The script installs heartbeat.ps1 to C:\ProgramData\SetalinkGateway\
            // and registers it in Task Scheduler to run every 60 seconds.
            $secret    = st_generate_heartbeat_token($db, $nid);
            $bearerTok = "starlink-node-{$nid}:{$secret}";
            st_log($db, $nid, $auth_user, 'windows-installer-generated');
            $ps1 = <<<PS1
# =========================================================
# Setalink Gateway — Windows setup script
# Node: {$nid}  ({$node['display_name']})
# Generated: {$node['country']} · auto-installs heartbeat
# Run as Administrator in PowerShell
# =========================================================
\$ErrorActionPreference = 'Stop'
\$GatewayDir  = 'C:\\ProgramData\\SetalinkGateway'
\$HeartbeatPs = Join-Path \$GatewayDir 'heartbeat.ps1'
\$LogFile     = Join-Path \$GatewayDir 'heartbeat.log'
\$TaskName    = 'SetalinkHeartbeat'
\$HbUrl       = 'https://setalink.no/starlink-heartbeat.php'
\$Bearer      = '{$bearerTok}'
\$NodeId      = '{$nid}'
\$Version     = 'phase1-win-' + (Get-Date -Format 'yyyyMMdd')

if (-not (Test-Path \$GatewayDir)) { New-Item -ItemType Directory -Path \$GatewayDir -Force | Out-Null }

# ── Write heartbeat.ps1 ──────────────────────────────────
\$heartbeatScript = @'
param()
\$HbUrl  = '!!HB_URL!!'
\$Bearer = '!!BEARER!!'
\$NodeId = '!!NODE_ID!!'
\$LogFile = '!!LOG_FILE!!'
\$Version = '!!VERSION!!'

function Log(\$msg) {
    \$line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), \$msg
    Add-Content -Path \$LogFile -Value \$line -ErrorAction SilentlyContinue
    if ((Get-Item \$LogFile -ErrorAction SilentlyContinue).Length -gt 2MB) {
        \$tmp = \$LogFile + '.old'
        Move-Item \$LogFile \$tmp -Force -ErrorAction SilentlyContinue
    }
}

function Get-WgStatus {
    try {
        \$out = & wg show 2>&1
        if (\$LASTEXITCODE -eq 0 -and \$out -match 'interface') { return 'up' }
    } catch {}
    return 'down'
}

function Get-ExitIp {
    try { return (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 5) } catch { return \$null }
}

function Get-Latency {
    try {
        \$p = Test-Connection -ComputerName 'setalink.no' -Count 4 -ErrorAction Stop
        return [int](\$p | Measure-Object -Property ResponseTime -Average).Average
    } catch { return \$null }
}

function Get-UptimeSecs {
    return [int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds
}

\$tunnelStatus = Get-WgStatus
\$exitIp       = Get-ExitIp
\$latencyMs    = Get-Latency
\$uptimeSecs   = Get-UptimeSecs

\$body = @{
    tunnel_status      = \$tunnelStatus
    exit_ip            = \$exitIp
    latency_ms         = \$latencyMs
    uptime_secs        = \$uptimeSecs
    software_version   = \$Version
    recent_disconnects = 0
    packet_loss_pct    = 0.0
    current_sessions   = 0
} | ConvertTo-Json

try {
    \$resp = Invoke-RestMethod -Uri \$HbUrl -Method POST -Body \$body -ContentType 'application/json' `
        -Headers @{ Authorization = "Bearer \$Bearer" } -TimeoutSec 10
    Log "hb ok: tunnel=\$tunnelStatus exit=\$exitIp lat=\$latencyMs ms health=\$(\$resp.health_state)"
} catch {
    Log "hb fail: \$_"
}
'@

\$heartbeatScript = \$heartbeatScript `
    -replace '!!HB_URL!!',   \$HbUrl `
    -replace '!!BEARER!!',   \$Bearer `
    -replace '!!NODE_ID!!',  \$NodeId `
    -replace '!!LOG_FILE!!', \$LogFile.Replace('\','\\\\') `
    -replace '!!VERSION!!',  \$Version

Set-Content -Path \$HeartbeatPs -Value \$heartbeatScript -Encoding UTF8
Write-Host "Wrote: \$HeartbeatPs"

# ── Register Task Scheduler task ────────────────────────
\$trigger  = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Seconds 60) -Once -At (Get-Date)
\$action   = New-ScheduledTaskAction  -Execute 'powershell.exe' `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"\$HeartbeatPs`""
\$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
\$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Unregister-ScheduledTask -TaskName \$TaskName -Confirm:\$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName \$TaskName -Trigger \$trigger -Action \$action `
    -Settings \$settings -Principal \$principal -Description "Setalink Starlink gateway heartbeat"
Write-Host "Task registered: \$TaskName"

# ── Run immediately to verify ───────────────────────────
Start-ScheduledTask -TaskName \$TaskName
Write-Host "Setup complete. Check log: \$LogFile"
PS1;
            api_ok(['node_id' => $nid, 'installer_ps1' => $ps1, 'filename' => "setalink-gateway-setup-{$nid}.ps1"]);
        }
        if ($action === 'starlink-update-node') {
            $displayName = trim((string)($parsed['display_name']  ?? $node['display_name']));
            $uuid        = trim((string)($parsed['vless_uuid']    ?? $node['vless_uuid']));
            $maxSessions = max(0, (int)($parsed['max_sessions']   ?? $node['max_sessions']));
            $allocKbps   = max(0, (int)($parsed['allocated_kbps'] ?? $node['allocated_kbps']));
            $db->prepare("UPDATE starlink_nodes SET display_name=?, vless_uuid=?, max_sessions=?, allocated_kbps=?, updated_at=datetime('now') WHERE node_id=?")
               ->execute([$displayName, $uuid, $maxSessions, $allocKbps, $nid]);
            st_log($db, $nid, $auth_user, 'update-config');
            api_ok(['node_id' => $nid]);
        }
    }
    // The VPS-side WireGuard peer info handed back by starlink-enroll.php —
    // same settings-table convention as real_link_secret/real_api_key
    // (INSERT OR REPLACE), not a new config mechanism. Set this once the
    // rendezvous point is stable; re-run it if the rendezvous ever moves
    // again (it already has once — see docs/STARLINK_WINDOWS_HANDOFF.md §13).
    if ($action === 'starlink-set-wg-peer') {
        $db = open_analytics_db();
        $endpoint  = trim((string)($parsed['wg_endpoint']    ?? ''));
        $publicKey = trim((string)($parsed['wg_public_key']  ?? ''));
        if ($endpoint === '' || $publicKey === '') api_err('wg_endpoint and wg_public_key both required', 400);
        $st = $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))");
        $st->execute(['starlink_wg_endpoint', $endpoint]);
        $st->execute(['starlink_wg_public_key', $publicKey]);
        require_once __DIR__ . '/../lib/starlink.php';
        st_log($db, '(settings)', $auth_user, 'set-wg-peer', "endpoint={$endpoint}");
        api_ok(['wg_endpoint' => $endpoint, 'wg_public_key' => $publicKey]);
    }
    // Phase 2: self-registration. Separate from the block above because this
    // action runs BEFORE a node_id exists — it's what creates one. Manual
    // provisioning (the block above) still works unchanged; this is an
    // additional path for a brand-new gateway device.
    if ($action === 'starlink-create-enrollment-token') {
        require_once __DIR__ . '/../lib/starlink.php';
        $db = open_analytics_db();
        st_init_tables($db);
        $displayName = trim((string)($parsed['display_name'] ?? ''));
        $country     = trim((string)($parsed['country'] ?? '')) ?: 'Norway';
        // Shown ONCE in plaintext, same convention as starlink-generate-token
        // above — only its SHA-256 is persisted (see st_create_enrollment_token()
        // for why this is a fast hash, unlike the heartbeat token).
        $token = st_create_enrollment_token($db, $auth_user, $displayName, $country);
        api_ok([
            'enrollment_token' => $token,
            'expires_in'       => STARLINK_ENROLLMENT_TTL_SECS,
        ]);
    }
    if ($action === 'send-message') {
        // In-app message to one device ('' target = broadcast to all).
        // No real push transport exists (no FCM): clients poll get-messages
        // at launch and on the 10-min connected heartbeat (app ≥ next release).
        $target = trim((string)($parsed['device_id'] ?? ''));
        $title  = substr(trim((string)($parsed['title'] ?? '')), 0, 120);
        $msg    = substr(trim((string)($parsed['body_text'] ?? '')), 0, 1000);
        if ($msg === '') api_err('message body required');
        $db = open_analytics_db();
        init_message_tables($db);
        if ($target !== '') {
            $chk = $db->prepare('SELECT 1 FROM devices WHERE device_id=?');
            $chk->execute([$target]);
            if (!$chk->fetchColumn()) api_err('device not found', 404);
        }
        $db->prepare('INSERT INTO admin_messages (target_device_id,title,body) VALUES (?,?,?)')
           ->execute([$target, $title, $msg]);
        api_ok(['id' => (int)$db->lastInsertId(), 'target' => $target ?: 'all']);
    }
    if ($action === 'user-messages-stats') {
        // User-to-user messaging overview (v0.9.33): counts + delivery status
        // only. dm_admin_stats() never selects the (encrypted) body, so message
        // content can never surface in the admin panel.
        $db = open_analytics_db();
        api_ok(dm_admin_stats($db, 50));
    }
    if ($action === 'device-set-quota') {
        $did   = trim((string)($parsed['device_id'] ?? ''));
        $quota = max(0, (int)($parsed['quota_bytes'] ?? ONE_GB_BYTES));
        if (!$did) api_err('device_id required');
        $db = open_analytics_db();
        init_device_tables($db);
        qe_init_tables($db);
        $db->prepare("UPDATE devices SET quota_bytes_total=? WHERE device_id=?")->execute([$quota, $did]);
        // Keep the ledger invariant after a direct quota write.
        try { qe_reconcile($db, $did, 'admin set-quota'); } catch (Exception $e) {}
        api_ok(['quota_bytes_total' => $quota]);
    }

    if ($action === 'device-set-test-mode') {
        // Marks a device as a TEST account, orthogonal to `plan` (Khabat,
        // 2026-07-16): a premium tester keeps unlimited quota but test-gated
        // functionality treats her like a tester — ads stay visible during a
        // test period (client-side, once ad gating reads test_mode) and
        // Starlink nodes auto-allow (v1_device_allowed()). Deliberately NOT a
        // plan downgrade — that would also cost the device its quota.
        $did  = trim((string)($parsed['device_id'] ?? ''));
        $mode = (int)($parsed['test_mode'] ?? 0) === 1 ? 1 : 0;
        if (!$did) api_err('device_id required');
        $db = open_analytics_db();
        init_device_tables($db);
        try { $db->exec("ALTER TABLE devices ADD COLUMN test_mode INTEGER DEFAULT 0"); } catch (Exception $e) {}
        $st = $db->prepare("UPDATE devices SET test_mode=? WHERE device_id=?");
        $st->execute([$mode, $did]);
        if ($st->rowCount() === 0) api_err('device not found', 404);
        api_ok(['device_id' => $did, 'test_mode' => $mode === 1]);
    }

    if ($action === 'credit-package') {
        // Manually credit a data package to a device (no payment gateway).
        // Additive — records purchased_packages + a 'purchase' ledger entry.
        $did   = trim((string)($parsed['device_id'] ?? ''));
        $name  = substr(trim((string)($parsed['package_name'] ?? '')), 0, 80);
        $bytes = (int)($parsed['bytes'] ?? 0);
        $ref   = substr(trim((string)($parsed['payment_reference'] ?? '')), 0, 120);
        if (!$did)         api_err('device_id required');
        if ($name === '')  api_err('package_name required');
        if ($bytes <= 0)   api_err('bytes must be positive');
        $db = open_analytics_db();
        init_device_tables($db);
        qe_init_tables($db);
        try { $total = qe_credit_purchase($db, $did, $name, $bytes, $ref); }
        catch (Exception $e) { api_err($e->getMessage()); }
        api_ok(['device_id' => $did, 'quota_bytes_total' => $total]);
    }

    if ($action === 'transfer-reverse') {
        // Admin review tool: claw back a completed quota transfer.
        $tid = (int)($parsed['transfer_id'] ?? 0);
        if (!$tid) api_err('transfer_id required');
        $db = open_analytics_db();
        qe_init_tables($db);
        try { $res = qe_reverse_transfer($db, $tid, 'reversed by ' . $auth_user); }
        catch (Exception $e) { api_err($e->getMessage()); }
        api_ok($res);
    }

    if ($action === 'transfer-flag') {
        // Admin review tool: flag a transfer for review (does not move quota).
        $tid  = (int)($parsed['transfer_id'] ?? 0);
        $note = substr(trim((string)($parsed['note'] ?? '')), 0, 200);
        if (!$tid) api_err('transfer_id required');
        $db = open_analytics_db();
        qe_init_tables($db);
        $db->prepare("UPDATE quota_transfer SET status='flagged', metadata=? WHERE id=? AND status='completed'")
           ->execute(['flagged by ' . $auth_user . ($note ? ': ' . $note : ''), $tid]);
        api_ok(['transfer_id' => $tid, 'status' => 'flagged']);
    }
    if ($action === 'save-bundle') {
        $allowed = ['bundle_sni_candidates','bundle_spoof_snis','bundle_backup_ips','bundle_backup_domains'];
        $db = open_analytics_db();
        $st = $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        foreach ($allowed as $k) {
            if (array_key_exists($k, $parsed)) {
                $v = $parsed[$k];
                $st->execute([$k, is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string)$v]);
            }
        }
        $st->execute(['bundle_version', (string)((int)($db->query("SELECT COALESCE(value,'0') FROM settings WHERE key='bundle_version'")->fetchColumn()) + 1)]);
        $st->execute(['bundle_published_at', date('Y-m-d')]);
        api_ok(['saved' => true]);
    }
    if ($action === 'payment-approve' || $action === 'payment-reject') {
        $pid  = (int)($parsed['payment_id'] ?? 0);
        $note = substr(trim((string)($parsed['note'] ?? '')), 0, 255);
        if (!$pid) api_err('payment_id required');
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS payment_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL, user_id TEXT DEFAULT '',
            memo TEXT DEFAULT '', package TEXT NOT NULL DEFAULT '30days',
            amount_usdt REAL DEFAULT 0, tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '', note TEXT DEFAULT ''
        )");
        try { $db->exec("ALTER TABLE payment_queue ADD COLUMN user_id TEXT DEFAULT ''"); } catch (Exception $e) {}
        $stmt = $db->prepare("SELECT * FROM payment_queue WHERE id=?");
        $stmt->execute([$pid]);
        $pay = $stmt->fetch();
        if (!$pay) api_err('payment not found');
        if ($pay['status'] !== 'pending') api_err('payment already reviewed');
        $new_status = $action === 'payment-approve' ? 'approved' : 'rejected';
        $db->prepare("UPDATE payment_queue SET status=?,reviewed_at=datetime('now'),reviewed_by=?,note=? WHERE id=?")
           ->execute([$new_status, $auth_user, $note, $pid]);
        if ($action === 'payment-approve') {
            $pkg_map = [
                '7days'     => ['plan' => 'premium', 'days' => 7,   'bytes' => 10737418240],
                '30days'    => ['plan' => 'premium', 'days' => 30,  'bytes' => 32212254720],
                'unlimited' => ['plan' => 'premium', 'days' => 365, 'bytes' => 1099511627776],
                '10GB'      => ['plan' => 'premium', 'days' => 30,  'bytes' => 10737418240],
                '20GB'      => ['plan' => 'premium', 'days' => 30,  'bytes' => 21474836480],
                '30GB'      => ['plan' => 'premium', 'days' => 30,  'bytes' => 32212254720],
            ];
            $conf = $pkg_map[$pay['package']] ?? $pkg_map['30days'];
            qe_init_tables($db);
            $payRef = ($pay['tx_hash'] ?? '') ?: ('payment#' . $pid);
            if (in_array($pay['package'], ['10GB', '20GB', '30GB'], true)) {
                // Additive data package — credit through the ledger, record the
                // purchased package, keep the device on its current plan.
                try { qe_credit_purchase($db, $pay['device_id'], $pay['package'], (int)$conf['bytes'], $payRef); }
                catch (Exception $e) {}
            } else {
                // Time-based subscription — replace quota + set premium plan, then
                // reconcile the ledger so the breakdown invariant holds, and record
                // the purchase for the packages list.
                $valid_until = date('Y-m-d H:i:s', strtotime('+' . $conf['days'] . ' days'));
                $db->prepare("UPDATE devices SET plan=?,quota_bytes_total=?,quota_bytes_used=0,valid_until=? WHERE device_id=?")
                   ->execute([$conf['plan'], $conf['bytes'], $valid_until, $pay['device_id']]);
                try {
                    $db->prepare("INSERT INTO purchased_packages (device_id, package_name, bytes, payment_reference) VALUES (?,?,?,?)")
                       ->execute([$pay['device_id'], $pay['package'], (int)$conf['bytes'], $payRef]);
                    qe_reconcile($db, $pay['device_id'], 'subscription ' . $pay['package']);
                } catch (Exception $e) {}
            }
        }
        api_ok(['status' => $new_status, 'payment_id' => $pid]);
    }
    if ($action === 'real-redemption-approve' || $action === 'real-redemption-reject') {
        // A2 manual-review path: redemptions the ecosystem backend couldn't
        // verify automatically stay 'pending' until reviewed here. Approve
        // credits quota through re_credit (ledger row + guarded pending→credited
        // transition), so a double click / concurrent review can't credit twice.
        $rid = (int)($parsed['redemption_id'] ?? 0);
        if (!$rid) api_err('redemption_id required');
        $db = open_analytics_db();
        re_ensure_schema($db);
        $row = re_get($db, $rid);
        if (!$row) api_err('redemption not found');
        $isGrant = ($row['kind'] ?? 'redeem') === 'referral_grant';
        if ($action === 'real-redemption-approve') {
            if ($isGrant) {
                // Referral grant (C3) pays REAL — retry the ecosystem grant,
                // never credit VPN quota. Stays pending if the backend is down.
                $st = re_approve_grant($db, $rid);
                if ($st === null)       api_err('grant not found or already reviewed');
                if ($st === 'rejected') api_err('ecosystem backend rejected the grant');
                api_ok(['status' => $st, 'redemption_id' => $rid, 'kind' => 'referral_grant']);
            }
            $total = re_credit($db, $rid);
            if ($total === null) api_err('redemption not found or already reviewed');
            api_ok(['status' => 'credited', 'redemption_id' => $rid, 'new_total' => $total]);
        }
        if (!re_reject($db, $rid)) api_err('redemption not found or already reviewed');
        api_ok(['status' => 'rejected', 'redemption_id' => $rid]);
    }
    if ($action === 'payment-submit') {
        $did  = trim((string)($parsed['device_id'] ?? ''));
        $uid  = substr(trim((string)($parsed['user_id'] ?? '')), 0, 64);
        $pkg  = trim((string)($parsed['package'] ?? '30days'));
        $memo = substr(trim((string)($parsed['memo'] ?? '')), 0, 255);
        $tx   = substr(trim((string)($parsed['tx_hash'] ?? '')), 0, 100);
        $amt  = (float)($parsed['amount_usdt'] ?? 0);
        if (!$did) api_err('device_id required');
        if (!in_array($pkg, VALID_PKGS, true)) api_err('invalid package');
        // Derive user_id from memo when not explicitly provided (memo = SL-xxx ID)
        if (!$uid && preg_match('/^SL-\d+-[A-Z0-9]+$/i', $memo)) $uid = $memo;
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS payment_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL, user_id TEXT DEFAULT '',
            memo TEXT DEFAULT '', package TEXT NOT NULL DEFAULT '30days',
            amount_usdt REAL DEFAULT 0, tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '', note TEXT DEFAULT ''
        )");
        try { $db->exec("ALTER TABLE payment_queue ADD COLUMN user_id TEXT DEFAULT ''"); } catch (Exception $e) {}
        $db->prepare("INSERT INTO payment_queue (device_id,user_id,package,memo,tx_hash,amount_usdt) VALUES (?,?,?,?,?,?)")
           ->execute([$did, $uid, $pkg, $memo, $tx, $amt]);
        api_ok(['payment_id' => (int)$db->lastInsertId()]);
    }
    if ($action === 'save-settings') {
        $allowed_keys = ['telegram_url','server_label','support_url','edge_host'];
        $db2 = open_analytics_db();
        $st = $db2->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        foreach ($allowed_keys as $k) {
            if (array_key_exists($k, $parsed)) $st->execute([$k, (string)$parsed[$k]]);
        }
        api_ok(['saved' => true]);
    }
    if ($action === 'save-ads-config') {
        // Remote-tune rewarded-ads + recovery economy without DB access or an APK
        // update. Allowlist = the ad/recovery config keys (see lib/ads_recovery.php).
        $allowed = array_keys(ar_defaults());
        $db2 = open_analytics_db();
        $st = $db2->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        $saved = [];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $parsed)) continue;
            $st->execute([$k, (string)$parsed[$k]]);
            $saved[] = $k;
        }
        api_ok(['saved' => $saved]);
    }
    if ($action === 'save-calling-config') {
        // Same allowlist-of-keys pattern as save-ads-config, sourced from
        // lib/calling.php's own CALL_SERVICE_SETTING_DEFAULTS so this stays
        // in sync automatically if that list ever changes.
        $allowed = array_keys(CALL_SERVICE_SETTING_DEFAULTS);
        $db2 = open_analytics_db();
        $st = $db2->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        $saved = [];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $parsed)) continue;
            $st->execute([$k, (string)$parsed[$k]]);
            $saved[] = $k;
        }
        api_ok(['saved' => $saved]);
    }
    if ($action === 'save-payments-config') {
        // Remote-tune REAL/USDT token addresses, wallets, discount, window, indexer.
        $allowed = array_keys(pay_defaults());
        $db2 = open_analytics_db();
        $st = $db2->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        $saved = [];
        foreach ($allowed as $k) {
            if (!array_key_exists($k, $parsed)) continue;
            $st->execute([$k, (string)$parsed[$k]]);
            $saved[] = $k;
        }
        api_ok(['saved' => $saved]);
    }
    if ($action === 'save-package') {
        // Upsert a premium package (admin package editor). package_id required.
        $pid = trim((string)($parsed['package_id'] ?? ''));
        if ($pid === '') api_err('package_id required');
        $db2 = open_analytics_db();
        pay_init_tables($db2);
        $db2->prepare(
            "INSERT INTO premium_packages
                (package_id, gb_amount, usdt_price, real_price, real_discount_percent, is_recommended, is_active, display_order, updated_at)
             VALUES (?,?,?,?,?,?,?,?,datetime('now'))
             ON CONFLICT(package_id) DO UPDATE SET
                gb_amount=excluded.gb_amount, usdt_price=excluded.usdt_price, real_price=excluded.real_price,
                real_discount_percent=excluded.real_discount_percent, is_recommended=excluded.is_recommended,
                is_active=excluded.is_active, display_order=excluded.display_order, updated_at=datetime('now')"
        )->execute([
            $pid,
            max(0, (int)($parsed['gb_amount'] ?? 0)),
            max(0, (float)($parsed['usdt_price'] ?? 0)),
            max(0, (float)($parsed['real_price'] ?? 0)),
            max(0, (float)($parsed['real_discount_percent'] ?? 0)),
            (int)(bool)($parsed['is_recommended'] ?? 0),
            array_key_exists('is_active', $parsed) ? (int)(bool)$parsed['is_active'] : 1,
            max(0, (int)($parsed['display_order'] ?? 0)),
        ]);
        api_ok(['saved' => $pid]);
    }
    if ($action === 'save-remote-config') {
        $allowed_rc_keys = [
            'rc_version','rc_sni_priorities','rc_kill_switches','rc_protocol_order',
            'rc_emergency_sni','rc_iran_sni_order','rc_ttl','rc_updated_at',
            'bootstrap_uuid','bootstrap_address','bootstrap_port','bootstrap_pubkey',
            'bootstrap_shortid','bootstrap_sni','bootstrap_flow','bootstrap_fp',
            'bootstrap_edge_address','bootstrap_edge_port',
            'bootstrap_ws_path','bootstrap_xhttp_path','bootstrap_httpup_path',
            'bootstrap_alt_profiles',
            // Adaptive network flags
            'rc_failover_max_nodes','rc_nodes_disabled','rc_telemetry_enabled',
            'rc_rollout','rc_extra_logging_platform','rc_extra_logging_node',
        ];
        $db_rc = open_analytics_db();
        $st_rc = $db_rc->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime('now'))");
        $saved = [];
        foreach ($allowed_rc_keys as $k) {
            if (!array_key_exists($k, $parsed)) continue;
            $v = $parsed[$k];
            $st_rc->execute([$k, is_array($v) ? json_encode($v) : (string)$v]);
            $saved[] = $k;
        }
        $st_rc->execute(['rc_updated_at', date('Y-m-d H:i:s')]);
        $all = $db_rc->query("SELECT key,value FROM settings")->fetchAll(PDO::FETCH_KEY_PAIR);
        $da  = function(string $k, array $def) use ($all): array {
            if (!isset($all[$k])) return $def;
            $v = json_decode($all[$k], true);
            return is_array($v) ? $v : $def;
        };
        $composite = [
            'version'        => (int)($all['rc_version'] ?? 1),
            'sni_priorities' => $da('rc_sni_priorities', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'kill_switches'  => $da('rc_kill_switches',  []),
            'protocol_order' => $da('rc_protocol_order', ['Reality','XHTTP','WebSocket']),
            'emergency_sni'  => (string)($all['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order' => $da('rc_iran_sni_order', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'ttl'            => (int)($all['rc_ttl'] ?? 3600),
            'updated_at'     => date('Y-m-d H:i:s'),
        ];
        $st_rc->execute(['remote_config', json_encode($composite)]);

        // Auto-sync edge proxy UUID whitelist whenever any bootstrap_* key is saved.
        $sync_result = null;
        $bootstrap_keys_saved = array_filter($saved, fn($k) => str_starts_with($k, 'bootstrap_'));
        if (!empty($bootstrap_keys_saved)) {
            $sync_wrapper = '/usr/local/sbin/setalink-sync-edge-config';
            if (file_exists($sync_wrapper)) {
                $sync_raw = shell_exec('sudo ' . escapeshellarg($sync_wrapper) . ' 2>&1') ?: '';
                $sync_lines = array_values(array_filter(array_map('trim', explode("\n", $sync_raw))));
                $sync_kv = [];
                foreach ($sync_lines as $ln) {
                    if (preg_match('/^([A-Z_]+)=(.*)$/', $ln, $m)) $sync_kv[$m[1]] = $m[2];
                }
                $sync_result = [
                    'ok'    => isset($sync_kv['XRAY_OK']) && $sync_kv['XRAY_OK'] === '1',
                    'lines' => $sync_lines,
                ];
            }
        }

        api_ok(['saved' => $saved, 'sync' => $sync_result]);
    }
    if ($action === 'record-test') {
        $country     = substr(trim((string)($parsed['country']     ?? '')), 0, 80);
        $network     = substr(trim((string)($parsed['network']     ?? '')), 0, 80);
        $server      = substr(trim((string)($parsed['server']      ?? '')), 0, 120);
        $port        = max(1, min(65535, (int)($parsed['port']     ?? 0)));
        $protocol    = substr(trim((string)($parsed['protocol']    ?? 'VLESS+Reality')), 0, 60);
        $sni         = substr(trim((string)($parsed['sni']         ?? '')), 0, 120);
        $flow        = substr(trim((string)($parsed['flow']        ?? '')), 0, 60);
        $fingerprint = substr(trim((string)($parsed['fingerprint'] ?? '')), 0, 60);
        $result      = (string)($parsed['result']   ?? 'fail');
        $error_msg   = substr(trim((string)($parsed['error_msg']   ?? '')), 0, 500);
        $tcp_ok      = (int)(bool)($parsed['tcp_ok']  ?? false);
        $http_ok     = (int)(bool)($parsed['http_ok'] ?? false);
        $latency_ms  = max(0, (int)($parsed['latency_ms'] ?? 0));
        $tested_by   = substr(trim((string)($parsed['tested_by']  ?? $auth_user)), 0, 60);
        $notes       = substr(trim((string)($parsed['notes']      ?? '')), 0, 500);
        if (!$country || !$server) api_err('country and server are required');
        if (!in_array($result, ['success','fail','partial'], true)) api_err('invalid result');
        $db3 = open_analytics_db();
        $st3 = $db3->prepare('INSERT INTO test_results
            (country,network,server,port,protocol,sni,flow,fingerprint,result,error_msg,tcp_ok,http_ok,latency_ms,tested_by,notes)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $st3->execute([$country,$network,$server,$port,$protocol,$sni,$flow,$fingerprint,
                       $result,$error_msg,$tcp_ok,$http_ok,$latency_ms,$tested_by,$notes]);
        api_ok(['id' => (int)$db3->lastInsertId()]);
    }
    if ($action === 'delete-old-apk') {
        $channel = trim((string)($parsed['channel'] ?? ''));
        $filename = trim((string)($parsed['filename'] ?? ''));
        if (!in_array($channel, ['stable','beta','hotfix'], true)) api_err('invalid channel');
        if (!preg_match('/^setalink-v[\d.a-z-]+\.apk$/i', $filename)) api_err('invalid filename');
        $path = "/var/www/setalink/public/releases/{$channel}/{$filename}";
        if (!file_exists($path)) api_err('file not found', 404);
        // Refuse to delete the symlink target
        $sym = "/var/www/setalink/public/releases/{$channel}/setalink-latest.apk";
        if (is_link($sym) && realpath($sym) === realpath($path)) api_err('cannot delete current release');
        if (!unlink($path)) api_err('delete failed', 500);
        api_ok(['deleted' => $filename]);
    }
    if ($action === 'apk-cleanup') {
        $releases_dir = '/var/www/setalink/public/releases';
        $keep_count   = 3;
        $results      = [];
        foreach (['stable','beta','hotfix'] as $channel) {
            $ch_dir = "{$releases_dir}/{$channel}";
            if (!is_dir($ch_dir)) { $results[$channel] = ['skipped'=>true]; continue; }
            $apks = glob("{$ch_dir}/setalink-v*.apk") ?: [];
            usort($apks, fn($a,$b) => filemtime($b) <=> filemtime($a));
            $keep   = array_slice($apks, 0, $keep_count);
            $remove = array_slice($apks, $keep_count);
            $deleted = 0;
            foreach ($remove as $f) { @unlink($f); $deleted++; }
            // Repair symlink → newest APK
            $sym = "{$ch_dir}/setalink-latest.apk";
            $newest = $keep[0] ?? null;
            $sym_fixed = false;
            if ($newest) {
                if (is_link($sym) || file_exists($sym)) @unlink($sym);
                symlink(basename($newest), $sym);
                $sym_fixed = true;
            }
            $results[$channel] = [
                'kept'    => count($keep),
                'deleted' => $deleted,
                'newest'  => $newest ? basename($newest) : null,
                'symlink' => $sym_fixed,
            ];
        }
        // Repair top-level download/setalink-latest.apk → stable newest
        $dl_link   = '/var/www/setalink/public/download/setalink-latest.apk';
        $stable_apks = glob("{$releases_dir}/stable/setalink-v*.apk") ?: [];
        if ($stable_apks) {
            usort($stable_apks, fn($a,$b) => filemtime($b) <=> filemtime($a));
            $target = '../releases/stable/' . basename($stable_apks[0]);
            if (is_link($dl_link) || file_exists($dl_link)) @unlink($dl_link);
            symlink($target, $dl_link);
        }
        api_ok(['results'=>$results,'cleaned_at'=>date('Y-m-d H:i:s')]);
    }
    // ── Referral review queue ─────────────────────────────────────────────
    // High-risk referrals land in status='pending' (no reward granted by the
    // public API). Approve grants the held bonus to BOTH devices; Reject
    // denies it permanently. Every decision is written to referral_audit.

    if ($action === 'referral-approve' || $action === 'referral-reject') {
        $refId = (int)($parsed['id'] ?? 0);
        if ($refId <= 0) api_err('id required');
        $db = open_analytics_db();
        init_device_tables($db);
        init_referral_audit($db);

        $st = $db->prepare("SELECT * FROM referral_uses WHERE id=?");
        $st->execute([$refId]);
        $ru = $st->fetch(PDO::FETCH_ASSOC);
        if (!$ru) api_err('referral not found', 404);
        if (($ru['status'] ?? '') !== 'pending') {
            api_err("referral is '{$ru['status']}' — only pending referrals can be reviewed", 409);
        }

        $admin = $auth_user !== '' ? $auth_user : 'admin';

        if ($action === 'referral-approve') {
            $bonus = (int)($ru['bonus_bytes'] ?: REFERRAL_BONUS_BYTES);
            $db->prepare("UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?")
               ->execute([$bonus, $ru['new_device_id']]);
            $db->prepare("UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?")
               ->execute([$bonus, $ru['referrer_device_id']]);
            $db->prepare("UPDATE referral_uses SET status='approved' WHERE id=?")->execute([$refId]);

            // Refresh referrer's granted-invite cache + stealth unlock
            $inv = $db->prepare(
                "SELECT COUNT(*) FROM referral_uses WHERE referrer_device_id=? AND status IN ('credited','approved')");
            $inv->execute([$ru['referrer_device_id']]);
            $invCount = (int)$inv->fetchColumn();
            $db->prepare("UPDATE devices SET invite_count=? WHERE device_id=?")
               ->execute([$invCount, $ru['referrer_device_id']]);
            $act = $db->prepare("
                SELECT COUNT(*) FROM referral_uses ru
                JOIN devices d ON d.device_id = ru.new_device_id
                WHERE ru.referrer_device_id=?
                  AND ru.status IN ('credited','approved')
                  AND (d.internet_ok=1 OR d.last_seen >= datetime('now','-7 days'))");
            $act->execute([$ru['referrer_device_id']]);
            if ((int)$act->fetchColumn() >= 3) {
                $db->prepare("UPDATE devices SET stealth_unlocked=1 WHERE device_id=?")
                   ->execute([$ru['referrer_device_id']]);
            }

            $db->prepare("INSERT INTO referral_audit (referral_id, action, acted_by, detail) VALUES (?,?,?,?)")
               ->execute([$refId, 'approve', $admin,
                          "granted {$bonus}B to referrer {$ru['referrer_device_id']} + new {$ru['new_device_id']} (risk={$ru['risk_score']})"]);
            api_ok(['status' => 'approved', 'bonus_bytes' => $bonus, 'invite_count' => $invCount]);
        }

        // referral-reject
        $db->prepare("UPDATE referral_uses SET status='rejected' WHERE id=?")->execute([$refId]);
        $db->prepare("INSERT INTO referral_audit (referral_id, action, acted_by, detail) VALUES (?,?,?,?)")
           ->execute([$refId, 'reject', $admin,
                      "denied reward for {$ru['new_device_id']} via code {$ru['referral_code']} (risk={$ru['risk_score']} flags={$ru['risk_flags']})"]);
        api_ok(['status' => 'rejected']);
    }

    if ($action === 'geo-backfill') {
        // Re-resolve country for devices that have a public last_ip but no
        // country (their first lookups failed or every request was tunneled).
        $db = open_analytics_db();
        init_device_tables($db);
        $rows = $db->query("SELECT device_id, last_ip FROM devices
                            WHERE (country='' OR country IS NULL) AND last_ip!=''")
                   ->fetchAll(PDO::FETCH_ASSOC);
        $fixed = 0;
        foreach ($rows as $r) {
            [$cc, $cn] = geo_country($db, $r['last_ip']);
            if ($cc === '') continue;
            $db->prepare("UPDATE devices SET country=?, country_name=? WHERE device_id=?")
               ->execute([$cc, $cn, $r['device_id']]);
            $fixed++;
        }
        api_ok(['checked' => count($rows), 'fixed' => $fixed]);
    }
    if ($action === 'push-emergency-profiles') {
        $profiles = $parsed['profiles'] ?? [];
        if (!is_array($profiles)) api_err('profiles must be array');
        $db = open_analytics_db();
        $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('rc_emergency_profiles',?,datetime('now'))")
           ->execute([json_encode($profiles)]);
        api_ok(['saved' => count($profiles)]);
    }
    if ($action === 'push-stealth-profiles') {
        $profiles = $parsed['profiles'] ?? [];
        if (!is_array($profiles)) api_err('profiles must be array');
        $db = open_analytics_db();
        $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('rc_stealth_profiles',?,datetime('now'))")
           ->execute([json_encode($profiles)]);
        api_ok(['saved' => count($profiles)]);
    }
    if ($action === 'update-version-json') {
        $vj_path = '/var/www/setalink/public/download/version.json';
        $current = json_decode((string)@file_get_contents($vj_path), true) ?: [];
        // Merge allowed fields
        $allowed_vj = ['forceUpdate','minSupported','rollout','changelog','channels'];
        foreach ($allowed_vj as $f) {
            if (isset($parsed[$f])) $current[$f] = $parsed[$f];
        }
        $current['releaseDate'] = date('Y-m-d');
        file_put_contents($vj_path, json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        api_ok(['saved' => true, 'version' => $current['version'] ?? '?']);
    }
    // SEO rank tracker — record a snapshot of keyword positions (manual entry
    // or a future GSC feed). { entries:[{keyword,position,lang?,impressions?,clicks?}], source?, captured_at? }
    if ($action === 'seo-rank-record') {
        $db = open_analytics_db();
        seo_ranks_init($db);
        $entries = $parsed['entries'] ?? [];
        if (!is_array($entries) || !$entries) api_err('no entries');
        $src = substr((string)($parsed['source'] ?? 'manual'), 0, 30);
        $cap = (string)($parsed['captured_at'] ?? date('Y-m-d H:i:s'));
        $ins = $db->prepare("INSERT INTO keyword_ranks (keyword,lang,position,impressions,clicks,source,captured_at)
                             VALUES (?,?,?,?,?,?,?)");
        $n = 0;
        foreach ($entries as $e) {
            $kw = trim((string)($e['keyword'] ?? ''));
            if ($kw === '') continue;
            $pos = (isset($e['position']) && $e['position'] !== '' && $e['position'] !== null) ? (float)$e['position'] : null;
            $ins->execute([$kw, substr((string)($e['lang'] ?? 'fa'),0,5), $pos,
                           (int)($e['impressions'] ?? 0), (int)($e['clicks'] ?? 0), $src, $cap]);
            $n++;
        }
        api_ok(['recorded' => $n, 'captured_at' => $cap]);
    }
    // (Re)seed the tracked keyword list (idempotent).
    if ($action === 'seo-rank-seed') {
        $db = open_analytics_db();
        seo_ranks_init($db);
        api_ok(['added' => seo_ranks_seed($db)]);
    }
    // Stop tracking a keyword — removes ALL history rows for it (not just a
    // marker), since a stale/wrong keyword (e.g. an old brand name) has no
    // value even historically for a realgram.no-only view. No delete action
    // existed before this (2026-07-20, Khabat: realgram.no SEO should only
    // track realgram.no, not "setalink"/"realink" rows left over from
    // GSC-suggested or manually-added queries).
    if ($action === 'seo-rank-delete') {
        $db = open_analytics_db();
        seo_ranks_init($db);
        $kw = trim((string)($parsed['keyword'] ?? ''));
        if ($kw === '') api_err('keyword required');
        $del = $db->prepare('DELETE FROM keyword_ranks WHERE keyword = ?');
        $del->execute([$kw]);
        api_ok(['deleted' => $del->rowCount(), 'keyword' => $kw]);
    }
    // Pull real positions from Google Search Console into keyword_ranks.
    if ($action === 'seo-rank-gsc-sync') {
        $db = open_analytics_db();
        if (!gsc_key_present()) {
            api_err('Search Console key not installed yet. Upload the service-account JSON to '
                  . GSC_KEY_PATH . ' and add its e-mail as a user in Search Console.');
        }
        try { api_ok(gsc_sync($db)); }
        catch (\Throwable $e) { api_err('GSC sync failed: ' . $e->getMessage()); }
    }
    // Set the Search Console property URL (https://setalink.no/ or sc-domain:setalink.no).
    if ($action === 'seo-rank-gsc-config') {
        $db = open_analytics_db();
        $u = trim((string)($parsed['site_url'] ?? ''));
        if ($u === '') api_err('site_url required');
        gsc_setting($db, 'gsc_site_url', $u);
        api_ok(['site_url' => $u]);
    }

    // ── Monetization / Ads mutations ────────────────────────────────────────
    // Every one of these is audit-logged (am_log) per spec §18 — config
    // changes, syncs, and imports must all be traceable to an admin + timestamp.

    if ($action === 'monetization-config-save') {
        $db = open_analytics_db();
        am_init_tables($db);
        $patch = is_array($parsed['config'] ?? null) ? $parsed['config'] : [];
        $saved = am_save_config($db, $patch);

        $fxCurrency = trim((string)($parsed['fx_currency'] ?? ''));
        if ($fxCurrency !== '' && isset($parsed['fx_rate'])) {
            am_set_fx_rate($db, $fxCurrency, (float)$parsed['fx_rate'], 'manual');
            $saved[] = 'fx_rate:' . strtoupper($fxCurrency);
        }

        if (isset($parsed['adsgram_api_token'])) {
            $token = trim((string)$parsed['adsgram_api_token']);
            $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('adsgram_api_token',?,datetime('now'))")
                ->execute([$token]);
            $saved[] = 'adsgram_api_token';
        }

        am_log($db, $auth_user, 'monetization_config_save', ['fields' => $saved]);
        api_ok(['saved' => $saved]);
    }

    if ($action === 'monetization-adsgram-csv-import') {
        $db = open_analytics_db();
        $csv = (string)($parsed['csv'] ?? '');
        $filename = substr(trim((string)($parsed['filename'] ?? 'upload.csv')), 0, 200);
        if ($csv === '') api_err('csv required');
        if (strlen($csv) > 2_000_000) api_err('csv too large (max 2MB)');
        try {
            $res = am_csv_import_adsgram($db, $csv, $filename, $auth_user);
            api_ok($res);
        } catch (\InvalidArgumentException $e) {
            api_err('CSV import failed: ' . $e->getMessage());
        }
    }

    if ($action === 'monetization-admob-sync-now') {
        $db = open_analytics_db();
        $days = max(1, min(90, (int)($parsed['days'] ?? 30)));
        $res = admob_sync($db, $days);
        am_log($db, $auth_user, 'monetization_admob_sync_now', $res);
        if (!$res['ok']) api_err('AdMob sync failed: ' . $res['error']);
        api_ok($res);
    }

    if ($action === 'monetization-admob-disconnect') {
        $db = open_analytics_db();
        $ok = admob_disconnect();
        am_log($db, $auth_user, 'monetization_admob_disconnect', ['ok' => $ok]);
        api_ok(['disconnected' => $ok]);
    }

    if ($action === 'monetization-adsgram-sync-now') {
        $db = open_analytics_db();
        $days = max(1, min(90, (int)($parsed['days'] ?? 30)));
        $res = adsgram_publisher_sync($db, $days);
        am_log($db, $auth_user, 'monetization_adsgram_sync_now', $res);
        if (!$res['ok']) api_err('AdsGram sync failed: ' . $res['error']);
        api_ok($res);
    }

    $allowed = ['add','remove','disable','enable','reset-traffic','change-package','regen-link'];
    if (!in_array($action, $allowed, true)) api_err('unknown action');
    if (!preg_match(USERNAME_RE, $name))    api_err('invalid username');
    $args = [$name];
    if (in_array($action, ['add','change-package'], true)) {
        if ($pkg === '') $pkg = 'unlimited';
        if (!in_array($pkg, VALID_PKGS, true)) api_err('invalid package');
        $args[] = $pkg;
    }
    $r = cli_run($action, $args);
    if ($r['rc'] !== 0) {
        $tail = trim((string)preg_replace('/\x1b\[[0-9;]*m/', '', $r['output']));
        api_err(substr($tail, -400));
    }
    api_ok(['message' => "{$action}: {$name}"]);
}

// Shared date-window resolver for the monetization-* actions (from/to takes
// priority over days; same convention as the existing ads-perf-comparison action).
function mon_window(): array {
    $from = trim((string)($_GET['from'] ?? ''));
    $to   = trim((string)($_GET['to']   ?? ''));
    if ($from && $to && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        return [$from, $to];
    }
    $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
    return [gmdate('Y-m-d', strtotime("-{$days} days")), gmdate('Y-m-d')];
}

// ── Admin GET ─────────────────────────────────────────────────────────────
$action = (string)($_GET['action'] ?? 'status');
switch ($action) {

    case 'status':   api_ok(cli_json('status', [], 8)); break;
    case 'list':     api_ok(cli_json('list',   [], 8)); break;
    case 'csrf':     api_ok(['csrf' => $csrf_token]);    break;

    case 'full-json':
        $name = trim((string)($_GET['name'] ?? ''));
        if (!$name || !preg_match(USERNAME_RE, $name)) api_err('invalid username');
        $r = cli_run('read-full-json', [$name]);
        if ($r['rc'] !== 0) api_err('config not found for ' . $name, 404);
        header('Content-Disposition: attachment; filename="xray-' . $name . '.json"');
        echo $r['output'];
        exit;

    case 'server-stats':        api_ok(cli_json('server-stats', [], 8)); break;
    case 'connection-analytics': api_ok(cli_json('connection-analytics', [], 8)); break;

    // Aggregate, privacy-safe user insights for the dashboard. NO per-user
    // destination logging: "category reachability" comes from the app's own
    // connectivity probes (probe_* in connect_telemetry), and "carrier" is the
    // ASN-derived operator name (never the raw IP).
    // Batched UI tap telemetry (B-24). Ingested via public/api.php's
    // track-taps-batch action into tap_events; this just aggregates it.
    case 'tap-stream-summary': {
        $db    = open_analytics_db();
        $days  = max(1, min(90, (int)($_GET['days'] ?? 7)));
        $since = "(strftime('%s','now','-" . $days . " days')*1000)";
        $q = function (string $sql) use ($db) {
            try { return $db->query($sql)->fetchAll(PDO::FETCH_ASSOC); }
            catch (\Throwable $e) { return []; }
        };
        $byScreen  = $q("SELECT screen, COUNT(*) AS taps FROM tap_events
                         WHERE ts >= " . $since . " GROUP BY screen ORDER BY taps DESC LIMIT 20");
        $byElement = $q("SELECT screen, element, COUNT(*) AS taps FROM tap_events
                         WHERE ts >= " . $since . " GROUP BY screen, element ORDER BY taps DESC LIMIT 30");
        $totals    = $q("SELECT COUNT(*) AS total_taps, COUNT(DISTINCT device_id) AS devices
                         FROM tap_events WHERE ts >= " . $since);
        api_ok([
            'days'       => $days,
            'totals'     => $totals[0] ?? new \stdClass(),
            'by_screen'  => $byScreen,
            'by_element' => $byElement,
        ]);
        break;
    }

    // Calling (audio) admin overview — config (settings table, editable
    // here instead of needing direct DB access), live stats, and recent
    // call history. See lib/calling.php's own header for the full
    // architecture; this case is read-only aggregation only, no writes.
    case 'calling-admin-overview': {
        $db = open_analytics_db();
        call_ensure_schema($db);
        $cfg = call_service_config($db);

        $q = function (string $sql, array $args = []) use ($db) {
            try { $st = $db->prepare($sql); $st->execute($args); return $st->fetchAll(PDO::FETCH_ASSOC); }
            catch (\Throwable $e) { return []; }
        };
        $totalToday = $q("SELECT COUNT(*) AS n FROM call_sessions WHERE started_at >= datetime('now','-1 day')");
        $totalWeek  = $q("SELECT COUNT(*) AS n FROM call_sessions WHERE started_at >= datetime('now','-7 days')");
        $byStatus   = $q("SELECT status, COUNT(*) AS n FROM call_sessions GROUP BY status ORDER BY n DESC");
        $recent     = $q("SELECT * FROM call_sessions ORDER BY started_at DESC LIMIT 50");

        api_ok([
            // Raw values, not masked — this panel already sits behind the
            // same HTTP Basic Auth + session + CSRF trust boundary as every
            // other admin-editable secret in this file (e.g. AdMob/payment
            // keys via save-ads-config/save-payments-config), so masking
            // here would be security theater, not a real control.
            'editable' => [
                'calling_relay_secret'          => $cfg['relay_secret'],
                'calling_turn_secret'           => $cfg['turn_secret'],
                'calling_relay_internal_url'    => $cfg['relay_internal_url'],
                'calling_relay_internal_secret' => $cfg['relay_internal_secret'],
                'calling_allowlist'             => $cfg['allowlist'],
            ],
            'relay_configured' => $cfg['relay_secret'] !== '',
            'turn_configured'  => $cfg['turn_secret'] !== '',
            'calls_today'      => (int)($totalToday[0]['n'] ?? 0),
            'calls_week'       => (int)($totalWeek[0]['n'] ?? 0),
            'by_status'        => $byStatus,
            'recent'           => $recent,
        ]);
        break;
    }

    // REAL Wallet page (data-view="wallet") — previously a "Coming soon"
    // placeholder (docs/realgram/TASK_SPLIT.md B→A(73)/(94)/(95)). Live
    // proxy to the shahnameh-backend's new /v1/economy-summary (no local
    // cache, unlike ga4-summary below — this ledger is small enough that a
    // live call per page load is fine, and staleness on a money page is
    // worse than an extra round-trip).
    case 'wallet-economy-summary': {
        $db = open_analytics_db();
        re_ensure_schema($db);
        $summary = re_fetch_economy_summary($db);
        if ($summary === null) {
            api_ok([
                'available' => false,
                'reason'    => re_service_config($db)['api_url'] === ''
                             ? 'ecosystem backend not configured' : 'ecosystem backend unreachable',
            ]);
            break;
        }
        api_ok(['available' => true] + $summary);
        break;
    }

    // Google Analytics (GA4) for the Analytics page — real users/pages/geo
    // from Google, not just the internal analytics.db charts above. Cached
    // read (no live API call) so page loads stay fast; ga4-sync refreshes it.
    case 'ga4-summary': {
        $db    = open_analytics_db();
        $cache = json_decode(ga4_setting($db, 'ga4_cache', null, '{}'), true) ?: null;
        api_ok([
            'configured'  => ga4_key_present() && trim(ga4_setting($db, 'ga4_property_id')) !== '',
            'key_present' => ga4_key_present(),
            'property_id' => ga4_setting($db, 'ga4_property_id'),
            'last_sync'   => ga4_setting($db, 'ga4_last_sync'),
            'cache'       => $cache,
        ]);
        break;
    }
    case 'ga4-sync': {
        $db = open_analytics_db();
        if (!ga4_key_present()) {
            api_err('GA4 key not installed. Reuses ' . GA4_KEY_PATH . ' (same as Search Console) — '
                  . 'grant that service account "Viewer" access on the GA4 property first.');
        }
        try { api_ok(ga4_sync($db)); }
        catch (\Throwable $e) { api_err('GA4 sync failed: ' . $e->getMessage()); }
        break;
    }
    case 'ga4-save-property': {
        $db = open_analytics_db();
        $pid = trim((string)($_POST['property_id'] ?? $_GET['property_id'] ?? ''));
        if ($pid === '') {
            // JS posts JSON (Content-Type: application/json), which PHP
            // never populates $_POST for — read the raw body as a fallback.
            $raw = json_decode((string)file_get_contents('php://input'), true);
            $pid = trim((string)($raw['property_id'] ?? ''));
        }
        if ($pid === '' || !preg_match('/^\d+$/', $pid)) api_err('numeric property_id required');
        ga4_setting($db, 'ga4_property_id', $pid);
        api_ok(['property_id' => $pid]);
        break;
    }

    case 'user-insights': {
        $db   = open_analytics_db();
        $days = max(1, min(90, (int)($_GET['days'] ?? 30)));
        $since = "datetime('now', '-" . $days . " days')";
        $q = function (string $sql) use ($db) {
            try { return $db->query($sql)->fetchAll(PDO::FETCH_ASSOC); }
            catch (\Throwable $e) { return []; }
        };
        $carriers = $q("SELECT COALESCE(NULLIF(carrier,''),'(unknown)') AS carrier, COUNT(*) AS devices
                        FROM devices GROUP BY carrier ORDER BY devices DESC LIMIT 20");
        $geo = $q("SELECT COALESCE(NULLIF(country,''),'?') AS country, COUNT(*) AS devices
                   FROM devices GROUP BY country ORDER BY devices DESC LIMIT 20");
        $platforms = $q("SELECT COALESCE(NULLIF(platform,''),'?') AS platform, COUNT(*) AS devices
                         FROM devices GROUP BY platform ORDER BY devices DESC");
        $brands = $q("SELECT COALESCE(NULLIF(manufacturer,''),'?') AS brand, COUNT(*) AS devices
                      FROM devices GROUP BY manufacturer ORDER BY devices DESC LIMIT 10");
        $plans = $q("SELECT plan, COUNT(*) AS devices FROM devices GROUP BY plan ORDER BY devices DESC");
        $longest = $q("SELECT substr(device_id,1,16) AS device, COALESCE(NULLIF(protocol,''),'?') AS protocol,
                              duration_secs, ROUND((bytes_sent+bytes_recv)/1048576.0,1) AS mb, date(ended_at) AS day
                       FROM vpn_sessions ORDER BY duration_secs DESC LIMIT 10");
        $protocols = $q("SELECT COALESCE(NULLIF(protocol,''),'?') AS protocol, COUNT(*) AS sessions,
                                ROUND(SUM(bytes_sent+bytes_recv)/1073741824.0,2) AS gb
                         FROM vpn_sessions GROUP BY protocol ORDER BY sessions DESC");
        $nodes = $q("SELECT node_id, COUNT(*) AS connects FROM connect_telemetry
                     WHERE created_at >= " . $since . " GROUP BY node_id ORDER BY connects DESC LIMIT 12");
        $reach = $q("SELECT
              ROUND(100.0*AVG(CASE WHEN probe_instagram IN (0,1) THEN probe_instagram END),0)  AS instagram,
              ROUND(100.0*AVG(CASE WHEN probe_telegram  IN (0,1) THEN probe_telegram  END),0)  AS telegram,
              ROUND(100.0*AVG(CASE WHEN probe_google    IN (0,1) THEN probe_google    END),0)  AS google,
              ROUND(100.0*AVG(CASE WHEN probe_cloudflare IN (0,1) THEN probe_cloudflare END),0) AS cloudflare,
              ROUND(100.0*AVG(CASE WHEN probe_apple     IN (0,1) THEN probe_apple     END),0)  AS apple
            FROM connect_telemetry WHERE created_at >= " . $since);
        $totals = $q("SELECT
              (SELECT COUNT(*) FROM devices) AS total_devices,
              (SELECT COUNT(*) FROM devices WHERE last_seen >= datetime('now','-1 day'))  AS active_24h,
              (SELECT COUNT(*) FROM devices WHERE last_seen >= datetime('now','-7 days')) AS active_7d,
              (SELECT COUNT(*) FROM devices WHERE plan='premium') AS premium,
              (SELECT ROUND(SUM(bytes_sent+bytes_recv)/1073741824.0,1) FROM vpn_sessions) AS total_gb,
              (SELECT MAX(duration_secs) FROM vpn_sessions) AS longest_secs");
        api_ok([
            'days'         => $days,
            'totals'       => $totals[0] ?? new \stdClass(),
            'carriers'     => $carriers,
            'geo'          => $geo,
            'platforms'    => $platforms,
            'brands'       => $brands,
            'plans'        => $plans,
            'longest'      => $longest,
            'protocols'    => $protocols,
            'nodes'        => $nodes,
            'reachability' => $reach[0] ?? new \stdClass(),
        ]);
        break;
    }

    // ── SEO keyword rank tracker ────────────────────────────────────────────
    // Track where target search terms rank over time so the owner can compare
    // positions across dates. Positions are recorded as snapshots (manual entry
    // now; can be fed from the Google Search Console API later). Lower = better;
    // position 0/NULL means "not measured / not in top 100".
    case 'seo-ranks': {
        $db = open_analytics_db();
        seo_ranks_init($db);
        // History per keyword + latest/previous/best for the summary table.
        $rows = $db->query(
            "SELECT keyword, lang, position, impressions, clicks, source, captured_at
             FROM keyword_ranks WHERE position IS NOT NULL
             ORDER BY keyword, captured_at"
        )->fetchAll(PDO::FETCH_ASSOC);
        $targets = $db->query("SELECT DISTINCT keyword, lang FROM keyword_ranks ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
        $hist = [];
        foreach ($rows as $r) {
            $hist[$r['keyword']][] = ['captured_at' => $r['captured_at'], 'position' => (float)$r['position']];
        }
        $out = [];
        foreach ($targets as $t) {
            $k = $t['keyword'];
            $h = $hist[$k] ?? [];
            $n = count($h);
            $latest = $n ? $h[$n-1]['position'] : null;
            $prev   = $n > 1 ? $h[$n-2]['position'] : null;
            $best   = null;
            foreach ($h as $p) { if ($best === null || $p['position'] < $best) $best = $p['position']; }
            $out[] = [
                'keyword'    => $k,
                'lang'       => $t['lang'],
                'latest'     => $latest,
                'previous'   => $prev,
                'delta'      => ($latest !== null && $prev !== null) ? round($prev - $latest, 1) : null, // +ve = improved (moved up)
                'best'       => $best,
                'last_at'    => $n ? $h[$n-1]['captured_at'] : null,
                'points'     => $n,
                'history'    => $h,
            ];
        }
        // Khabat, 2026-07-28: sort top-ranking first, no-ranking-yet last —
        // was previously left in raw seed/insertion order, which is what
        // made it look like "nothing moves" (a keyword ranked #3 could be
        // buried under nine untested ones with a lower id). null (never
        // measured) sorts after every real position, ties broken by keyword
        // so the order is at least stable between loads.
        usort($out, function ($a, $b) {
            if ($a['latest'] === null && $b['latest'] === null) return strcmp($a['keyword'], $b['keyword']);
            if ($a['latest'] === null) return 1;
            if ($b['latest'] === null) return -1;
            return $a['latest'] <=> $b['latest'];
        });
        api_ok([
            'keywords'   => $out,
            'checked_at' => date('Y-m-d H:i:s'),
            'gsc'        => [
                'key_present' => gsc_key_present(),
                'site_url'    => gsc_setting($db, 'gsc_site_url', null, 'https://setalink.no/'),
                'last_sync'   => gsc_setting($db, 'gsc_last_sync', null, ''),
            ],
        ]);
        break;
    }

    // Multi-node visibility: which device is using which node + the test allowlist.
    case 'node-usage': {
        $db = open_analytics_db();
        $usage = $allow = [];
        try {
            $usage = $db->query(
                "SELECT u.device_id, u.node_id, u.first_seen, u.last_seen, u.hits,
                        d.user_id, d.country
                   FROM node_usage u LEFT JOIN devices d ON d.device_id = u.device_id
                  ORDER BY u.last_seen DESC LIMIT 500"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {}
        try {
            $allow = $db->query(
                "SELECT device_id, node_id, added_at FROM node_allowlist ORDER BY added_at DESC"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {}
        api_ok(['usage' => $usage, 'allowlist' => $allow]);
        break;
    }

    case 'starlink-list': {
        require_once __DIR__ . '/../lib/starlink.php';
        $db = open_analytics_db();
        st_init_tables($db);
        $nodes = st_all($db);
        // Attach live health_state + allowlisted device count (reuses the
        // existing generic node_allowlist table — see node-allowlist-add above).
        foreach ($nodes as &$n) {
            $n['health_state'] = st_health_state($n);
            unset($n['heartbeat_token_hash']); // never expose, even hashed
            $st = $db->prepare("SELECT device_id, added_at FROM node_allowlist WHERE node_id = ? ORDER BY added_at DESC");
            $st->execute([$n['node_id']]);
            $n['allowlist'] = $st->fetchAll(PDO::FETCH_ASSOC);
        }
        unset($n);
        $log = $db->query("SELECT * FROM starlink_admin_log ORDER BY id DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        // Phase 2: pending self-enrollment tokens (never the raw token itself
        // — that's a launch-time secret shown once by starlink-create-enrollment-token).
        $pendingEnrollments = st_list_pending_enrollments($db);
        api_ok(['nodes' => $nodes, 'log' => $log, 'pending_enrollments' => $pendingEnrollments]);
        break;
    }

    case 'node-health': {
        // Latest per-node health written by scripts/check-node-health.sh (cron).
        $path = realpath(__DIR__ . '/../data') . '/node_health.json';
        $raw  = @file_get_contents($path);
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($data)) { api_ok(['updated_at' => null, 'nodes' => new \stdClass()]); break; }
        // Flag stale data so the dashboard can warn if the cron stopped.
        $age = isset($data['updated_at']) ? (time() - strtotime((string)$data['updated_at'])) : null;
        $data['stale'] = ($age === null || $age > 900);
        api_ok($data);
        break;
    }

    case 'node-intel': {
        // Telemetry-based node intelligence: success rates, platform & ISP breakdowns,
        // failure timeline, and per-profile scores derived from connect_telemetry table.
        require_once __DIR__ . '/../lib/node_intel.php';
        $db   = open_analytics_db();
        $days = max(1, min(90, (int)($_GET['days'] ?? 7)));
        $node = trim((string)($_GET['node'] ?? ''));
        ni_init_tables($db);
        api_ok([
            'days'                => $days,
            'node_scores'         => ni_node_scores($db, $days),
            'node_profile_scores' => ni_node_profile_scores($db, $days),
            'platform_breakdown'  => ni_platform_breakdown($db, $days),
            'isp_breakdown'       => ni_isp_breakdown($db, $node ?: null, $days),
            'network_breakdown'   => ni_network_breakdown($db, $days),
            'country_breakdown'   => ni_country_breakdown($db, $days),
            'recent_failures'     => ni_recent_failures($db, 100),
            'timeline'            => ni_timeline($db, min(30, $days)),
            'agent_insights'      => ni_agent_insights($db, $days),
            'build_breakdown'     => ni_build_breakdown($db, $days),
            'probe_breakdown'     => ni_probe_breakdown($db, $days),
            'recommendations'     => ni_recommendations($db, $days),
        ]);
        break;
    }

    // Node Genome + Telemetry Trust + Adaptive Routing + Evolution Layer —
    // see docs/NODE_INTELLIGENCE_ARCHITECTURE.md. Read-only visibility;
    // adaptive_routing_enabled is toggled via the dedicated
    // 'routing-toggle' action below (Rule 7: explicit action, never implicit).
    case 'node-genome': {
        require_once __DIR__ . '/../lib/node_intel.php';
        $db = open_analytics_db();
        ni_init_tables($db);
        $node = trim((string)($_GET['node'] ?? ''));
        $recentDecisions = $db->query(
            "SELECT decision_id, device_id, context_json, predicted_node, selected_node,
                    outcome_json, created_at, outcome_recorded_at
               FROM routing_decisions ORDER BY created_at DESC LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        $trustSummary = $db->query(
            "SELECT COUNT(*) AS devices, AVG(trust_score) AS avg_trust,
                    SUM(flagged_reports) AS flagged, SUM(total_reports) AS total
               FROM device_trust"
        )->fetch(PDO::FETCH_ASSOC) ?: [];
        api_ok([
            'genomes'            => $node !== '' ? [$node => ni_node_genome($db, $node)] : ni_all_genomes($db),
            'routing_enabled'    => ni_adaptive_routing_enabled($db),
            'routing_weights'    => ni_routing_weights($db),
            'recent_decisions'   => $recentDecisions,
            'trust_summary'      => $trustSummary,
        ]);
        break;
    }

    // Explicit, single-purpose toggle for the Adaptive Routing feature flag.
    // RULE 7 (docs/CLAUDE_REALINK_RULES.md): this is the ONLY place that can
    // turn it on — nothing in lib/node_intel.php or public/v1.php ever
    // flips this setting itself. POST ?action=routing-toggle&enabled=1|0
    case 'routing-toggle': {
        require_once __DIR__ . '/../lib/node_intel.php';
        $db = open_analytics_db();
        ni_init_tables($db);
        $enabled = ((string)($_POST['enabled'] ?? $_GET['enabled'] ?? '0')) === '1' ? '1' : '0';
        $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('adaptive_routing_enabled',?,datetime('now'))")
            ->execute([$enabled]);
        api_ok(['adaptive_routing_enabled' => $enabled === '1']);
        break;
    }

    // Set (or clear, with bonus=0) a policy bonus for one node or a whole
    // node_type class — see ni_policy_bonus(). POST ?action=routing-set-bonus
    // &node_id=starlink-no-01&bonus=15  OR  &node_type=starlink&bonus=15
    case 'routing-set-bonus': {
        require_once __DIR__ . '/../lib/node_intel.php';
        $db = open_analytics_db();
        ni_init_tables($db);
        $nodeId   = trim((string)($_POST['node_id']   ?? $_GET['node_id']   ?? ''));
        $nodeType = trim((string)($_POST['node_type'] ?? $_GET['node_type'] ?? ''));
        $bonus    = (float)($_POST['bonus'] ?? $_GET['bonus'] ?? 0);
        if ($nodeId === '' && $nodeType === '') api_err('node_id or node_type required', 400);
        $key = $nodeId !== '' ? "node_policy_bonus_{$nodeId}" : "node_policy_bonus_type_{$nodeType}";
        $db->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))")
            ->execute([$key, $bonus]);
        api_ok(['key' => $key, 'bonus' => $bonus]);
        break;
    }

    // AI Diagnosis — enriched sessions with cause/confidence/suggestions + pattern alerts.
    // ?action=ai-diagnosis&limit=20&days=14
    case 'ai-diagnosis': {
        require_once __DIR__ . '/../lib/node_intel.php';
        $db    = open_analytics_db();
        $limit = min(100, max(1, (int)($_GET['limit'] ?? 20)));
        $days  = min(90,  max(1, (int)($_GET['days']  ?? 14)));
        api_ok(ni_ai_diagnosis($db, $limit, $days));
        break;
    }

    // Diagnostic sessions — structured CP1-CP4 evidence per disconnect event.
    // Filters: server, cp1, cp4, conclusion_code, platform, since, limit
    // Examples:
    //   ?action=diag-sessions&server=Finland
    //   ?action=diag-sessions&cp1=PASS&cp4=FAIL
    //   ?action=diag-sessions&conclusion_code=tunnel_ok&limit=20
    case 'diag-sessions': {
        require_once __DIR__ . '/../lib/node_intel.php';
        $db = open_analytics_db();
        $filters = [];
        foreach (['server', 'cp1', 'cp4', 'conclusion_code', 'platform', 'since'] as $k) {
            $v = trim((string)($_GET[$k] ?? ''));
            if ($v !== '') $filters[$k] = $v;
        }
        $filters['limit'] = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        $sessions = ni_query_diag_sessions($db, $filters);
        // Group by server so caller can build a side-by-side view
        $byServer = [];
        foreach ($sessions as $s) {
            $byServer[$s['server_label'] ?? 'unknown'][] = $s;
        }
        api_ok([
            'filters'   => $filters,
            'total'     => count($sessions),
            'sessions'  => $sessions,
            'by_server' => $byServer,
        ]);
        break;
    }

    case 'test-results':
        $db = open_analytics_db();
        $limit = min(500, max(10, (int)($_GET['limit'] ?? 100)));
        $country = trim((string)($_GET['country'] ?? ''));
        $proto   = trim((string)($_GET['proto']   ?? ''));
        $result  = trim((string)($_GET['result']  ?? ''));
        $where = [];
        $params = [];
        if ($country) { $where[] = 'country LIKE ?'; $params[] = '%' . $country . '%'; }
        if ($proto)   { $where[] = 'protocol LIKE ?'; $params[] = '%' . $proto . '%'; }
        if ($result)  { $where[] = 'result = ?'; $params[] = $result; }
        $sql = 'SELECT * FROM test_results' .
               ($where ? ' WHERE ' . implode(' AND ', $where) : '') .
               ' ORDER BY recorded_at DESC LIMIT ' . $limit;
        $st  = $db->prepare($sql);
        $st->execute($params);
        api_ok($st->fetchAll(PDO::FETCH_ASSOC));
        break;

    case 'logs':
        $type = preg_match('/^(access|error|nginx|watchdog)$/', $_GET['type'] ?? 'access') ? $_GET['type'] : 'access';
        $n    = min(500, max(20, (int)($_GET['n'] ?? 100)));
        $r    = cli_run('tail-logs', [$type, (string)$n], 9);
        $raw  = trim($r['output']);
        $lines = ($raw && $raw !== '[]') ? json_decode($raw, true) : [];
        api_ok(is_array($lines) ? $lines : []);
        break;

    case 'protocol-health':
        set_time_limit(15);
        function tcp_open(string $host, int $port, int $t = 3): bool {
            $s = @fsockopen($host, $port, $e, $err, (float)$t);
            if ($s) { fclose($s); return true; }
            return false;
        }
        $EDGE = 'edge.setalink.no';
        $ph_probes = [
            'ws'          => ['url' => "https://{$EDGE}/ws",     'hdrs' => ['-H','Upgrade: websocket','-H','Connection: Upgrade']],
            'xhttp'       => ['url' => "https://{$EDGE}/xhttp", 'hdrs' => []],
            'httpupgrade' => ['url' => "https://{$EDGE}/httpup", 'hdrs' => ['-H','Upgrade: XHTTP','-H','Connection: Upgrade']],
        ];
        $ph_files = [];
        foreach ($ph_probes as $pkey => $pp) {
            $f = tempnam('/tmp', 'phck_');
            $ph_files[$pkey] = $f;
            $hargs = '';
            foreach ($pp['hdrs'] as $harg) $hargs .= ' ' . escapeshellarg($harg);
            $cmd = '(curl -sk -o /dev/null -w "%{http_code}" --max-time 6' . $hargs . ' ' . escapeshellarg($pp['url']) . ') > ' . escapeshellarg($f) . ' 2>&1 &';
            exec($cmd);
        }
        // Check Reality against the PRODUCTION Reality server (bootstrap_address —
        // a separate box, NOT this edge server). Clients connect there directly on :443.
        // Local xray has no SOCKS inbound; 10808 is the CLIENT-side port in the app.
        $ph_db = open_analytics_db();
        $ph_bs = $ph_db->query("SELECT key,value FROM settings WHERE key IN ('bootstrap_address','bootstrap_port')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $ph_raddr = (string)($ph_bs['bootstrap_address'] ?? '178.104.77.231');
        $ph_rport = (int)($ph_bs['bootstrap_port'] ?? 443);
        $reality_open = tcp_open($ph_raddr, $ph_rport, 4);
        $ph_deadline = microtime(true) + 5.0;
        while (microtime(true) < $ph_deadline) {
            $all_done = true;
            foreach ($ph_files as $f) {
                clearstatcache(true, $f);
                if (!file_exists($f) || filesize($f) === 0) { $all_done = false; break; }
            }
            if ($all_done) break;
            usleep(200000);
        }
        $r = [];
        foreach ($ph_files as $pkey => $f) {
            clearstatcache(true, $f);
            $raw  = file_exists($f) ? trim((string)file_get_contents($f)) : '';
            @unlink($f);
            $code = (is_numeric($raw) && (int)$raw > 0) ? (int)$raw : null;
            switch ($pkey) {
                case 'ws':
                    $ok  = in_array($code, [101,400]);
                    $r['ws'] = ['ok'=>$ok,'code'=>$code,'name'=>'WebSocket','timeout'=>$code===null,
                        'detail'=>$code===null?'timeout':($code===101?'101 Switching Protocols':($code===400?'400 — routing OK':($code===502?'502 — upstream error':($code===404?'404 — route missing':"HTTP {$code}"))))];
                    break;
                case 'xhttp':
                    $ok  = in_array($code, [404,400,200]);
                    $r['xhttp'] = ['ok'=>$ok,'code'=>$code,'name'=>'XHTTP','timeout'=>$code===null,
                        'detail'=>$code===null?'timeout':(in_array($code,[404,400,200])?"HTTP {$code} — routing OK":($code===502?'502 — upstream error':"HTTP {$code}"))];
                    break;
                case 'httpupgrade':
                    $ok  = in_array($code, [502,400,200,101]);
                    $r['httpupgrade'] = ['ok'=>$ok,'code'=>$code,'name'=>'HTTPUpgrade','timeout'=>$code===null,
                        'detail'=>$code===null?'timeout':(in_array($code,[502,400,200,101])?"HTTP {$code} — reachable":($code===404?'404 — route missing':"HTTP {$code}"))];
                    break;
            }
        }
        $r['reality']    = ['ok'=>$reality_open,'code'=>null,'open'=>$reality_open,'name'=>"Reality ({$ph_raddr}:{$ph_rport})",'timeout'=>false,
                            'detail'=>$reality_open?'production Reality server reachable':'production Reality server UNREACHABLE — clients cannot connect'];
        $r['checked_at'] = date('Y-m-d H:i:s');
        api_ok($r);
        break;

    case 'service-health':
    case 'nat-health': // legacy alias — old NAT checks removed; xray proxies in
        // userspace (freedom outbound), so kernel NAT/MASQUERADE never decides
        // whether VPN clients get internet. The old check also ran iptables as
        // www-data (permission denied) and false-alarmed "NAT broken".
        $checks = [];

        // 1. Xray service (the edge inbounds for WS/XHTTP/HTTPUpgrade live here)
        $xr_active = trim((string)@shell_exec('systemctl is-active xray.service 2>/dev/null')) === 'active';
        $checks[] = ['label'=>'Xray service (edge)','ok'=>$xr_active,
            'detail'=>$xr_active?'active ✓':'xray.service not active — WS/XHTTP/HTTPUpgrade down',
            'fix'=>'systemctl restart xray'];

        // 2. Nginx (fronts all edge transports on :443 and serves the API)
        $ng_active = trim((string)@shell_exec('systemctl is-active nginx.service 2>/dev/null')) === 'active';
        $checks[] = ['label'=>'Nginx service','ok'=>$ng_active,
            'detail'=>$ng_active?'active ✓':'nginx not active — edge transports and API down',
            'fix'=>'systemctl restart nginx'];

        // 3. Xray edge inbounds listening (behind nginx on 127.0.0.1)
        $sh_inbounds = ['WS'=>10000,'XHTTP'=>10001,'HTTPUpgrade'=>10002];
        foreach ($sh_inbounds as $sh_name => $sh_port) {
            $sh_s = @fsockopen('127.0.0.1', $sh_port, $sh_e, $sh_err, 2);
            $sh_ok = ($sh_s !== false);
            if ($sh_ok) fclose($sh_s);
            $checks[] = ['label'=>"{$sh_name} inbound (127.0.0.1:{$sh_port})",'ok'=>$sh_ok,
                'detail'=>$sh_ok?'listening ✓':"port {$sh_port} closed — {$sh_name} transport down",
                'fix'=>'systemctl restart xray'];
        }

        // 4. Production Reality server (separate box clients connect to directly)
        $sh_db = open_analytics_db();
        $sh_bs = $sh_db->query("SELECT key,value FROM settings WHERE key IN ('bootstrap_address','bootstrap_port')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $sh_raddr = (string)($sh_bs['bootstrap_address'] ?? '178.104.77.231');
        $sh_rport = (int)($sh_bs['bootstrap_port'] ?? 443);
        $sh_rs = @fsockopen($sh_raddr, $sh_rport, $sh_e2, $sh_err2, 4);
        $sh_rok = ($sh_rs !== false);
        if ($sh_rok) fclose($sh_rs);
        $checks[] = ['label'=>"Reality server ({$sh_raddr}:{$sh_rport})",'ok'=>$sh_rok,
            'detail'=>$sh_rok?'reachable ✓':'UNREACHABLE — Reality clients cannot connect',
            'fix'=>"Check the Reality box: ssh {$sh_raddr} → systemctl status xray"];

        // 5. Server outbound internet (xray freedom outbound needs this)
        $sh_net = @fsockopen('1.1.1.1', 443, $sh_e3, $sh_err3, 3);
        $sh_net_ok = ($sh_net !== false);
        if ($sh_net_ok) fclose($sh_net);
        $checks[] = ['label'=>'Server outbound internet','ok'=>$sh_net_ok,
            'detail'=>$sh_net_ok?'reachable ✓':'No outbound connectivity — proxied traffic will fail'];

        // 6. TLS certificate expiry on :443
        $sh_cert = (string)@shell_exec("echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername edge.setalink.no 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null");
        $sh_days = null;
        if (preg_match('/notAfter=(.+)/', $sh_cert, $sh_m)) {
            $sh_exp = strtotime(trim($sh_m[1]));
            if ($sh_exp) $sh_days = (int)floor(($sh_exp - time()) / 86400);
        }
        $sh_cert_ok = ($sh_days === null) ? true : $sh_days > 14; // null = could not check, don't false-alarm
        $checks[] = ['label'=>'TLS certificate','ok'=>$sh_cert_ok,
            'detail'=>$sh_days===null?'could not check (non-blocking)':($sh_days>14?"expires in {$sh_days} days ✓":"expires in {$sh_days} days — renew now"),
            'fix'=>'certbot renew'];

        // 7. Disk space
        $sh_total = (float)@disk_total_space('/'); $sh_free = (float)@disk_free_space('/');
        $sh_used_pct = $sh_total > 0 ? round((1 - $sh_free / $sh_total) * 100) : 0;
        $sh_disk_ok = $sh_used_pct < 90;
        $checks[] = ['label'=>'Disk space','ok'=>$sh_disk_ok,
            'detail'=>"{$sh_used_pct}% used" . ($sh_disk_ok?' ✓':' — telemetry DB writes may fail'),
            'fix'=>'journalctl --vacuum-size=200M && apt-get clean'];

        $sh_fail = array_values(array_filter($checks, fn($c) => !$c['ok']));
        $overall_ok = count($sh_fail) === 0;
        $score = count($checks) ? (int)round((count($checks) - count($sh_fail)) / count($checks) * 100) : 0;
        api_ok(['ok'=>$overall_ok,'score'=>$score,'checks'=>$checks,'failing'=>count($sh_fail),'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'nat-repair':
        // Removed 2026-06-10: kernel NAT (ip_forward/MASQUERADE) is irrelevant to
        // xray's userspace proxying, and the old "NAT broken" warning it answered
        // was a www-data permission false positive. Use action=service-health.
        api_err('nat-repair removed — kernel NAT does not affect xray. Use service-health.');
        break;

    case 'sync-edge-config':
        // Reads bootstrap UUIDs from DB and rewrites the edge proxy Xray client lists.
        // www-data is allowed to run ONLY that script (see /etc/sudoers.d/setalink-webserver).
        $sync_wrapper = '/usr/local/sbin/setalink-sync-edge-config';
        if (!file_exists($sync_wrapper)) {
            api_error('Sync script not installed. Run: sudo bash /var/www/setalink/scripts/setup-sudoers.sh');
            break;
        }
        $raw = shell_exec('sudo ' . escapeshellarg($sync_wrapper) . ' 2>&1') ?: '';
        $out = array_values(array_filter(array_map('trim', explode("\n", $raw))));
        $kv = [];
        foreach ($out as $line) {
            if (preg_match('/^([A-Z_]+)=(.*)$/', $line, $m)) $kv[$m[1]] = $m[2];
        }
        if (isset($kv['ERROR'])) { api_error($kv['ERROR']); break; }
        $xray_ok = isset($kv['XRAY_OK']) && $kv['XRAY_OK'] === '1';
        api_ok(['ok' => $xray_ok, 'lines' => $out, 'synced_at' => date('Y-m-d H:i:s')]);
        break;

    case 'get-settings':
        $db = open_analytics_db();
        $rows = $db->query('SELECT key,value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
        api_ok(array_merge(['telegram_url'=>'https://t.me/SetaLink3','server_label'=>'RealGram VPN'], $rows));
        break;

    case 'iran-score':
        // Grades the BOOTSTRAP profile (settings table) — what clients actually
        // receive — not the local xray config, which is a different machine's
        // concern (production Reality runs on the bootstrap box, not here).
        $is_db = open_analytics_db();
        $is_bs = $is_db->query("SELECT key,value FROM settings WHERE key LIKE 'bootstrap_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
        $score = 0; $checks = [];
        $sni = (string)($is_bs['bootstrap_sni'] ?? '');
        // www.cloudflare.com confirmed working from Iran (2026-06-10);
        // www.microsoft.com kept as experimental fallback.
        $safe_snis = ['www.cloudflare.com','www.microsoft.com','www.apple.com','www.speedtest.net','www.google.com'];
        $sni_ok = in_array($sni, $safe_snis, true);
        $score += $sni_ok ? 30 : 0;
        $checks[] = ['label'=>'SNI not blocked in Iran','ok'=>$sni_ok,'detail'=>$sni ?: '—'];
        $port = (int)($is_bs['bootstrap_port'] ?? 0);
        $port_ok = ($port === 443);
        $score += $port_ok ? 20 : 0;
        $checks[] = ['label'=>'Reality port 443','ok'=>$port_ok,'detail'=>(string)$port];
        $flow = (string)($is_bs['bootstrap_flow'] ?? '');
        // The live Reality box runs WITHOUT flow (see project_reality_credentials);
        // score what is configured, label honestly.
        $flow_ok = ($flow === 'xtls-rprx-vision' || $flow === '');
        $score += $flow_ok ? 20 : 0;
        $checks[] = ['label'=>'Flow setting consistent','ok'=>$flow_ok,'detail'=>$flow !== '' ? $flow : '(none — matches live Reality box)'];
        $fp = (string)($is_bs['bootstrap_fp'] ?? '');
        $fp_ok = !empty($fp);
        $score += $fp_ok ? 15 : 0;
        $checks[] = ['label'=>'Fingerprint set','ok'=>$fp_ok,'detail'=>$fp ?: '—'];
        // Production Reality server reachable (the box clients connect to)
        $is_addr = (string)($is_bs['bootstrap_address'] ?? '178.104.77.231');
        $is_sock = @fsockopen($is_addr, $port ?: 443, $e, $err, 4);
        $is_up   = $is_sock !== false;
        if ($is_up) fclose($is_sock);
        $score += $is_up ? 15 : 0;
        $checks[] = ['label'=>"Reality server reachable ({$is_addr})",'ok'=>$is_up,'detail'=>$is_up?'reachable ✓':'UNREACHABLE — clients cannot connect'];
        $grade = $score>=90?'A':($score>=70?'B':($score>=50?'C':'F'));
        api_ok(['score'=>$score,'grade'=>$grade,'checks'=>$checks,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'iran-debug':
        // Aggregated Iran-specific diagnostics from connect_telemetry.
        $db = open_analytics_db();
        // Tunneled telemetry POSTs lose their real country (the geo lookup sees the
        // VPN exit IP, so country is blanked by design) — and this is an Iran-first
        // product, so untagged rows are overwhelmingly Iranian testers. Treat
        // empty-country rows as Iran alongside the geo/carrier-confirmed ones, but
        // exclude synthetic rows (the ratelimit-test node). Parenthesised so the
        // AND binds after the OR group when this clause is embedded in other WHEREs.
        $ir_where = "(country='IR' OR country IS NULL OR country=''
                     OR carrier_name LIKE '%Irancell%' OR carrier_name LIKE '%MCI%'
                     OR carrier_name LIKE '%Hamrah%' OR carrier_name LIKE '%Rightel%'
                     OR carrier_name LIKE '%Shatel%' OR carrier_name LIKE '%TCI%')
                     AND node_id != 'ratelimit-test'";

        // NOTE: connect_telemetry's timestamp column is created_at (NOT
        // recorded_at, which belongs to test_results), and the table has no
        // device_id column — telemetry is anonymous by design. Earlier this
        // block referenced both, so every query threw and the whole Iran Debug
        // page failed to load. Fixed to created_at + a real internet_ok metric.

        // SNI + protocol analysis
        $sni_rows = $db->query(
            "SELECT protocol, sni,
                    COUNT(*) as total,
                    SUM(CASE WHEN event='connect_ok' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN event!='connect_ok' THEN 1 ELSE 0 END) as fail,
                    AVG(CASE WHEN time_to_connect_ms>0 THEN time_to_connect_ms ELSE NULL END) as avg_latency,
                    AVG(CASE WHEN rtt_ms>0 THEN rtt_ms ELSE NULL END) as avg_rtt,
                    MAX(created_at) as last_seen
             FROM connect_telemetry
             WHERE $ir_where
             GROUP BY protocol, sni
             ORDER BY total DESC
             LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Last N failures with Iran context
        $error_rows = $db->query(
            "SELECT protocol, sni, error_category, failure_stage,
                    carrier_name, network_type, ip_version, nat_type,
                    platform, build_number, created_at as recorded_at
             FROM connect_telemetry
             WHERE event!='connect_ok' AND ($ir_where)
             ORDER BY created_at DESC
             LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Carrier/ISP breakdown
        $isp_rows = $db->query(
            "SELECT carrier_name as isp,
                    COUNT(*) as total,
                    SUM(CASE WHEN event='connect_ok' THEN 1 ELSE 0 END) as success,
                    AVG(CASE WHEN time_to_connect_ms>0 THEN time_to_connect_ms ELSE NULL END) as avg_latency,
                    MAX(created_at) as last_seen
             FROM connect_telemetry
             WHERE carrier_name != '' AND ($ir_where)
             GROUP BY carrier_name
             ORDER BY total DESC
             LIMIT 20"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Error category breakdown
        $error_patterns = $db->query(
            "SELECT error_category, failure_stage, COUNT(*) as cnt,
                    MAX(created_at) as last_seen
             FROM connect_telemetry
             WHERE event!='connect_ok' AND error_category!='' AND ($ir_where)
             GROUP BY error_category, failure_stage
             ORDER BY cnt DESC
             LIMIT 30"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Network type breakdown (WiFi vs mobile)
        $network_rows = $db->query(
            "SELECT network_type,
                    COUNT(*) as total,
                    SUM(CASE WHEN event='connect_ok' THEN 1 ELSE 0 END) as success,
                    AVG(CASE WHEN rtt_ms>0 THEN rtt_ms ELSE NULL END) as avg_rtt
             FROM connect_telemetry
             WHERE ($ir_where)
             GROUP BY network_type
             ORDER BY total DESC"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Overall Iran stats. No device_id in this table → count distinct SNIs
        // and report internet-failure volume instead of a (nonexistent) device
        // count, so the summary reflects real telemetry columns.
        $stats = $db->query(
            "SELECT COUNT(*) as total,
                    SUM(CASE WHEN event='connect_ok' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN internet_ok=0 THEN 1 ELSE 0 END) as no_internet,
                    COUNT(DISTINCT sni) as sni_count,
                    AVG(CASE WHEN rtt_ms>0 THEN rtt_ms ELSE NULL END) as avg_rtt,
                    MAX(created_at) as last_seen
             FROM connect_telemetry
             WHERE $ir_where"
        )->fetch(PDO::FETCH_ASSOC);

        $sni_rows = array_map(function($r) {
            $t = (int)$r['total'];
            $r['success_rate'] = $t > 0 ? round((int)$r['success'] / $t * 100) : null;
            $r['avg_latency']  = $r['avg_latency'] ? (int)round((float)$r['avg_latency']) : null;
            $r['avg_rtt']      = $r['avg_rtt']     ? (int)round((float)$r['avg_rtt'])     : null;
            return $r;
        }, $sni_rows);

        api_ok([
            'stats'          => $stats,
            'sni_analysis'   => $sni_rows,
            'errors'         => $error_rows,
            'error_patterns' => $error_patterns,
            'isp_breakdown'  => $isp_rows,
            'network_breakdown' => $network_rows,
            'checked_at'     => date('Y-m-d H:i:s'),
            'data_source'    => 'connect_telemetry',
        ]);
        break;

    case 'dns-probe':
        // Test DNS resolution against multiple resolvers with latency measurement.
        // Uses dig (preferred) with fallback to gethostbyname().
        $domains   = ['cloudflare.com', 'google.com'];
        $resolvers = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
        $has_dig   = (trim(shell_exec('which dig 2>/dev/null') ?: '') !== '');
        $probe_results = [];

        foreach ($resolvers as $ns) {
            $domain_results = [];
            foreach ($domains as $domain) {
                $t0 = microtime(true);
                if ($has_dig) {
                    $cmd = 'dig @' . escapeshellarg($ns) . ' ' . escapeshellarg($domain) . ' A +short +time=3 +tries=1 2>/dev/null';
                    $out = trim(shell_exec($cmd) ?: '');
                    $first = strtok($out, "\n");
                    $ok  = (bool)filter_var($first, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
                    $ip  = $ok ? (string)$first : '';
                } else {
                    $ip  = gethostbyname($domain);
                    $ok  = ($ip !== $domain) && (bool)filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
                }
                $ms = (int)round((microtime(true) - $t0) * 1000);
                $domain_results[] = ['domain'=>$domain,'ok'=>$ok,'latency_ms'=>$ms,'ip'=>$ok?$ip:''];
            }
            $all_ok = count(array_filter($domain_results, fn($r) => $r['ok'])) === count($domain_results);
            $avg_ms = count($domain_results) > 0
                ? (int)round(array_sum(array_column($domain_results,'latency_ms')) / count($domain_results))
                : 0;
            $probe_results[] = ['resolver'=>$ns,'ok'=>$all_ok,'avg_latency_ms'=>$avg_ms,'domains'=>$domain_results];
        }

        $overall_ok = count(array_filter($probe_results, fn($r) => $r['ok'])) > 0;
        api_ok(['ok'=>$overall_ok,'resolvers'=>$probe_results,'method'=>$has_dig?'dig':'gethostbyname','probed_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'iran-device-failures':
        // Per-device failure categories for Iranian devices (from devices table).
        // Shows source IP (client) vs country. Does NOT confuse with VPN exit IP.
        $db = open_analytics_db();
        init_device_tables($db);
        $rows = $db->query(
            "SELECT device_id, user_id, last_ip, country, country_name, model, manufacturer,
                    active_protocol, active_sni, internet_ok, dns_ok,
                    last_failure_category, last_failure_at, last_seen, status,
                    rx_bytes, tx_bytes, latency_ms
             FROM devices
             WHERE UPPER(country) IN ('IR','IRN')
                OR country_name LIKE '%Iran%'
             ORDER BY last_seen DESC
             LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        // Category summary
        $cats = [];
        foreach ($rows as $r) {
            $c = $r['last_failure_category'] ?: 'none';
            $cats[$c] = ($cats[$c] ?? 0) + 1;
        }
        arsort($cats);
        api_ok([
            'devices'          => $rows,
            'category_summary' => $cats,
            'total'            => count($rows),
            'checked_at'       => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'iran-transport-stats':
        // Success rate per transport type for Iranian traffic.
        // Derived from test_results + per-device active_protocol.
        $db = open_analytics_db();
        // From telemetry (test_results)
        $tel = $db->query(
            "SELECT
               CASE
                 WHEN protocol LIKE '%Reality%'     THEN 'Reality'
                 WHEN protocol LIKE '%XHTTP%'       OR protocol LIKE '%SplitHTTP%' THEN 'XHTTP'
                 WHEN protocol LIKE '%WebSocket%'   OR protocol LIKE '%WS%'        THEN 'WebSocket'
                 WHEN protocol LIKE '%HTTPUpgrade%' OR protocol LIKE '%HTTPUp%'    THEN 'HTTPUpgrade'
                 ELSE 'Other'
               END as transport,
               COUNT(*) as total,
               SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok,
               SUM(no_internet) as no_internet,
               AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
               MAX(recorded_at) as last_seen
             FROM test_results
             WHERE country LIKE '%Iran%' OR country='IR'
                OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                OR network LIKE '%MCI%' OR network LIKE '%Mobin%'
                OR network LIKE '%Shatel%' OR network LIKE '%Rightel%'
             GROUP BY transport
             ORDER BY success DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        // From live devices (current active transport)
        $live = $db->query(
            "SELECT
               CASE
                 WHEN active_protocol LIKE '%Reality%'     THEN 'Reality'
                 WHEN active_protocol LIKE '%XHTTP%'       THEN 'XHTTP'
                 WHEN active_protocol LIKE '%WebSocket%'   OR active_protocol LIKE '%WS%' THEN 'WebSocket'
                 WHEN active_protocol LIKE '%HTTPUpgrade%' THEN 'HTTPUpgrade'
                 ELSE 'Other'
               END as transport,
               COUNT(*) as devices,
               SUM(internet_ok) as routed_ok,
               SUM(CASE WHEN last_failure_category!='' THEN 1 ELSE 0 END) as with_failures
             FROM devices
             WHERE (UPPER(country) IN ('IR','IRN') OR country_name LIKE '%Iran%')
               AND active_protocol != ''
             GROUP BY transport
             ORDER BY devices DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        $tel = array_map(function($r) {
            $t = (int)$r['total'];
            $r['success_rate'] = $t > 0 ? round((int)$r['success'] / $t * 100) : null;
            $r['avg_latency']  = $r['avg_latency'] ? (int)round((float)$r['avg_latency']) : null;
            return $r;
        }, $tel);
        api_ok(['telemetry'=>$tel,'live_devices'=>$live,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'active-sessions':
        // DB-driven. The old version parsed /var/log/xray/access.log, which is
        // (a) root-only — unreadable as www-data, and (b) useless here anyway:
        // nginx fronts every inbound, so xray logs all real users as 127.0.0.1
        // and the old localhost filter discarded 100% of genuine traffic.
        $db = open_analytics_db();
        init_device_tables($db);
        $as_devices = $db->query("
            SELECT active_protocol, country, COUNT(*) AS cnt
            FROM devices
            WHERE status='online' AND last_seen >= datetime('now','-180 minutes')
            GROUP BY active_protocol, country")->fetchAll(PDO::FETCH_ASSOC);
        $protocols = []; $countries = []; $online = 0;
        foreach ($as_devices as $as_r) {
            $online += (int)$as_r['cnt'];
            $as_p = $as_r['active_protocol'] ?: 'unknown';
            $as_c = strtoupper($as_r['country'] ?: '??');
            $protocols[$as_p] = ($protocols[$as_p] ?? 0) + (int)$as_r['cnt'];
            $countries[$as_c] = ($countries[$as_c] ?? 0) + (int)$as_r['cnt'];
        }
        arsort($protocols); arsort($countries);
        $as_sess = $db->query("
            SELECT COUNT(*) AS cnt, COALESCE(SUM(bytes_sent+bytes_recv),0) AS bytes
            FROM vpn_sessions WHERE started_at >= datetime('now','-1 day')")->fetch(PDO::FETCH_ASSOC) ?: ['cnt'=>0,'bytes'=>0];
        api_ok([
            'online_devices'   => $online,
            'protocols'        => $protocols,
            'countries'        => $countries,
            'sessions_24h'     => (int)$as_sess['cnt'],
            'bytes_24h'        => (int)$as_sess['bytes'],
            'window_seconds'   => 300,
            'checked_at'       => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'profile-stats':
        $db = open_analytics_db();
        $rows = $db->query(
            'SELECT protocol,sni,result,COUNT(*) as cnt
             FROM test_results GROUP BY protocol,sni,result ORDER BY protocol,sni'
        )->fetchAll(PDO::FETCH_ASSOC);
        $agg = [];
        foreach ($rows as $r) {
            $key = ($r['protocol'] ?? 'unknown') . '/' . ($r['sni'] ?? '');
            if (!isset($agg[$key])) $agg[$key] = ['protocol'=>$r['protocol'],'sni'=>$r['sni'],'success'=>0,'fail'=>0];
            if ($r['result'] === 'success') $agg[$key]['success'] += (int)$r['cnt'];
            else $agg[$key]['fail'] += (int)$r['cnt'];
        }
        foreach ($agg as &$a) {
            $total = $a['success'] + $a['fail'];
            $a['total'] = $total;
            $a['pct']   = $total > 0 ? round($a['success'] / $total * 100) : null;
        }
        api_ok(array_values($agg));
        break;

    case 'learning-stats':
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT protocol,sni,mode,country,
                    COUNT(*) as total,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok,
                    SUM(no_internet) as no_internet_cnt,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    MAX(recorded_at) as last_seen
             FROM test_results
             GROUP BY protocol,sni,mode,country
             ORDER BY connected DESC,probe_ok DESC
             LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(array_map(function($r) {
            $t = (int)$r['total'];
            $c = (int)$r['connected'];
            return ['protocol'=>$r['protocol'],'sni'=>$r['sni'],'mode'=>$r['mode'],'country'=>$r['country'],
                    'total'=>$t,'connected'=>$c,'probe_ok'=>(int)$r['probe_ok'],
                    'no_internet'=>(int)$r['no_internet_cnt'],
                    'connect_rate'=>$t>0?round($c/$t*100):null,
                    'avg_latency'=>$r['avg_latency']?(int)round((float)$r['avg_latency']):null,
                    'last_seen'=>$r['last_seen']];
        }, $rows));
        break;

    case 'sni-leaderboard':
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT sni,COUNT(*) as total,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    COUNT(DISTINCT device_model) as device_count
             FROM test_results WHERE sni!=''
             GROUP BY sni HAVING total>=2
             ORDER BY connected DESC,probe_ok DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(array_map(function($r) {
            $t = (int)$r['total']; $c = (int)$r['connected'];
            return ['sni'=>$r['sni'],'total'=>$t,'connected'=>$c,'probe_ok'=>(int)$r['probe_ok'],
                    'connect_rate'=>$t>0?round($c/$t*100):null,
                    'avg_latency'=>$r['avg_latency']?(int)round((float)$r['avg_latency']):null,
                    'devices'=>(int)$r['device_count']];
        }, $rows));
        break;

    case 'device-breakdown':
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT android_version,device_model,
                    COUNT(*) as attempts,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(no_internet) as no_internet_cnt,
                    MAX(recorded_at) as last_seen
             FROM test_results WHERE device_model!='' OR android_version!=''
             GROUP BY android_version,device_model
             ORDER BY attempts DESC LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok($rows);
        break;

    case 'no-internet-analysis':
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT protocol,sni,android_version,
                    COUNT(*) as total,
                    SUM(no_internet) as no_internet_cnt,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok_cnt,
                    MAX(recorded_at) as last_seen
             FROM test_results WHERE tcp_ok=1
             GROUP BY protocol,sni,android_version
             HAVING total>=2
             ORDER BY no_internet_cnt DESC LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok($rows);
        break;

    case 'transport-mismatch':
        $db = open_analytics_db();
        // Group failures by category + protocol + sni in last 48h
        $rows = $db->query(
            "SELECT failure_category, protocol, sni,
                    COUNT(*) as cnt,
                    MAX(error_msg) as last_error,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE failure_category != ''
               AND recorded_at >= datetime('now', '-48 hours')
               AND result = 'fail'
             GROUP BY failure_category, protocol, sni
             ORDER BY cnt DESC LIMIT 60"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Build actionable warnings
        $warnings = [];
        foreach ($rows as $r) {
            switch ($r['failure_category']) {
                case 'xhttp_path_mismatch':
                    $warnings[] = [
                        'level'  => 'error',
                        'label'  => 'XHTTP path mismatch',
                        'detail' => "Path mismatch on /xhttp/ — {$r['cnt']} failures. Ensure xhttpPath in bootstrap has trailing slash (/xhttp/ not /xhttp).",
                    ];
                    break;
                case 'ws_upgrade_failed':
                    $warnings[] = [
                        'level'  => 'warn',
                        'label'  => 'WebSocket upgrade rejected',
                        'detail' => "Server not accepting WS Upgrade header — {$r['cnt']} failures. Check nginx edge vhost is not using http2.",
                    ];
                    break;
                case 'reality_clienthello_failed':
                    $warnings[] = [
                        'level'  => 'warn',
                        'label'  => 'Reality ClientHello failures',
                        'detail' => "Server rejected ClientHello — {$r['cnt']} failures. Likely a probe or fingerprint issue, not an Iran block.",
                    ];
                    break;
                case 'socks_probe_timeout':
                    $warnings[] = [
                        'level'  => 'warn',
                        'label'  => 'SOCKS5 probe timeouts',
                        'detail' => "Internet probe through tunnel timed out — {$r['cnt']} failures. Validate 1.1.1.1/cdn-cgi/trace is reachable from VPS.",
                    ];
                    break;
            }
        }
        api_ok(['rows' => $rows, 'warnings' => array_values(array_unique($warnings, SORT_REGULAR))]);
        break;

    case 'get-remote-config':
        $db = open_analytics_db();
        $rows = $db->query("SELECT key,value FROM settings")->fetchAll(PDO::FETCH_KEY_PAIR);
        $decode = function(string $key, mixed $def) use ($rows): mixed {
            if (!isset($rows[$key])) return $def;
            $v = json_decode($rows[$key], true);
            return ($v !== null) ? $v : $rows[$key];
        };
        api_ok([
            'version'                => (int)($rows['rc_version'] ?? 1),
            'sni_priorities'         => $decode('rc_sni_priorities', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'kill_switches'          => $decode('rc_kill_switches',  []),
            'protocol_order'         => $decode('rc_protocol_order', ['Reality','XHTTP','WebSocket']),
            'emergency_sni'          => (string)($rows['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order'         => $decode('rc_iran_sni_order', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'ttl'                    => (int)($rows['rc_ttl'] ?? 3600),
            'updated_at'             => (string)($rows['rc_updated_at'] ?? ''),
            'support_url'            => (string)($rows['support_url'] ?? 'https://t.me/SetaLink3'),
            'edge_host'              => (string)($rows['edge_host'] ?? 'edge.setalink.no'),
            'emergency_profiles'     => $decode('rc_emergency_profiles', []),
            'stealth_profiles'       => $decode('rc_stealth_profiles', []),
            'update_required'        => (bool)(int)($rows['rc_update_required'] ?? '0'),
            'min_supported_version'  => (string)($rows['rc_min_supported'] ?? '0.9.7'),
            'profile_bundle_version' => (int)($rows['rc_profile_bundle_version'] ?? 1),
            'bootstrap'              => fetch_bootstrap_server($db),
        ]);
        break;

    case 'real-redemptions':
        // REAL token economy — ledger + rates. Pending rows are reviewed via
        // real-redemption-approve/-reject (ECOSYSTEM_INTEGRATION_PLAN.md A2).
        $db = open_analytics_db();
        re_ensure_schema($db);
        api_ok([
            'settings'         => re_settings($db),
            'redemptions'      => re_list($db, (int)($_GET['limit'] ?? 100)),
            // B-2 configured status only, never the secret values.
            'ecosystem_status' => re_ecosystem_status($db),
        ]);
        break;

    case 'ecosystem-analytics':
        // Adoption metrics for the ecosystem banner (plan item B4): clicks per
        // promo, so campaigns pushed via rc_ecosystem_promos are measurable.
        $db = open_analytics_db();
        $clicks = [];
        try {
            $clicks = $db->query("
                SELECT COALESCE(json_extract(props,'\$.promo'),'') AS promo,
                       COUNT(*) AS clicks,
                       COUNT(DISTINCT device_id) AS devices,
                       MAX(created_at) AS last_click
                FROM app_events
                WHERE event='ecosystem_banner_click'
                  AND created_at >= datetime('now','-30 days')
                GROUP BY promo ORDER BY clicks DESC
            ")->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Exception $e) { /* app_events may not exist yet */ }
        api_ok(['clicks_30d' => $clicks]);
        break;

    case 'app-analytics':
        $db = open_analytics_db();
        init_device_tables($db);
        $total       = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
        // Online = recent heartbeat only. The stored status flag sticks at 'online'
        // when the app is killed without an offline event, inflating the count.
        $onlineNow   = (int)$db->query("SELECT COUNT(*) FROM devices WHERE status='online' AND last_seen>=datetime('now','-180 minutes')")->fetchColumn();
        $activeToday = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen>=date('now')")->fetchColumn();
        $active7d    = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen>=datetime('now','-7 days')")->fetchColumn();
        $newMonth    = (int)$db->query("SELECT COUNT(*) FROM devices WHERE created_at>=datetime('now','-30 days')")->fetchColumn();
        $failed      = (int)$db->query("SELECT COUNT(*) FROM test_results WHERE result='fail' AND recorded_at>=datetime('now','-1 day')")->fetchColumn();
        $blocked     = (int)$db->query("SELECT COUNT(*) FROM devices WHERE blocked=1")->fetchColumn();
        $pkgRows     = $db->query("SELECT plan,COUNT(*) as cnt FROM devices GROUP BY plan ORDER BY cnt DESC")->fetchAll(PDO::FETCH_ASSOC);
        $verRows     = $db->query("SELECT app_version as version,COUNT(*) as cnt FROM devices WHERE app_version!='' GROUP BY app_version ORDER BY cnt DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);

        // Platform breakdown — detect iOS from platform field or Apple hardware signals.
        $platRows = $db->query("SELECT platform, manufacturer, model FROM devices")->fetchAll(PDO::FETCH_ASSOC);
        $iosCnt = $androidCnt = $unknownCnt = 0;
        foreach ($platRows as $pr) {
            $p = normalize_platform($pr);
            if ($p === 'ios')         $iosCnt++;
            elseif ($p === 'android') $androidCnt++;
            else                      $unknownCnt++;
        }

        // iOS version distribution (app version on iOS devices).
        $iosVerRows = $db->query("
            SELECT app_version AS version, COUNT(*) AS cnt
            FROM devices
            WHERE platform='ios' OR LOWER(manufacturer)='apple'
                  OR LOWER(model) LIKE 'iphone%' OR LOWER(model) LIKE 'ipad%'
            GROUP BY app_version ORDER BY cnt DESC LIMIT 10
        ")->fetchAll(PDO::FETCH_ASSOC);

        // iOS last-seen (most recent active iOS devices).
        $iosRecentRows = $db->query("
            SELECT device_id, app_version, last_seen, model
            FROM devices
            WHERE platform='ios' OR LOWER(manufacturer)='apple'
                  OR LOWER(model) LIKE 'iphone%' OR LOWER(model) LIKE 'ipad%'
            ORDER BY last_seen DESC LIMIT 10
        ")->fetchAll(PDO::FETCH_ASSOC);

        // iOS tunnel stats from vpn_sessions.
        $iosSessions = $db->query("
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN probe_result='ok'   THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN probe_result!='ok' AND probe_result!='' THEN 1 ELSE 0 END) AS fail,
                SUM(CASE WHEN probe_result='' OR probe_result IS NULL THEN 1 ELSE 0 END) AS unknown
            FROM vpn_sessions vs
            JOIN devices d ON d.device_id = vs.device_id
            WHERE d.platform='ios' OR LOWER(d.manufacturer)='apple'
                  OR LOWER(d.model) LIKE 'iphone%' OR LOWER(d.model) LIKE 'ipad%'
        ")->fetch(PDO::FETCH_ASSOC);

        // iOS stage failure breakdown from tunnel logs directory.
        $tlDir = dirname(__DIR__) . '/data/tunnel-logs';
        $iosStageBreakdown = [];
        if (is_dir($tlDir)) {
            foreach (glob($tlDir . '/*.meta.json') ?: [] as $mf) {
                $m = json_decode(file_get_contents($mf), true);
                if (!is_array($m)) continue;
                if (($m['success'] ?? true) === true) continue; // only failures
                $err = (string)($m['error'] ?? '');
                // Classify by error string into stage bucket.
                if (strpos($err, 'socketpair') !== false)           $bucket = 'HEV bridge (socketpair)';
                elseif (strpos($err, 'status=204') !== false)       $bucket = 'Proxy probe status=204';
                elseif (strpos($err, 'Proxy probe') !== false)      $bucket = 'Proxy probe failed';
                elseif (strpos($err, 'SOCKS5') !== false)           $bucket = 'SOCKS5 probe failed';
                elseif (strpos($err, 'ATS') !== false || strpos($err, 'App Transport') !== false) $bucket = 'ATS block (HTTP probe)';
                elseif (strpos($err, 'DNS') !== false)              $bucket = 'DNS unknown';
                elseif (strpos($err, 'kCFErrorDomainCFNetwork') !== false) $bucket = 'CFNetwork timeout';
                elseif ($err !== '')                                $bucket = 'Other: '.substr($err,0,40);
                else                                                $bucket = 'Unknown';
                $iosStageBreakdown[$bucket] = ($iosStageBreakdown[$bucket] ?? 0) + 1;
            }
            arsort($iosStageBreakdown);
        }

        api_ok([
            'total_installs'       => $total,
            'online_now'           => $onlineNow,
            'active_today'         => $activeToday,
            'active_7d'            => $active7d,
            'new_this_month'       => $newMonth,
            'failed_24h'           => $failed,
            'blocked'              => $blocked,
            'package_distribution' => array_column($pkgRows, 'cnt', 'plan'),
            'version_distribution' => $verRows,
            'platform_counts'      => ['ios' => $iosCnt, 'android' => $androidCnt, 'unknown' => $unknownCnt],
            'ios_version_distribution' => $iosVerRows,
            'ios_recent_devices'   => $iosRecentRows,
            'ios_tunnel_stats'     => $iosSessions,
            'ios_stage_breakdown'  => $iosStageBreakdown,
        ]);
        break;

    case 'dash-timeseries':
        // 30-day daily series for the Analytics charts. Built from existing
        // timestamp columns (no extra logging) — new installs, VPN sessions,
        // data volume, plus a 30-day protocol mix. A contiguous date axis is
        // generated in PHP so days with zero activity still render on the chart.
        $db = open_analytics_db();
        init_device_tables($db);
        // vpn_sessions is normally created by public/api.php on first session;
        // create it defensively so the charts render on a fresh analytics DB.
        $db->exec("CREATE TABLE IF NOT EXISTS vpn_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT, protocol TEXT,
            bytes_sent INTEGER DEFAULT 0, bytes_recv INTEGER DEFAULT 0,
            duration_secs INTEGER DEFAULT 0, app_version TEXT DEFAULT '',
            probe_result TEXT DEFAULT 'unknown', error_reason TEXT DEFAULT '',
            started_at TEXT, ended_at TEXT DEFAULT (datetime('now')), client_ip TEXT DEFAULT ''
        )");

        $ts_days = (int)($_GET['days'] ?? 30);
        if ($ts_days < 7)   $ts_days = 7;
        if ($ts_days > 180) $ts_days = 180;

        // Contiguous axis: oldest → today (UTC, matching datetime('now')).
        $axis = [];
        $idx  = [];
        for ($i = $ts_days - 1; $i >= 0; $i--) {
            $d = gmdate('Y-m-d', strtotime("-$i days"));
            $idx[$d] = count($axis);
            $axis[]  = $d;
        }
        $fill = function (string $sql) use ($db, $axis, $idx): array {
            $out = array_fill(0, count($axis), 0);
            foreach ($db->query($sql) as $row) {
                $d = (string)$row['d'];
                if (isset($idx[$d])) $out[$idx[$d]] = (float)$row['v'] + 0;
            }
            return $out;
        };

        $since = "datetime('now','-" . $ts_days . " days')";

        $installs = $fill("SELECT date(created_at) d, COUNT(*) v FROM devices
                           WHERE created_at >= $since GROUP BY d");
        $sessions = $fill("SELECT date(COALESCE(started_at,ended_at)) d, COUNT(*) v FROM vpn_sessions
                           WHERE COALESCE(started_at,ended_at) >= $since GROUP BY d");
        // Bytes → GB, rounded to 2 decimals client-side; send raw GB float here.
        $gb_raw   = $fill("SELECT date(COALESCE(started_at,ended_at)) d,
                                  SUM(bytes_sent+bytes_recv)/1073741824.0 v FROM vpn_sessions
                           WHERE COALESCE(started_at,ended_at) >= $since GROUP BY d");
        $gb = array_map(function ($x) { return round($x, 3); }, $gb_raw);

        // 30-day protocol mix from real sessions (doughnut).
        $ts_proto = [];
        foreach ($db->query("SELECT COALESCE(NULLIF(protocol,''),'unknown') p, COUNT(*) c
                             FROM vpn_sessions WHERE COALESCE(started_at,ended_at) >= $since
                             GROUP BY 1 ORDER BY c DESC") as $pr) {
            $ts_proto[(string)$pr['p']] = (int)$pr['c'];
        }

        api_ok([
            'days'         => $axis,
            'installs'     => $installs,
            'sessions'     => $sessions,
            'gb'           => $gb,
            'protocol_mix' => $ts_proto,
            'window_days'  => $ts_days,
            'checked_at'   => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'ads-metrics':
        // Rewarded-ads revenue + recovery-quota overview for the admin dashboard.
        // All numbers derive from ad_reward_events / recovery_sessions / the ledger;
        // revenue & cost are estimates driven by remote config (ecpm, egress cost).
        $db = open_analytics_db();
        ar_init_tables($db);
        $cfg = ar_config($db);

        $confirmed = "status='confirmed'";
        $cnt = function (string $extra) use ($db, $confirmed): int {
            return (int)$db->query("SELECT COUNT(*) FROM ad_reward_events WHERE $confirmed $extra")->fetchColumn();
        };
        $ads_today = $cnt("AND confirmed_at >= date('now')");
        $ads_7d    = $cnt("AND confirmed_at >= datetime('now','-7 days')");
        $ads_30d   = $cnt("AND confirmed_at >= datetime('now','-30 days')");
        $ads_all   = $cnt("");

        // GB granted from ads (ledger is source of truth for granted bytes).
        $ad_granted_bytes = (int)$db->query(
            "SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE type='ad_reward'")->fetchColumn();
        // Recovery GB used (metered against the hidden reserve).
        $recovery_used_bytes = (int)$db->query(
            "SELECT COALESCE(SUM(recovery_used_bytes),0) FROM devices")->fetchColumn();
        // Distinct devices that ever entered recovery = saved from zero-data deadlock.
        $users_saved = (int)$db->query(
            "SELECT COUNT(DISTINCT device_id) FROM recovery_sessions")->fetchColumn();
        // Suspicious events awaiting review.
        $review_cnt = (int)$db->query(
            "SELECT COUNT(*) FROM ad_reward_events WHERE status='review'")->fetchColumn();
        $review = $db->query(
            "SELECT device_id, nonce, risk_score, risk_flags, source, created_at
             FROM ad_reward_events WHERE status='review' ORDER BY id DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);

        // Revenue / cost estimates.
        $ecpm     = (float)$cfg['ecpm_usd'];
        $cost_gb  = (float)$cfg['egress_cost_per_gb_usd'];
        $rev_all  = round($ads_all * $ecpm / 1000, 2);
        $rev_30d  = round($ads_30d * $ecpm / 1000, 2);
        $ad_gb    = $ad_granted_bytes / 1073741824.0;
        $rev_per_gb = $ad_gb > 0 ? round($rev_all / $ad_gb, 4) : 0.0;

        // 30-day contiguous ads/day series + reward GB/day.
        $axis = []; $idx = [];
        for ($i = 29; $i >= 0; $i--) { $d = gmdate('Y-m-d', strtotime("-$i days")); $idx[$d] = count($axis); $axis[] = $d; }
        $series = array_fill(0, count($axis), 0);
        foreach ($db->query("SELECT date(confirmed_at) d, COUNT(*) c FROM ad_reward_events
                             WHERE status='confirmed' AND confirmed_at >= datetime('now','-30 days')
                             GROUP BY d") as $r) {
            if (isset($idx[(string)$r['d']])) $series[$idx[(string)$r['d']]] = (int)$r['c'];
        }

        api_ok([
            'ads_watched'      => ['today' => $ads_today, 'week' => $ads_7d, 'month' => $ads_30d, 'all' => $ads_all],
            'est_revenue_usd'  => ['month' => $rev_30d, 'all' => $rev_all],
            'ad_gb_granted'    => round($ad_gb, 3),
            'recovery_gb_used' => round($recovery_used_bytes / 1073741824.0, 3),
            'users_saved'      => $users_saved,
            'review_count'     => $review_cnt,
            'review'           => $review,
            'revenue_per_gb'   => $rev_per_gb,
            'cost_per_gb'      => $cost_gb,
            'config'           => [
                'ecpm_usd'                  => $ecpm,
                'egress_cost_per_gb_usd'    => $cost_gb,
                'ad_reward_bytes'           => (int)$cfg['ad_reward_bytes'],
                'ad_daily_cap'              => (int)$cfg['ad_daily_cap'],
                'ad_cooldown_secs'          => (int)$cfg['ad_cooldown_secs'],
                'hidden_recovery_bytes'     => (int)$cfg['hidden_recovery_bytes'],
                'recovery_throttle_kbps'    => (int)$cfg['recovery_throttle_kbps'],
                'admob_ssv_enabled'         => (int)$cfg['admob_ssv_enabled'],
                'admob_configured'          => ($cfg['admob_rewarded_unit_id'] !== '' ? 1 : 0),
                'recovery_node_configured'  => ($cfg['recovery_exit_uuid'] !== '' ? 1 : 0),
            ],
            'days'             => $axis,
            'ads_series'       => $series,
            // Raw editable config (admin-only surface) for the inline config form.
            'editable'         => array_intersect_key($cfg, ar_defaults()),
            'checked_at'       => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'ads-perf-comparison':
        // Full Ads Performance NOC: AdsGram vs AdMob, all KPIs, alerts, Hakim.
        $db  = open_analytics_db();
        ar_init_tables($db);
        adp_init_table($db);   // also runs adp_ensure_linked_at migration
        $cfg  = ar_config($db);
        $ecpm = (float)$cfg['ecpm_usd'];

        // Window: from/to dates (custom range) or days count
        $from_raw = trim($_GET['from'] ?? '');
        $to_raw   = trim($_GET['to']   ?? '');
        if ($from_raw && $to_raw
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from_raw)
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to_raw)) {
            $from_ts = strtotime($from_raw);
            $to_ts   = strtotime($to_raw);
            $days    = max(1, (int)(($to_ts - $from_ts) / 86400) + 1);
        } else {
            $days_raw = (int)($_GET['days'] ?? 30);
            $days     = max(1, min(90, $days_raw));
            $from_raw = gmdate('Y-m-d', strtotime("-{$days} days"));
            $to_raw   = gmdate('Y-m-d');
        }

        // Date axis
        $axis = []; $ts = strtotime($from_raw);
        while (gmdate('Y-m-d', $ts) <= $to_raw) { $axis[] = gmdate('Y-m-d', $ts); $ts += 86400; }

        // Full-window series
        $admob   = adp_admob_series($db, $days, $ecpm);
        $adsgram = adp_adsgram_series($db, $days);

        // Sub-window totals: today + last 7d
        $am_today = adp_totals(array_filter($admob,   fn($d, $k) => $k === gmdate('Y-m-d'), ARRAY_FILTER_USE_BOTH));
        $ag_today = adp_totals(array_filter($adsgram, fn($d, $k) => $k === gmdate('Y-m-d'), ARRAY_FILTER_USE_BOTH));
        $cutoff7  = gmdate('Y-m-d', strtotime('-7 days'));
        $am_7d    = adp_totals(array_filter($admob,   fn($d, $k) => $k >= $cutoff7, ARRAY_FILTER_USE_BOTH));
        $ag_7d    = adp_totals(array_filter($adsgram, fn($d, $k) => $k >= $cutoff7, ARRAY_FILTER_USE_BOTH));

        // Conversion
        $total_devices  = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
        $linked_devices = (int)$db->query(
            "SELECT COUNT(*) FROM devices WHERE linked_real_account IS NOT NULL AND linked_real_account <> ''"
        )->fetchColumn();
        $conv_series = adp_conversion_series($db, $days);
        $conv_7d     = (int)$db->query("SELECT COUNT(*) FROM devices WHERE real_linked_at >= datetime('now','-7 days')")->fetchColumn();

        // Build chart series aligned to axis
        $am_views=$ag_views=$am_rev=$ag_rev=$am_ecpm=$ag_ecpm=
        $am_fill=$ag_fill=$am_gb=$ag_gb=$am_arpdau=$ag_arpdau=$conv_daily=[];
        foreach ($axis as $d) {
            $am = $admob[$d]   ?? null;
            $ag = $adsgram[$d] ?? null;
            $am_views[]   = $am ? $am['rewarded_views'] : 0;
            $ag_views[]   = $ag ? $ag['rewarded_views'] : 0;
            $am_rev[]     = $am ? round($am['revenue_usd'], 4) : 0;
            $ag_rev[]     = $ag ? round($ag['revenue_usd'], 4) : 0;
            $am_ecpm[]    = $am && $am['rewarded_views'] > 0 ? round($am['ecpm_usd'], 2) : null;
            $ag_ecpm[]    = $ag && $ag['rewarded_views'] > 0 ? round($ag['ecpm_usd'], 2) : null;
            $am_fill[]    = null;  // not capturable from SSV events
            $ag_fill[]    = $ag ? ($ag['fill_rate'] > 0 ? round($ag['fill_rate'], 4) : null) : null;
            $am_gb[]      = $am ? round($am['gb_granted'], 4) : 0;
            $ag_gb[]      = $ag ? round($ag['gb_granted'], 4) : 0;
            $au_am        = $am ? (int)$am['active_users'] : 0;
            $am_arpdau[]  = $am && $au_am > 0 ? round($am['revenue_usd'] / $au_am, 4) : null;
            $au_ag        = $ag ? (int)$ag['active_users'] : 0;
            $ag_arpdau[]  = $ag && $au_ag > 0 ? round($ag['revenue_usd'] / $au_ag, 4) : null;
            $conv_daily[] = (int)($conv_series[$d] ?? 0);
        }

        $ag_has_data = !empty($adsgram);

        api_ok([
            'days'       => $axis,
            'window'     => ['days' => $days, 'from' => $from_raw, 'to' => $to_raw],
            'admob' => [
                'today'        => $am_today,
                '7d'           => $am_7d,
                'totals'       => adp_totals($admob),
                'views_series' => $am_views,
                'rev_series'   => $am_rev,
                'ecpm_series'  => $am_ecpm,
                'fill_series'  => $am_fill,
                'gb_series'    => $am_gb,
                'arpdau_series'=> $am_arpdau,
            ],
            'adsgram' => [
                'today'        => $ag_today,
                '7d'           => $ag_7d,
                'totals'       => adp_totals($adsgram),
                'has_data'     => $ag_has_data,
                'views_series' => $ag_views,
                'rev_series'   => $ag_rev,
                'ecpm_series'  => $ag_ecpm,
                'fill_series'  => $ag_fill,
                'gb_series'    => $ag_gb,
                'arpdau_series'=> $ag_arpdau,
            ],
            'conversion' => [
                'total_devices'  => $total_devices,
                'linked_devices' => $linked_devices,
                'linked_7d'      => $conv_7d,
                'rate'           => $total_devices > 0 ? round($linked_devices/$total_devices, 4) : 0.0,
                'daily_series'   => $conv_daily,
            ],
            'alerts'     => adp_alerts($db, $ecpm),
            'hakim'      => adp_hakim(adp_totals($admob), adp_totals($adsgram), $ag_has_data, $days),
            'checked_at' => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'banner-ads-stats':
        // Banner Ads section (Khabat, 2026-07-19): Home banner vs Freedom banner,
        // per-placement funnel (Requests -> Loaded -> Impressions -> Clicks),
        // CTR, revenue (summed from AdMob's onPaid, already in app_events via
        // TrackedBannerAd.tsx), and no-fill rate — this is the AdMob NATIVE
        // banner data the rewarded/AdsGram-focused NOC above doesn't cover.
        // Same window convention as ads-perf-comparison (from/to or days).
        $db = open_analytics_db();
        $from_raw = trim($_GET['from'] ?? '');
        $to_raw   = trim($_GET['to']   ?? '');
        if ($from_raw && $to_raw
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from_raw)
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to_raw)) {
            // as-is
        } else {
            $days_raw = (int)($_GET['days'] ?? 30);
            $days     = max(1, min(90, $days_raw));
            $from_raw = gmdate('Y-m-d', strtotime("-{$days} days"));
            $to_raw   = gmdate('Y-m-d');
        }
        $fromDt = $from_raw . ' 00:00:00';
        $toDt   = gmdate('Y-m-d', strtotime($to_raw) + 86400) . ' 00:00:00'; // exclusive

        $slots = ['home_banner' => [], 'freedom_banner' => [], 'inbox_banner' => []];
        try {
            $st = $db->prepare("
                SELECT
                    json_extract(props,'\$.slot') AS slot,
                    SUM(CASE WHEN event='AD_BANNER_REQUEST'    THEN 1 ELSE 0 END) AS requests,
                    SUM(CASE WHEN event='AD_BANNER_LOADED'     THEN 1 ELSE 0 END) AS loaded,
                    SUM(CASE WHEN event='AD_BANNER_IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
                    SUM(CASE WHEN event='AD_BANNER_CLICK'      THEN 1 ELSE 0 END) AS clicks,
                    SUM(CASE WHEN event='AD_BANNER_IMPRESSION'
                             THEN CAST(json_extract(props,'\$.value') AS REAL) ELSE 0 END) AS revenue,
                    SUM(CASE WHEN event='AD_LOAD_ERROR'
                             AND json_extract(props,'\$.code')='googleMobileAds/no-fill'
                             THEN 1 ELSE 0 END) AS no_fill
                FROM app_events
                WHERE event IN ('AD_BANNER_REQUEST','AD_BANNER_LOADED','AD_BANNER_IMPRESSION',
                                 'AD_BANNER_CLICK','AD_LOAD_ERROR')
                  AND json_extract(props,'\$.slot') IN ('home_banner','freedom_banner','inbox_banner')
                  AND created_at >= ? AND created_at < ?
                GROUP BY slot
            ");
            $st->execute([$fromDt, $toDt]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $slot = $row['slot'];
                if (!isset($slots[$slot])) continue;
                $impressions = (int)$row['impressions'];
                $clicks      = (int)$row['clicks'];
                $slots[$slot] = [
                    'requests'    => (int)$row['requests'],
                    'loaded'      => (int)$row['loaded'],
                    'impressions' => $impressions,
                    'clicks'      => $clicks,
                    'ctr'         => $impressions > 0 ? round($clicks / $impressions * 100, 2) : null,
                    'revenue_usd' => round((float)$row['revenue'], 4),
                    'no_fill'     => (int)$row['no_fill'],
                ];
            }
        } catch (\Exception $e) { /* app_events doesn't exist yet — zeros below */ }

        $zero = ['requests'=>0,'loaded'=>0,'impressions'=>0,'clicks'=>0,'ctr'=>null,'revenue_usd'=>0.0,'no_fill'=>0];
        api_ok([
            'window'         => ['from' => $from_raw, 'to' => $to_raw],
            'home_banner'    => $slots['home_banner']    ?: $zero,
            'freedom_banner' => $slots['freedom_banner'] ?: $zero,
            'inbox_banner'   => $slots['inbox_banner']   ?: $zero,
        ]);
        break;

    case 'ad-errors-grouped':
        // Grouped AD_LOAD_ERROR view (Khabat, 2026-07-20: "do not spam admin
        // with identical errors — aggregate by slot, error code and user, show
        // a failure count"). Same window convention as banner-ads-stats.
        // One row per (slot, code, device_id) with a count + first/last seen,
        // instead of a raw list where one flaky device can bury everything
        // else under repeated identical rows.
        $db = open_analytics_db();
        $from_raw = trim($_GET['from'] ?? '');
        $to_raw   = trim($_GET['to']   ?? '');
        if ($from_raw && $to_raw
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from_raw)
            && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to_raw)) {
            // as-is
        } else {
            $days_raw = (int)($_GET['days'] ?? 7);
            $days     = max(1, min(90, $days_raw));
            $from_raw = gmdate('Y-m-d', strtotime("-{$days} days"));
            $to_raw   = gmdate('Y-m-d');
        }
        $fromDt = $from_raw . ' 00:00:00';
        $toDt   = gmdate('Y-m-d', strtotime($to_raw) + 86400) . ' 00:00:00'; // exclusive

        $groups = [];
        try {
            $st = $db->prepare("
                SELECT
                    device_id,
                    json_extract(props,'\$.slot')          AS slot,
                    json_extract(props,'\$.code')           AS code,
                    json_extract(props,'\$.domain')         AS domain,
                    COUNT(*)                                AS cnt,
                    MIN(created_at)                         AS first_seen,
                    MAX(created_at)                         AS last_seen,
                    MAX(json_extract(props,'\$.message'))   AS sample_message,
                    -- last-known VPN state among this group's events, not yet sent
                    -- by every client build — NULL until the app update ships.
                    MAX(CASE WHEN json_extract(props,'\$.vpn_connected') IN (1,'true')
                             THEN 1 ELSE 0 END)              AS vpn_connected_seen
                FROM app_events
                WHERE event = 'AD_LOAD_ERROR'
                  AND created_at >= ? AND created_at < ?
                GROUP BY device_id, slot, code
                ORDER BY cnt DESC
                LIMIT 200
            ");
            $st->execute([$fromDt, $toDt]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $groups[] = [
                    'device_id'      => $row['device_id'],
                    'slot'           => $row['slot'] ?? '',
                    'code'           => $row['code'] ?? '',
                    'domain'         => $row['domain'] ?? '',
                    'count'          => (int)$row['cnt'],
                    'first_seen'     => $row['first_seen'],
                    'last_seen'      => $row['last_seen'],
                    'sample_message' => (string)($row['sample_message'] ?? ''),
                    'vpn_connected'  => (bool)$row['vpn_connected_seen'],
                ];
            }
        } catch (\Exception $e) { /* app_events doesn't exist yet — empty below */ }

        api_ok([
            'window' => ['from' => $from_raw, 'to' => $to_raw],
            'groups' => $groups,
        ]);
        break;

    case 'payments-metrics':
        // Premium payments overview: packages, REAL vs USDT revenue/GB, discount
        // cost/value, and intent lists (pending/confirmed/failed).
        $db = open_analytics_db();
        pay_init_tables($db);
        $pcfg = pay_config($db);

        // Revenue (USD-equivalent; real_price is a USD-equivalent) + GB sold, by method.
        $byMethod = ['REAL' => ['revenue' => 0.0, 'gb' => 0, 'count' => 0],
                     'USDT' => ['revenue' => 0.0, 'gb' => 0, 'count' => 0]];
        foreach ($db->query("SELECT method, COALESCE(SUM(amount),0) rev, COALESCE(SUM(gb_amount),0) gb, COUNT(*) c
                             FROM payment_intents WHERE status='confirmed' GROUP BY method") as $r) {
            $m = $r['method'] === 'REAL' ? 'REAL' : 'USDT';
            $byMethod[$m] = ['revenue' => round((float)$r['rev'], 2), 'gb' => (int)$r['gb'], 'count' => (int)$r['c']];
        }

        // REAL discount cost/value: USDT-equivalent foregone vs REAL volume taken.
        $disc = $db->query("SELECT COALESCE(SUM(p.usdt_price - i.amount),0) cost, COALESCE(SUM(i.amount),0) vol
                            FROM payment_intents i JOIN premium_packages p ON p.package_id=i.package_id
                            WHERE i.status='confirmed' AND i.method='REAL'")->fetch(PDO::FETCH_ASSOC)
                ?: ['cost' => 0, 'vol' => 0];

        $counts = [];
        foreach ($db->query("SELECT status, COUNT(*) c FROM payment_intents GROUP BY status") as $r) {
            $counts[(string)$r['status']] = (int)$r['c'];
        }
        $lst = function (string $where) use ($db): array {
            return $db->query(
                "SELECT payment_id, device_id, package_id, method, amount, gb_amount, status, tx_hash, created_at, confirmed_at
                 FROM payment_intents WHERE $where ORDER BY payment_id DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);
        };

        api_ok([
            'packages'      => pay_packages($db, false),   // all, incl inactive (admin)
            'by_method'     => $byMethod,
            'discount_cost' => round((float)$disc['cost'], 2),
            'real_volume'   => round((float)$disc['vol'], 2),
            'counts'        => $counts,
            'pending'       => $lst("status='pending'"),
            'confirmed'     => $lst("status='confirmed'"),
            'failed'        => $lst("status IN ('expired','rejected')"),
            'config'        => [
                'real_token_address'      => $pcfg['real_token_address'],
                'real_destination_wallet' => $pcfg['real_destination_wallet'],
                'real_discount_percent'   => $pcfg['real_discount_percent'],
                'usdt_token_address'      => $pcfg['usdt_token_address'],
                'usdt_destination_wallet' => $pcfg['usdt_destination_wallet'],
                'usdt_chain'              => $pcfg['usdt_chain'],
                'payment_window_secs'     => (int)$pcfg['payment_window_secs'],
                'ton_indexer_configured'  => ($pcfg['ton_indexer_key'] !== '' ? 1 : 0),
                'real_ready'              => pay_method_ready($pcfg, 'REAL') ? 1 : 0,
                'usdt_ready'              => pay_method_ready($pcfg, 'USDT') ? 1 : 0,
                'auto_verify'             => ($pcfg['ton_indexer_key'] !== '' ? 1 : 0),
            ],
            'editable'      => array_intersect_key($pcfg, pay_defaults()),
            'checked_at'    => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'dash-metrics':
        // One call powering the redesigned dashboard: protocol success by
        // country, transport adoption, referral / payment / quota analytics.
        $db = open_analytics_db();
        init_device_tables($db);

        // Protocol success rate by country (telemetry, last 30 days)
        $dm_psc = $db->query("
            SELECT UPPER(COALESCE(NULLIF(country,''),'??')) AS country, protocol,
                   SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) AS success,
                   COUNT(*) AS total
            FROM test_results
            WHERE recorded_at >= datetime('now','-30 days')
            GROUP BY 1, 2 ORDER BY total DESC LIMIT 40")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($dm_psc as &$dm_r) {
            $dm_r['success'] = (int)$dm_r['success']; $dm_r['total'] = (int)$dm_r['total'];
            $dm_r['rate'] = $dm_r['total'] ? round($dm_r['success'] / $dm_r['total'] * 100) : null;
        }
        unset($dm_r);

        // Transport adoption: what protocol active devices actually use
        $dm_adopt = [];
        foreach ($db->query("
            SELECT COALESCE(NULLIF(active_protocol,''),'unknown') AS proto, COUNT(*) AS cnt
            FROM devices WHERE last_seen >= datetime('now','-7 days')
            GROUP BY 1 ORDER BY cnt DESC") as $dm_a) {
            $dm_adopt[$dm_a['proto']] = (int)$dm_a['cnt'];
        }

        // Referrals
        $dm_ref = [
            'total'        => (int)$db->query("SELECT COUNT(*) FROM referral_uses")->fetchColumn(),
            'last_30d'     => (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE used_at >= datetime('now','-30 days')")->fetchColumn(),
            'flagged'      => (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE status='flagged'")->fetchColumn(),
            'bonus_bytes'  => (int)$db->query("SELECT COALESCE(SUM(bonus_bytes),0) FROM referral_uses")->fetchColumn(),
            'referrers'    => (int)$db->query("SELECT COUNT(DISTINCT referrer_device_id) FROM referral_uses WHERE referrer_device_id!=''")->fetchColumn(),
        ];

        // Payments
        $dm_pay = ['pending'=>0,'approved'=>0,'rejected'=>0,'amount_usdt_approved'=>0.0,'last_30d'=>0];
        foreach ($db->query("SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount_usdt),0) AS amt FROM payment_queue GROUP BY status") as $dm_p) {
            $dm_s = (string)$dm_p['status'];
            if (isset($dm_pay[$dm_s])) $dm_pay[$dm_s] = (int)$dm_p['cnt'];
            if ($dm_s === 'approved') $dm_pay['amount_usdt_approved'] = round((float)$dm_p['amt'], 2);
        }
        $dm_pay['last_30d'] = (int)$db->query("SELECT COUNT(*) FROM payment_queue WHERE submitted_at >= datetime('now','-30 days')")->fetchColumn();

        // Quota usage
        $dm_q = $db->query("
            SELECT COUNT(*) AS devices,
                   COALESCE(SUM(quota_bytes_used),0)  AS used,
                   COALESCE(SUM(quota_bytes_total),0) AS total,
                   SUM(CASE WHEN quota_bytes_total>0 AND quota_bytes_used >= quota_bytes_total THEN 1 ELSE 0 END) AS exhausted,
                   SUM(CASE WHEN quota_bytes_total>0 AND quota_bytes_used >= quota_bytes_total*0.8
                            AND quota_bytes_used < quota_bytes_total THEN 1 ELSE 0 END) AS near_limit
            FROM devices WHERE blocked=0")->fetch(PDO::FETCH_ASSOC) ?: [];
        $dm_plans = [];
        foreach ($db->query("SELECT plan, COUNT(*) AS cnt, COALESCE(SUM(quota_bytes_used),0) AS used FROM devices GROUP BY plan ORDER BY cnt DESC") as $dm_pl) {
            $dm_plans[] = ['plan'=>$dm_pl['plan'],'devices'=>(int)$dm_pl['cnt'],'used_bytes'=>(int)$dm_pl['used']];
        }

        api_ok([
            'protocol_by_country' => $dm_psc,
            'adoption'            => $dm_adopt,
            'referrals'           => $dm_ref,
            'payments'            => $dm_pay,
            'quota'               => [
                'devices'     => (int)($dm_q['devices'] ?? 0),
                'used_bytes'  => (int)($dm_q['used'] ?? 0),
                'total_bytes' => (int)($dm_q['total'] ?? 0),
                'exhausted'   => (int)($dm_q['exhausted'] ?? 0),
                'near_limit'  => (int)($dm_q['near_limit'] ?? 0),
                'by_plan'     => $dm_plans,
            ],
            'checked_at' => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'devices-list':
        $db = open_analytics_db();
        init_device_tables($db);
        $q = trim((string)($_GET['q'] ?? ''));
        $plan = trim((string)($_GET['plan'] ?? ''));
        $status_filter = trim((string)($_GET['status'] ?? ''));
        $where = []; $params = [];
        if ($q) {
            $where[] = "(d.device_id LIKE ? OR d.user_id LIKE ? OR d.country LIKE ? OR d.app_version LIKE ? OR d.model LIKE ?)";
            $params = array_merge($params, ["%$q%","%$q%","%$q%","%$q%","%$q%"]);
        }
        if ($plan)          { $where[] = 'd.plan=?';    $params[] = $plan; }
        if ($status_filter === 'online')  { $where[] = "(d.status='online' AND d.last_seen>=datetime('now','-180 minutes'))"; }
        if ($status_filter === 'offline') { $where[] = "(d.status!='online' OR d.last_seen<datetime('now','-180 minutes'))"; }
        if ($status_filter === 'blocked') { $where[] = 'd.blocked=1'; }
        // Join vpn_sessions aggregate so we can show session counts and classify sources
        $sql = 'SELECT d.*,
                       COALESCE(s.session_count,0) AS session_count,
                       COALESCE(s.session_bytes,0) AS session_bytes,
                       s.last_session_at
                FROM devices d
                LEFT JOIN (
                    SELECT device_id,
                           COUNT(*)                       AS session_count,
                           SUM(bytes_sent+bytes_recv)     AS session_bytes,
                           MAX(ended_at)                  AS last_session_at
                    FROM vpn_sessions GROUP BY device_id
                ) s ON s.device_id = d.device_id'
              . ($where ? ' WHERE '.implode(' AND ',$where) : '')
              . ' ORDER BY d.created_at DESC LIMIT 500';
        $st  = $db->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $result = array_map(function($r) {
            $ls = $r['last_seen'] ?? null;
            $ca = $r['created_at'] ?? null;
            // Online = app-reported 'online' that isn't stale.
            $is_online = (($r['status'] ?? '') === 'online'
                          && $ls && (time()-(int)strtotime((string)$ls.' UTC')) < 10800);
            // Phantom-online: registered and marked online but never had any real
            // activity after the initial call (created_at ≈ last_seen within 2 min).
            $phantom = ($r['status'] === 'online'
                        && $ca && $ls
                        && abs(strtotime((string)$ls.' UTC') - strtotime((string)$ca.' UTC')) < 120);
            $sessionCount = (int)($r['session_count'] ?? 0);
            $isApple = (normalize_platform($r) === 'ios');
            // Registration source classification:
            //   apple_review  — iOS, never connected, only opened the app briefly
            //   testflight    — iOS, has real VPN sessions
            //   android       — non-Apple device
            //   unknown       — unclear
            if ($isApple) {
                $source = $sessionCount === 0 ? 'apple_review' : 'testflight';
            } else {
                $source = 'android';
            }
            $daysSince = $ls ? round((time()-strtotime((string)$ls.' UTC'))/86400, 1) : null;
            return [
                'device_id'         => $r['device_id'],
                'device_id_short'   => strtoupper(substr(hash('sha256',(string)$r['device_id']),0,8)),
                'user_id'           => $r['user_id']         ?? '',
                'platform'          => normalize_platform($r),
                'plan'              => $r['plan']            ?? 'free',
                'quota_bytes_total' => (int)($r['quota_bytes_total'] ?? 0),
                'quota_bytes_used'  => (int)($r['quota_bytes_used']  ?? 0),
                'status'            => $is_online ? 'online' : 'offline',
                'app_version'       => $r['app_version']     ?? '',
                'active_protocol'   => $r['active_protocol'] ?? '',
                'country_code'      => $r['country']         ?? '',
                'country'           => $r['country']         ?? '',
                'country_name'      => $r['country_name']    ?? '',
                'first_country'     => $r['first_country']      ?? '',
                'country_updated_at'=> $r['country_updated_at'] ?? '',
                'language'          => $r['language']        ?? '',
                'manufacturer'      => $r['manufacturer']    ?? '',
                'model'             => $r['model']           ?? '',
                'last_ip'           => $r['last_ip']         ?? '',
                'dns_ok'                 => (bool)(int)($r['dns_ok']       ?? 0),
                'internet_ok'            => (bool)(int)($r['internet_ok']  ?? 0),
                'active_sni'             => $r['active_sni']               ?? '',
                'rx_bytes'               => (int)($r['rx_bytes']  ?? 0),
                'tx_bytes'               => (int)($r['tx_bytes']  ?? 0),
                'latency_ms'             => (int)($r['latency_ms'] ?? 0),
                'last_failure_category'  => $r['last_failure_category']    ?? '',
                'last_failure_at'        => $r['last_failure_at']          ?? '',
                'created_at'             => $r['created_at'],
                'last_seen'              => $r['last_seen'],
                'blocked'                => (bool)(int)($r['blocked'] ?? 0),
                'referral_code'          => $r['referral_code']            ?? '',
                // New fields
                'session_count'          => $sessionCount,
                'session_bytes'          => (int)($r['session_bytes'] ?? 0),
                'last_session_at'        => $r['last_session_at'] ?? null,
                'ever_connected'         => $sessionCount > 0,
                'days_inactive'          => $daysSince,
                'registration_source'    => $source,
                'phantom_online'         => $phantom,
            ];
        }, $rows);
        api_ok($result);
        break;

    case 'messages-list': {
        $db = open_analytics_db();
        init_message_tables($db);
        $rows = $db->query(
            "SELECT m.id, m.target_device_id, m.title, m.body, m.created_at,
                    (SELECT COUNT(*) FROM admin_message_acks a WHERE a.message_id=m.id) AS ack_count,
                    (SELECT user_id FROM devices d WHERE d.device_id=m.target_device_id) AS target_user_id
             FROM admin_messages m ORDER BY m.id DESC LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(['messages' => $rows]);
        break;
    }

    case 'traffic-categories': {
        // Global traffic-by-app counts parsed from xray access log by
        // scripts/export-xray-stats.sh. Per-device attribution is impossible
        // today: all clients share one xray user and nginx fronts every
        // inbound, so xray sees 127.0.0.1 as the source for everyone.
        $ist = json_decode((string)@file_get_contents(__DIR__ . '/../data/xray-stats.json'), true) ?: [];
        $cats = (array)($ist['traffic_categories'] ?? []);
        arsort($cats);
        api_ok(['categories'  => $cats,
                'exported_at' => (string)($ist['exported_at'] ?? ''),
                'scope'       => 'global']);
        break;
    }

    case 'user-search': {
        // Global topbar live-search: partial User ID / device ID / referral
        // code. Dash-, space- and case-insensitive so "22762dac" finds
        // SL-227-62DAC5F0 and "ec58" finds sl-ec58c486-….
        $db = open_analytics_db();
        init_device_tables($db);
        $q = strtolower(str_replace([' ', '-'], '', trim((string)($_GET['q'] ?? ''))));
        if (strlen($q) < 2) api_ok(['results' => []]);
        $like = '%' . $q . '%';
        $st = $db->prepare(
            "SELECT device_id, user_id, referral_code, country, country_name,
                    platform, plan, status, last_seen, app_version
             FROM devices
             WHERE REPLACE(LOWER(COALESCE(user_id,'')), '-', '') LIKE ?
                OR REPLACE(LOWER(device_id), '-', '') LIKE ?
                OR REPLACE(LOWER(COALESCE(referral_code,'')), '-', '') LIKE ?
             ORDER BY last_seen DESC LIMIT 12");
        $st->execute([$like, $like, $like]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $ls = $r['last_seen'] ?? null;
            $r['is_online'] = (($r['status'] ?? '') === 'online'
                               && $ls && (time()-(int)strtotime((string)$ls.' UTC')) < 10800);
        }
        unset($r);
        api_ok(['results' => $rows]);
        break;
    }

    case 'device-detail': {
        $db = open_analytics_db();
        init_device_tables($db);
        $did = trim((string)($_GET['device_id'] ?? ''));
        if (!$did) api_err('device_id required');
        $st = $db->prepare('SELECT * FROM devices WHERE device_id=?');
        $st->execute([$did]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if (!$dev) api_err('device not found', 404);
        $ls = $dev['last_seen'] ?? null;
        $dev['is_online'] = ($dev['status'] === 'online'
                             && $ls && (time()-(int)strtotime((string)$ls.' UTC')) < 10800);
        // probe_result / error_reason added lazily by public/api.php; absent on
        // older rows — COALESCE to '' so the UI never sees NULL.
        $sess = $db->prepare("SELECT protocol, bytes_sent, bytes_recv, duration_secs,
                                     app_version, client_ip, started_at, ended_at,
                                     COALESCE(probe_result,'') AS probe_result,
                                     COALESCE(error_reason,'') AS error_reason
                              FROM vpn_sessions WHERE device_id=?
                              ORDER BY id DESC LIMIT 20");
        $sess->execute([$did]);
        $sessions = $sess->fetchAll(PDO::FETCH_ASSOC);
        foreach ($sessions as &$s) {
            // 127.0.0.1 means the report travelled through the VPN tunnel
            $s['via_vpn'] = ($s['client_ip'] === '127.0.0.1');
        }
        unset($s);
        $ev = $db->prepare("SELECT event, current_version, target_version, device_model,
                                   android_version, android_sdk, abi, error, created_at
                            FROM install_events WHERE device_id=?
                            ORDER BY id DESC LIMIT 10");
        $ev->execute([$did]);
        $dev['platform'] = normalize_platform($dev);

        // Banner + interstitial ad diagnostics (Khabat, 2026-07-19): a raw,
        // per-event timeline ("08:49 home_banner loaded") so admin can answer
        // "does it load / show / get clicked / earn / no-fill" for THIS
        // device specifically — the curated activity timeline
        // (get-device-timeline in public/api.php) deliberately excludes this
        // noise, this is the technical counterpart.
        // Interstitial (Connect-ad) SHOWN/IMPRESSION/CLICK added 2026-07-19:
        // the client previously fired zero telemetry on a successful show, so
        // a confirmed on-device ad sighting had nothing to show here (see
        // adsService.ts).
        // app_events is created lazily by public/api.php's track-event — may
        // not exist yet on a fresh install.
        $adEvents = [];
        try {
            $ae = $db->prepare("SELECT event, props, created_at FROM app_events
                                 WHERE device_id=?
                                   AND event IN ('AD_BANNER_REQUEST','AD_BANNER_LOADED',
                                                  'AD_BANNER_IMPRESSION','AD_BANNER_CLICK',
                                                  'AD_INTERSTITIAL_SHOWN','AD_INTERSTITIAL_IMPRESSION',
                                                  'AD_INTERSTITIAL_CLICK','AD_LOAD_ERROR')
                                 ORDER BY id DESC LIMIT 30");
            $ae->execute([$did]);
            // Collapse consecutive identical (kind+slot+code) rows into one with
            // a count — a device stuck retrying the same failure shouldn't bury
            // its other 29 events under 29 copies of the same line (Khabat,
            // 2026-07-20: don't spam admin with identical errors).
            $prevKey = null;
            foreach ($ae->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $props = json_decode((string)($row['props'] ?? ''), true) ?: [];
                $kind = [
                    'AD_BANNER_REQUEST'         => 'request',
                    'AD_BANNER_LOADED'          => 'loaded',
                    'AD_BANNER_IMPRESSION'      => 'impression',
                    'AD_BANNER_CLICK'           => 'click',
                    'AD_INTERSTITIAL_SHOWN'     => 'shown',
                    'AD_INTERSTITIAL_IMPRESSION'=> 'impression',
                    'AD_INTERSTITIAL_CLICK'     => 'click',
                ][$row['event']] ?? (
                    ($props['code'] ?? '') === 'googleMobileAds/no-fill' ? 'no_fill' : 'error'
                );
                $code = (string)($props['code'] ?? '');
                $key  = $kind . '|' . ($props['slot'] ?? '') . '|' . $code;
                if ($prevKey === $key && ($kind === 'error' || $kind === 'no_fill')) {
                    // Same failure as the row we just appended — bump its count
                    // and extend its time range instead of adding a new row.
                    $last = &$adEvents[count($adEvents) - 1];
                    $last['count']      = ($last['count'] ?? 1) + 1;
                    $last['first_seen'] = $row['created_at'];   // rows are DESC — this is earlier
                    unset($last);
                    continue;
                }
                $prevKey = $key;
                $adEvents[] = [
                    'created_at'    => $row['created_at'],
                    'first_seen'    => $row['created_at'],
                    'count'         => 1,
                    'slot'          => $props['slot'] ?? '',
                    'kind'          => $kind,
                    'code'          => $code,
                    'domain'        => (string)($props['domain'] ?? ''),
                    'vpn_connected' => array_key_exists('vpn_connected', $props) ? (bool)$props['vpn_connected'] : null,
                    'detail'        => ($kind === 'error' || $kind === 'no_fill') ? (string)($props['message'] ?? '') : '',
                ];
            }
        } catch (\Exception $e) { /* app_events doesn't exist yet — no events */ }

        api_ok([
            'device'         => $dev,
            'sessions'       => $sessions,
            'install_events' => $ev->fetchAll(PDO::FETCH_ASSOC),
            'ad_events'      => $adEvents,
        ]);
        break;
    }

    case 'install-diagnostics':
        $db = open_analytics_db();
        init_device_tables($db);
        $total = (int)$db->query('SELECT COUNT(*) FROM devices')->fetchColumn();
        // ABI distribution. abi holds Build.SUPPORTED_ABIS joined with ',' —
        // a device without arm64-v8a in the list can only install 32-bit APKs.
        $abi_rows = $db->query("SELECT abi, COUNT(*) AS cnt FROM devices WHERE abi!='' GROUP BY abi ORDER BY cnt DESC")->fetchAll(PDO::FETCH_ASSOC);
        $arm32_only = (int)$db->query("SELECT COUNT(*) FROM devices WHERE abi!='' AND abi NOT LIKE '%arm64-v8a%'")->fetchColumn();
        // Exclude iOS/Apple devices — they have no ABI concept; counting them as
        // "unknown" would mislead the Android install health stats.
        $abi_unknown = (int)$db->query("SELECT COUNT(*) FROM devices WHERE abi=''
            AND platform!='ios' AND manufacturer!='Apple'
            AND model NOT LIKE 'iPhone%' AND model NOT LIKE 'iPad%'")->fetchColumn();
        $app_versions = $db->query("SELECT app_version AS version, COUNT(*) AS cnt FROM devices WHERE app_version!='' GROUP BY app_version ORDER BY cnt DESC LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
        $android_versions = $db->query("SELECT android_version, sdk_version, COUNT(*) AS cnt FROM devices WHERE android_version!='' OR sdk_version>0 GROUP BY android_version, sdk_version ORDER BY cnt DESC LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
        // Fall back to probe telemetry for devices that registered before
        // fingerprint columns were stored.
        $android_versions_tests = $db->query("SELECT android_version, android_sdk AS sdk_version, COUNT(DISTINCT device_model) AS cnt FROM test_results WHERE android_version!='' GROUP BY android_version, android_sdk ORDER BY cnt DESC LIMIT 15")->fetchAll(PDO::FETCH_ASSOC);
        $models_raw = $db->query("SELECT manufacturer, model, MAX(platform) AS platform, MAX(android_version) AS android_version, MAX(sdk_version) AS sdk_version, MAX(abi) AS abi, MAX(app_version) AS app_version, COUNT(*) AS cnt, MAX(last_seen) AS last_seen FROM devices WHERE model!='' GROUP BY manufacturer, model ORDER BY cnt DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);
        $models = array_map(function($r) { $r['platform'] = normalize_platform($r); return $r; }, $models_raw);
        $events = $db->query("SELECT * FROM install_events ORDER BY id DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        $failures_7d = (int)$db->query("SELECT COUNT(*) FROM install_events WHERE event='install_failure' AND created_at>=datetime('now','-7 days')")->fetchColumn();
        $old_android = (int)$db->query("SELECT COUNT(*) FROM devices WHERE sdk_version>0 AND sdk_version<=28")->fetchColumn();
        api_ok([
            'summary' => [
                'total_devices'   => $total,
                'arm32_only'      => $arm32_only,
                'abi_unknown'     => $abi_unknown,
                'android9_or_older' => $old_android,
                'install_failures_7d' => $failures_7d,
            ],
            'abis'              => $abi_rows,
            'app_versions'      => $app_versions,
            'android_versions'  => $android_versions,
            'android_versions_tests' => $android_versions_tests,
            'models'            => $models,
            'install_events'    => $events,
        ]);
        break;

    case 'referral-stats':
        $db = open_analytics_db();
        init_device_tables($db);
        init_referral_audit($db);
        $total_referrals     = (int)$db->query('SELECT COUNT(*) FROM referral_uses')->fetchColumn();
        // 'flagged' is the legacy pre-hold status (those were auto-credited);
        // 'pending' rows are HELD and never credited until approved.
        $pending_referrals   = (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE status='pending'")->fetchColumn();
        $rejected_referrals  = (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE status='rejected'")->fetchColumn();
        $flagged_referrals   = (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE status IN ('flagged','pending','rejected')")->fetchColumn();
        $unique_referrers    = (int)$db->query("SELECT COUNT(DISTINCT referrer_device_id) FROM referral_uses WHERE referrer_device_id!=''")->fetchColumn();
        $total_devices       = (int)$db->query('SELECT COUNT(*) FROM devices')->fetchColumn();
        $referred_devices    = (int)$db->query("SELECT COUNT(DISTINCT new_device_id) FROM referral_uses WHERE new_device_id!=''")->fetchColumn();
        // GRANTED bonus only — held/rejected rows carry the intended amount
        // in bonus_bytes but no quota was ever credited for them.
        $total_bonus         = (int)$db->query("SELECT COALESCE(SUM(bonus_bytes),0) FROM referral_uses WHERE status IN ('credited','approved','flagged')")->fetchColumn();
        $stealth_unlocked    = (int)$db->query('SELECT COUNT(*) FROM devices WHERE stealth_unlocked=1')->fetchColumn();
        $conversion_rate     = $total_devices > 0 ? round($referred_devices / $total_devices * 100, 1) : 0.0;
        // Iran-specific
        $iran_referrals = (int)$db->query("
            SELECT COUNT(*) FROM referral_uses ru
            LEFT JOIN devices d ON d.device_id = ru.new_device_id
            WHERE UPPER(d.country) IN ('IR','IRN')
        ")->fetchColumn();
        // Top inviters with active count and stealth status
        $top_st = $db->query("
            SELECT d.user_id, d.device_id, d.referral_code, d.country, d.stealth_unlocked,
                   COUNT(ru.id) as invite_count,
                   COALESCE(SUM(CASE WHEN ru.status IN ('credited','approved','flagged')
                                     THEN ru.bonus_bytes ELSE 0 END),0) as total_bonus_bytes,
                   SUM(CASE WHEN ru.status IN ('flagged','pending','rejected') THEN 1 ELSE 0 END) as flagged_count,
                   (SELECT COUNT(*) FROM referral_uses ru2
                    JOIN devices d2 ON d2.device_id=ru2.new_device_id
                    WHERE ru2.referrer_device_id=d.device_id
                      AND (d2.internet_ok=1 OR d2.last_seen>=datetime('now','-7 days'))
                   ) as active_invites
            FROM devices d
            INNER JOIN referral_uses ru ON d.device_id = ru.referrer_device_id
            GROUP BY d.device_id
            ORDER BY invite_count DESC
            LIMIT 20
        ");
        $top_inviters = array_map(function($r) {
            return [
                'user_id'          => $r['user_id'] ?? '',
                'device_id'        => $r['device_id'] ?? '',
                'referral_code'    => $r['referral_code'] ?? '',
                'country'          => $r['country'] ?? '',
                'invite_count'     => (int)$r['invite_count'],
                'active_invites'   => (int)$r['active_invites'],
                'flagged_count'    => (int)$r['flagged_count'],
                'stealth_unlocked' => (bool)(int)($r['stealth_unlocked'] ?? 0),
                'total_bonus_gb'   => round((int)$r['total_bonus_bytes'] / 1073741824, 2),
                'total_bonus_bytes'=> (int)$r['total_bonus_bytes'],
            ];
        }, $top_st->fetchAll(PDO::FETCH_ASSOC));
        // Country breakdown
        $country_st = $db->query("
            SELECT d.country, COUNT(ru.id) as referral_count,
                   COUNT(DISTINCT d.device_id) as unique_new_users
            FROM referral_uses ru
            LEFT JOIN devices d ON d.device_id = ru.new_device_id
            WHERE d.country IS NOT NULL AND d.country != ''
            GROUP BY d.country
            ORDER BY referral_count DESC
            LIMIT 30
        ");
        $by_country = $country_st->fetchAll(PDO::FETCH_ASSOC);
        // Recent referrals with risk data
        $recent_st = $db->query("
            SELECT ru.id, ru.bonus_bytes, ru.risk_score, ru.risk_flags, ru.status,
                   ru.referrer_ip, ru.new_user_ip,
                   COALESCE(ru.created_at, ru.used_at) as ts,
                   d1.user_id as referrer_user_id, d1.country as referrer_country,
                   d1.referral_code as ref_code,
                   d2.user_id as new_user_id, d2.country as new_country,
                   d2.internet_ok as new_connected
            FROM referral_uses ru
            LEFT JOIN devices d1 ON d1.device_id = ru.referrer_device_id
            LEFT JOIN devices d2 ON d2.device_id = ru.new_device_id
            ORDER BY ts DESC
            LIMIT 50
        ");
        $recent = array_map(function($r) {
            return [
                'id'               => (int)$r['id'],
                'ts'               => $r['ts'] ?? '',
                'bonus_gb'         => round((int)$r['bonus_bytes'] / 1073741824, 2),
                'bonus_bytes'      => (int)$r['bonus_bytes'],
                'status'           => $r['status'] ?? 'credited',
                'risk_score'       => (int)$r['risk_score'],
                'risk_flags'       => json_decode($r['risk_flags'] ?? '[]', true) ?: [],
                'referrer_user_id' => $r['referrer_user_id'] ?? '',
                'referrer_country' => $r['referrer_country'] ?? '',
                'ref_code'         => $r['ref_code'] ?? '',
                'new_user_id'      => $r['new_user_id'] ?? '',
                'new_country'      => $r['new_country'] ?? '',
                'new_connected'    => (bool)(int)($r['new_connected'] ?? 0),
            ];
        }, $recent_st->fetchAll(PDO::FETCH_ASSOC));
        // Pending Review queue — ALL held referrals (not capped like recent)
        $pending_st = $db->query("
            SELECT ru.id, ru.bonus_bytes, ru.risk_score, ru.risk_flags,
                   ru.referrer_ip, ru.new_user_ip, ru.referral_code,
                   COALESCE(ru.created_at, ru.used_at) as ts,
                   d1.user_id as referrer_user_id, d1.country as referrer_country,
                   d2.user_id as new_user_id, d2.country as new_country,
                   d2.model as new_model, d2.internet_ok as new_connected
            FROM referral_uses ru
            LEFT JOIN devices d1 ON d1.device_id = ru.referrer_device_id
            LEFT JOIN devices d2 ON d2.device_id = ru.new_device_id
            WHERE ru.status='pending'
            ORDER BY ts ASC
        ");
        $pending_queue = array_map(function($r) {
            return [
                'id'               => (int)$r['id'],
                'ts'               => $r['ts'] ?? '',
                'bonus_gb'         => round((int)$r['bonus_bytes'] / 1073741824, 2),
                'risk_score'       => (int)$r['risk_score'],
                'risk_flags'       => json_decode($r['risk_flags'] ?? '[]', true) ?: [],
                'referral_code'    => $r['referral_code'] ?? '',
                'referrer_user_id' => $r['referrer_user_id'] ?? '',
                'referrer_country' => $r['referrer_country'] ?? '',
                'referrer_ip'      => $r['referrer_ip'] ?? '',
                'new_user_id'      => $r['new_user_id'] ?? '',
                'new_country'      => $r['new_country'] ?? '',
                'new_user_ip'      => $r['new_user_ip'] ?? '',
                'new_model'        => $r['new_model'] ?? '',
                'new_connected'    => (bool)(int)($r['new_connected'] ?? 0),
            ];
        }, $pending_st->fetchAll(PDO::FETCH_ASSOC));
        // Recent review decisions (audit trail)
        $audit = $db->query(
            "SELECT id, referral_id, action, acted_by, detail, acted_at
             FROM referral_audit ORDER BY id DESC LIMIT 30")->fetchAll(PDO::FETCH_ASSOC);
        api_ok([
            'total_referrals'    => $total_referrals,
            'pending_referrals'  => $pending_referrals,
            'rejected_referrals' => $rejected_referrals,
            'pending_queue'      => $pending_queue,
            'audit_log'          => $audit,
            'flagged_referrals'  => $flagged_referrals,
            'unique_referrers'   => $unique_referrers,
            'total_devices'      => $total_devices,
            'referred_devices'   => $referred_devices,
            'conversion_rate'    => $conversion_rate,
            'total_bonus_bytes'  => $total_bonus,
            'total_bonus_gb'     => round($total_bonus / 1073741824, 2),
            'stealth_unlocked'   => $stealth_unlocked,
            'iran_referrals'     => $iran_referrals,
            'top_inviters'       => $top_inviters,
            'recent_referrals'   => $recent,
            'by_country'         => $by_country,
        ]);
        break;

    case 'heartbeat':
        $hb_xray  = trim((string)@shell_exec('systemctl is-active xray.service 2>/dev/null'))  === 'active';
        $hb_nginx = trim((string)@shell_exec('systemctl is-active nginx.service 2>/dev/null')) === 'active';
        $hb_sqlite = false;
        try { open_analytics_db(); $hb_sqlite = true; } catch (Exception $e) {}
        $hb_bs_ok         = false;
        $hb_bs_configured = false;
        $hb_bs_address    = '';
        try {
            $db_bs   = open_analytics_db();
            $bs_cfg  = $db_bs->query("SELECT key,value FROM settings WHERE key LIKE 'bootstrap_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
            $hb_bs_configured = !empty($bs_cfg['bootstrap_uuid']) && !empty($bs_cfg['bootstrap_pubkey']);
            $bs      = fetch_bootstrap_server($db_bs);
            $hb_bs_address = ($bs['address'] ?? '') . ':' . ($bs['port'] ?? '');
            $hb_bs_ok = !empty($bs['uuid']);
        } catch (Exception $e) { }
        $hb_port   = @fsockopen('127.0.0.1', 8443, $e, $err, 1) !== false;
        api_ok(['xray'=>$hb_xray,'nginx'=>$hb_nginx,'sqlite'=>$hb_sqlite,'api'=>true,
                'bootstrap'=>['ok'=>$hb_bs_ok,'configured'=>$hb_bs_configured,'address'=>$hb_bs_address],
                'port_8443'=>$hb_port,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'release-status':
        $channels = ['stable','beta','hotfix'];
        $pub_base = '/var/www/setalink/public/releases/';
        $dl_dir   = '/var/www/setalink/public/download/';
        $result   = [];
        foreach ($channels as $ch) {
            $dir  = $pub_base . $ch . '/';
            $apks = [];
            if (is_dir($dir)) {
                foreach (glob($dir . '*.apk') ?: [] as $f) {
                    if (is_link($f)) continue; // latest-* symlinks listed separately
                    $sha  = hash_file('sha256', $f) ?: '';
                    $name = basename($f);
                    $variant = strpos($name, '-universal') !== false ? 'universal'
                             : (strpos($name, '-arm32') !== false ? 'arm32' : 'arm64');
                    $apks[] = [
                        'name'    => $name,
                        'variant' => $variant,
                        'size'    => (int)filesize($f),
                        'mtime'   => date('Y-m-d H:i:s', (int)filemtime($f)),
                        'sha256'  => $sha,
                        'url'     => "https://setalink.no/releases/{$ch}/" . $name,
                    ];
                }
            }
            usort($apks, fn($a,$b) => strcmp($b['mtime'], $a['mtime']));
            $sym        = $dir . 'setalink-latest.apk';
            $sym_target = is_link($sym) ? readlink($sym) : null;
            $sym_valid  = $sym_target && file_exists($dir . $sym_target);
            $result[$ch] = ['apks'=>$apks,'latest_symlink'=>$sym_target,'symlink_valid'=>$sym_valid];
        }
        $dl_sym     = $dl_dir . 'setalink-latest.apk';
        $dl_target  = is_link($dl_sym) ? readlink($dl_sym) : null;
        $dl_resolved = $dl_target ? realpath(dirname($dl_sym) . '/' . $dl_target) : null;
        $dl_symlinks = [];
        foreach (['setalink-latest.apk' => 'arm64 (default)',
                  'setalink-latest-arm32.apk' => 'arm32 / older phones',
                  'setalink-latest-universal.apk' => 'universal'] as $link => $label) {
            $p = $dl_dir . $link;
            $t = is_link($p) ? readlink($p) : null;
            $r = $t ? realpath(dirname($p) . '/' . $t) : null;
            $dl_symlinks[] = [
                'name'   => $link,
                'label'  => $label,
                'target' => $t,
                'valid'  => $r && file_exists($r),
            ];
        }
        $vj_path    = $dl_dir . 'version.json';
        $vj         = json_decode((string)@file_get_contents($vj_path), true) ?: null;
        api_ok([
            'channels'        => $result,
            'download_symlink' => [
                'target'   => $dl_target,
                'resolved' => $dl_resolved,
                'valid'    => $dl_resolved && file_exists($dl_resolved),
            ],
            'download_symlinks' => $dl_symlinks,
            'version_json'    => $vj,
            'checked_at'      => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'session-stats':
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS vpn_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT, protocol TEXT,
            bytes_sent INTEGER DEFAULT 0, bytes_recv INTEGER DEFAULT 0,
            duration_secs INTEGER DEFAULT 0, app_version TEXT DEFAULT '',
            probe_result TEXT DEFAULT 'unknown', error_reason TEXT DEFAULT '',
            started_at TEXT, ended_at TEXT DEFAULT (datetime('now')), client_ip TEXT DEFAULT ''
        )");
        $migrations_sess = [
            "ALTER TABLE vpn_sessions ADD COLUMN probe_result TEXT DEFAULT 'unknown'",
            "ALTER TABLE vpn_sessions ADD COLUMN error_reason TEXT DEFAULT ''",
        ];
        foreach ($migrations_sess as $sql) { try { $db->exec($sql); } catch (Exception $e) {} }
        $db->exec("CREATE TABLE IF NOT EXISTS ip_isp_cache (
            ip TEXT PRIMARY KEY, isp TEXT, asn TEXT, country TEXT,
            cached_at TEXT DEFAULT (datetime('now'))
        )");
        $today      = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions WHERE ended_at>=date('now')")->fetchColumn();
        $total_sess = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions")->fetchColumn();
        $avg_dur    = (float)($db->query("SELECT AVG(duration_secs) FROM vpn_sessions WHERE duration_secs>10")->fetchColumn() ?? 0);
        $total_bytes = (int)($db->query("SELECT SUM(bytes_sent+bytes_recv) FROM vpn_sessions")->fetchColumn() ?? 0);
        $probe_ok_count  = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions WHERE probe_result='ok'")->fetchColumn();
        $probe_fail_count = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions WHERE probe_result='fail'")->fetchColumn();
        $by_protocol = $db->query(
            "SELECT protocol,COUNT(*) as sessions,
                    SUM(duration_secs) as total_secs,SUM(bytes_sent+bytes_recv) as total_bytes,
                    SUM(CASE WHEN probe_result='ok' THEN 1 ELSE 0 END) as probe_ok_cnt
             FROM vpn_sessions GROUP BY protocol ORDER BY sessions DESC LIMIT 10"
        )->fetchAll(PDO::FETCH_ASSOC);
        $recent = $db->query(
            "SELECT device_id,protocol,bytes_sent,bytes_recv,duration_secs,ended_at,client_ip,probe_result,error_reason
             FROM vpn_sessions ORDER BY ended_at DESC LIMIT 20"
        )->fetchAll(PDO::FETCH_ASSOC);
        $isp_breakdown = $db->query(
            "SELECT c.isp,c.country,COUNT(*) as sessions
             FROM vpn_sessions s JOIN ip_isp_cache c ON s.client_ip=c.ip
             GROUP BY c.isp ORDER BY sessions DESC LIMIT 15"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(['today'=>$today,'total'=>$total_sess,'avg_duration'=>round($avg_dur),
                'total_bytes'=>$total_bytes,'probe_ok'=>$probe_ok_count,'probe_fail'=>$probe_fail_count,
                'by_protocol'=>$by_protocol,'isp_breakdown'=>$isp_breakdown,'recent'=>$recent]);
        break;

    case 'iran-traffic':
        // Real-time Iran/country traffic visibility from vpn_sessions + test_results
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS vpn_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT, protocol TEXT,
            bytes_sent INTEGER DEFAULT 0, bytes_recv INTEGER DEFAULT 0,
            duration_secs INTEGER DEFAULT 0, app_version TEXT DEFAULT '',
            probe_result TEXT DEFAULT 'unknown', error_reason TEXT DEFAULT '',
            started_at TEXT, ended_at TEXT DEFAULT (datetime('now')), client_ip TEXT DEFAULT ''
        )");
        $migrations_sess2 = [
            "ALTER TABLE vpn_sessions ADD COLUMN probe_result TEXT DEFAULT 'unknown'",
            "ALTER TABLE vpn_sessions ADD COLUMN error_reason TEXT DEFAULT ''",
        ];
        foreach ($migrations_sess2 as $sql) { try { $db->exec($sql); } catch (Exception $e) {} }
        // Country breakdown from test_results (telemetry — has country+protocol+sni)
        $country_rows = $db->query(
            "SELECT country,protocol,sni,
                    COUNT(*) as attempts,
                    SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) as accepted,
                    SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) as rejected,
                    SUM(CASE WHEN tcp_ok=1 AND http_ok=0 THEN 1 ELSE 0 END) as tcp_only,
                    SUM(no_internet) as no_internet,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE recorded_at >= datetime('now','-24 hours')
             GROUP BY country,protocol,sni
             ORDER BY attempts DESC LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        // Iran-specific breakdown with device info
        $iran_rows = $db->query(
            "SELECT protocol,sni,error_msg,tcp_ok,http_ok,no_internet,
                    country,network,device_model,tested_by,recorded_at,
                    is_winner,fallback_chain,emergency
             FROM test_results
             WHERE (country LIKE '%Iran%' OR country='IR'
                    OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                    OR network LIKE '%MCI%' OR network LIKE '%Shatel%'
                    OR network LIKE '%Rightel%' OR network LIKE '%TCI%')
             ORDER BY recorded_at DESC LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        // Recent sessions with device_id
        $recent_sess = $db->query(
            "SELECT s.device_id,s.protocol,s.probe_result,s.error_reason,
                    s.bytes_sent,s.bytes_recv,s.duration_secs,s.client_ip,s.ended_at,
                    d.country,d.app_version,d.status
             FROM vpn_sessions s
             LEFT JOIN devices d ON s.device_id=d.device_id
             WHERE s.ended_at >= datetime('now','-24 hours')
             ORDER BY s.ended_at DESC LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        // No-internet failures (VPN connected but internet not routed)
        $no_internet_rows = $db->query(
            "SELECT protocol,sni,error_msg,country,network,device_model,recorded_at
             FROM test_results
             WHERE no_internet=1
             ORDER BY recorded_at DESC LIMIT 30"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok([
            'country_breakdown' => $country_rows,
            'iran_attempts'     => $iran_rows,
            'recent_sessions'   => $recent_sess,
            'no_internet_failures' => $no_internet_rows,
            'checked_at'        => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'lookup-isp':
        $ip = preg_replace('/[^0-9a-f:.]/', '', $_GET['ip'] ?? '');
        if (!$ip || !filter_var($ip, FILTER_VALIDATE_IP)) api_err('invalid ip');
        if (str_starts_with($ip,'10.') || str_starts_with($ip,'192.168.') || str_starts_with($ip,'127.'))
            api_ok(['ip'=>$ip,'isp'=>'LAN','asn'=>'','country'=>'Local']);
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS ip_isp_cache (ip TEXT PRIMARY KEY,isp TEXT,asn TEXT,country TEXT,cached_at TEXT DEFAULT (datetime('now')))");
        $cached = $db->prepare("SELECT * FROM ip_isp_cache WHERE ip=? AND cached_at>datetime('now','-7 days')");
        $cached->execute([$ip]);
        $row = $cached->fetch();
        if ($row) api_ok(['ip'=>$ip,'isp'=>$row['isp'],'asn'=>$row['asn'],'country'=>$row['country'],'cached'=>true]);
        $raw  = @file_get_contents("https://ipinfo.io/{$ip}/json");
        $info = $raw ? json_decode($raw, true) : null;
        $isp  = $info['org'] ?? 'Unknown';
        $asn  = '';
        if (preg_match('/^(AS\d+)\s/', $isp, $m)) { $asn = $m[1]; $isp = trim(substr($isp, strlen($m[1]))); }
        $country = $info['country'] ?? '';
        $db->prepare("INSERT OR REPLACE INTO ip_isp_cache (ip,isp,asn,country) VALUES (?,?,?,?)")->execute([$ip,$isp,$asn,$country]);
        api_ok(['ip'=>$ip,'isp'=>$isp,'asn'=>$asn,'country'=>$country,'cached'=>false]);
        break;

    case 'watchdog-log':
        $log = '/var/log/setalink/watchdog.log';
        $n   = min(200, max(20, (int)($_GET['n'] ?? 50)));
        if (!is_readable($log)) api_ok(['lines'=>[],'note'=>'log not yet created']);
        $lines = array_slice(file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -$n);
        api_ok(['lines'=>$lines,'count'=>count($lines)]);
        break;

    case 'tunnel-logs':
        // Serves uploaded PacketTunnelProvider diagnostic bundles.
        //
        // GET ?action=tunnel-logs                       → list all (newest first, max 200)
        // GET ?action=tunnel-logs&device_id=sl-xxx      → filter to one device
        // GET ?action=tunnel-logs&stem=sl-xxx_20260627_120000_123
        //                                               → return log + meta + config for one stem
        // GET ?action=tunnel-logs&platform=ios|android  → filter by platform
        // GET ?action=tunnel-logs&status=ok|fail        → filter by success flag
        // GET ?action=tunnel-logs&stage=failed|connected → filter by meta.step
        $dir        = dirname(__DIR__) . '/data/tunnel-logs';
        $stemParam  = trim($_GET['stem']      ?? '');
        $devFilter  = trim($_GET['device_id'] ?? '');
        $platFilter = trim($_GET['platform']  ?? '');
        $statFilter = trim($_GET['status']    ?? '');
        $stageFilter= trim($_GET['stage']     ?? '');
        $verFilter  = trim($_GET['app_version'] ?? '');

        if ($stemParam !== '') {
            $safe = preg_replace('/[^A-Za-z0-9_\-]/', '', $stemParam);
            if ($safe === '') api_error('invalid stem');

            $logPath  = $dir . '/' . $safe . '.txt';
            $metaPath = $dir . '/' . $safe . '.meta.json';
            $cfgPath  = $dir . '/' . $safe . '.config.json';

            if (!is_readable($logPath)) api_error('log not found');
            $lines = file($logPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $meta  = is_readable($metaPath) ? json_decode(file_get_contents($metaPath), true) : null;
            $cfg   = is_readable($cfgPath)  ? file_get_contents($cfgPath)                      : null;

            api_ok([
                'stem'   => $safe,
                'lines'  => $lines,
                'count'  => count($lines),
                'meta'   => $meta,
                'config' => $cfg,
            ]);
        }

        if (!is_dir($dir)) { api_ok(['files' => []]); }

        $files = glob($dir . '/*.txt') ?: [];
        rsort($files);  // newest first
        $files = array_slice($files, 0, 200);
        $result = [];
        foreach ($files as $f) {
            $base = basename($f, '.txt');
            // Extract device_id from stem: strip trailing _YYYYMMDD_HHMMSS_mmm
            $deviceId = preg_replace('/_\d{8}_\d{6}(_\d{3})?$/', '', $base);

            $metaPath = $dir . '/' . $base . '.meta.json';
            $cfgPath  = $dir . '/' . $base . '.config.json';

            $meta = null;
            if (is_readable($metaPath)) {
                $meta = json_decode(file_get_contents($metaPath), true);
                // If the filename stem starts with "unknown" but the meta carries the real
                // device_id, use it so the listing links to the correct device.
                if ($deviceId === 'unknown' && !empty($meta['device_id']) && $meta['device_id'] !== 'unknown') {
                    $deviceId = $meta['device_id'];
                }
            }

            // Extract iOS build number from app_version string like "0.9.50 (39)"
            $appVer  = (string)($meta['app_version'] ?? '');
            $build   = null;
            if (preg_match('/\((\d+)\)/', $appVer, $bm)) $build = (int)$bm[1];

            // Apply filters
            if ($devFilter  && stripos($deviceId, $devFilter) === false) continue;
            if ($stageFilter && ($meta['step'] ?? '') !== $stageFilter) continue;
            if ($statFilter === 'ok'   && ($meta['success'] ?? null) !== true)  continue;
            if ($statFilter === 'fail' && ($meta['success'] ?? null) !== false) continue;
            if ($verFilter  && stripos($appVer, $verFilter) === false)           continue;
            // Platform filter: iOS logs have a build number in parentheses (Android does not)
            if ($platFilter === 'ios'     && $build === null)  continue;
            if ($platFilter === 'android' && $build !== null)  continue;

            $result[] = [
                'stem'       => $base,
                'device_id'  => $deviceId,
                'size'       => filesize($f),
                'mtime'      => date('Y-m-d H:i:s', filemtime($f)),
                'has_meta'   => is_readable($metaPath),
                'has_config' => is_readable($cfgPath),
                'build'      => $build,
                'meta'       => $meta,
            ];
        }
        api_ok(['files' => $result, 'count' => count($result)]);
        break;

    case 'payment-queue':
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS payment_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL, user_id TEXT DEFAULT '',
            memo TEXT DEFAULT '', package TEXT NOT NULL DEFAULT '30days',
            amount_usdt REAL DEFAULT 0, tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '', note TEXT DEFAULT ''
        )");
        try { $db->exec("ALTER TABLE payment_queue ADD COLUMN user_id TEXT DEFAULT ''"); } catch (Exception $e) {}
        $sf    = $_GET['status'] ?? 'pending';
        if (!in_array($sf, ['pending','approved','rejected','all'], true)) $sf = 'pending';
        $where = $sf === 'all' ? '' : "WHERE p.status = '$sf'";
        $rows  = $db->query("SELECT p.*,
            COALESCE(NULLIF(p.user_id,''), p.memo, p.device_id) AS matched_user_id,
            d.platform,d.plan,d.quota_bytes_total,d.quota_bytes_used
            FROM payment_queue p LEFT JOIN devices d ON d.device_id=p.device_id
            $where ORDER BY p.submitted_at DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
        api_ok(['payments'=>$rows,'filter'=>$sf]);
        break;

    case 'quota-transfers':
        // Admin review: recent quota transfers between devices (P5 marketplace).
        $db = open_analytics_db();
        qe_init_tables($db);
        $sf = $_GET['status'] ?? 'all';
        if (!in_array($sf, ['completed','reversed','flagged','all'], true)) $sf = 'all';
        $where = $sf === 'all' ? '' : "WHERE t.status = '$sf'";
        $rows = $db->query("SELECT t.id,t.sender_device,t.receiver_device,t.bytes,t.status,t.created_at,t.metadata,
            ds.user_id AS sender_user_id, dr.user_id AS receiver_user_id,
            ds.last_ip AS sender_ip, dr.last_ip AS receiver_ip
            FROM quota_transfer t
            LEFT JOIN devices ds ON ds.device_id=t.sender_device
            LEFT JOIN devices dr ON dr.device_id=t.receiver_device
            $where ORDER BY t.id DESC LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);
        // Lightweight anti-fraud signal: senders/receivers sharing an IP.
        foreach ($rows as &$r) {
            $r['same_ip'] = ($r['sender_ip'] ?? '') !== '' && ($r['sender_ip'] ?? '') === ($r['receiver_ip'] ?? '');
        }
        unset($r);
        api_ok(['transfers' => $rows, 'filter' => $sf]);
        break;

    case 'device-ledger':
        // Admin device detail: full quota breakdown + ledger + packages + transfers.
        $did = trim((string)($_GET['device_id'] ?? ''));
        if (!$did) api_err('device_id required');
        $db = open_analytics_db();
        qe_init_tables($db);
        if (!qe_fetch_device($db, $did)) api_err('device not found');
        $st = $db->prepare("SELECT id,type,bytes,created_at,metadata FROM quota_transactions WHERE device_id=? ORDER BY id DESC LIMIT 200");
        $st->execute([$did]);
        api_ok([
            'summary'    => qe_summary($db, $did),
            'milestones' => qe_milestone_progress($db, $did),
            'packages'   => qe_packages($db, $did),
            'ledger'     => $st->fetchAll(PDO::FETCH_ASSOC),
            'transfers'  => qe_transfer_history($db, $did, 50),
        ]);
        break;

    case 'inbound-stats':
        // Listening state checked live; traffic counters come from
        // data/xray-stats.json, exported every 2 min by a root cron
        // (scripts/export-xray-stats.sh) because /var/log/xray is root-only.
        $ss_out = (string)@shell_exec('ss -tuln 2>/dev/null');
        $ports = [
            'ws'      => ['port'=>10000, 'tag'=>'inbound-ws',     'listening'=>false, 'label'=>'WebSocket (edge)'],
            'xhttp'   => ['port'=>10001, 'tag'=>'inbound-xhttp',  'listening'=>false, 'label'=>'XHTTP (edge)'],
            'httpup'  => ['port'=>10002, 'tag'=>'inbound-httpup', 'listening'=>false, 'label'=>'HTTPUpgrade (edge)'],
            'reality' => ['port'=>8443,  'tag'=>'inbound-reality','listening'=>false, 'label'=>'Reality (via nginx SNI dispatch on :443)'],
        ];
        foreach ($ports as $k => &$p) $p['listening'] = str_contains($ss_out, ':'.$p['port']);
        unset($p);
        $ist = json_decode((string)@file_get_contents(__DIR__ . '/../data/xray-stats.json'), true) ?: [];
        $per_inbound = $ist['per_inbound'] ?? [];
        foreach ($ports as $k => &$p) $p['accepted'] = (int)($per_inbound[$p['tag']] ?? 0);
        unset($p);
        api_ok(['ports'=>$ports,
                'uuid_rejections'=>(int)($ist['uuid_rejections'] ?? 0),
                'rejected_uuids'=>array_slice((array)($ist['rejected_uuids'] ?? []),0,5),
                'accepted_total'=>(int)($ist['accepted_total'] ?? 0),
                'last_accepted_at'=>(string)($ist['last_accept'] ?? ''),
                'last_errors'=>(array)($ist['recent_errors'] ?? []),
                'stats_exported_at'=>(string)($ist['exported_at'] ?? ''),
                'stats_available'=>!empty($ist),
                'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'debug-status':
        $ds = ['php_version'=>phpversion(),'php_ok'=>true];
        $ds['xray_active']  = trim((string)@shell_exec('systemctl is-active xray.service 2>/dev/null'))  === 'active';
        $ds['nginx_active'] = trim((string)@shell_exec('systemctl is-active nginx.service 2>/dev/null')) === 'active';
        $ds['xray_version'] = trim((string)@shell_exec('/usr/local/bin/xray version 2>/dev/null | head -1'));
        try {
            $ds_db = open_analytics_db();
            $ds_db->exec("SELECT 1");
            $ds['db_path']      = realpath(__DIR__ . '/../data/analytics.db') ?: 'not found';
            $ds['db_ok']        = true;
            $ds['db_writable']  = is_writable(dirname((string)($ds['db_path'])));
            $ds['device_count'] = (int)$ds_db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
            $ds['session_count']= (int)$ds_db->query("SELECT COUNT(*) FROM vpn_sessions")->fetchColumn();
            $ds['payment_count']= (int)$ds_db->query("SELECT COUNT(*) FROM payment_queue")->fetchColumn();
            $ds['test_count']   = (int)$ds_db->query("SELECT COUNT(*) FROM test_results")->fetchColumn();
        } catch (Exception $e) {
            $ds['db_ok'] = false; $ds['db_error'] = $e->getMessage();
        }
        foreach (['xray_access'=>'/var/log/xray/access.log','xray_error'=>'/var/log/xray/error.log',
                  'nginx_access'=>'/var/log/nginx/access.log','nginx_error'=>'/var/log/nginx/error.log',
                  'watchdog'=>'/var/log/setalink/watchdog.log'] as $lk => $lp) {
            $ds['logs'][$lk] = ['path'=>$lp,'exists'=>file_exists($lp),'readable'=>is_readable($lp),
                'size_kb'=>file_exists($lp)?round(filesize($lp)/1024,1):null];
        }
        $ds['apk_symlink']  = realpath('/var/www/setalink/public/download/setalink-latest.apk') ?: 'broken';
        $ds['version_json'] = json_decode((string)@file_get_contents('/var/www/setalink/public/download/version.json'),true) ?: null;
        $ds['checked_at']   = date('Y-m-d H:i:s');
        api_ok($ds);
        break;

    case 'node-list':
        $cfg     = cli_json('status', [], 8);
        $reality = $cfg['reality'] ?? [];
        $xray_ok = isset($cfg['services']['xray']) && $cfg['services']['xray'] === 'active';
        $db_nl   = open_analytics_db();
        $srv_label = (string)($db_nl->query("SELECT value FROM settings WHERE key='server_label'")->fetchColumn() ?: 'RealGram VPN');
        api_ok([[
            'id'=>'main','label'=>$srv_label,'host'=>(string)($reality['address']??'5.249.252.221'),
            'country'=>'NO','city'=>'Oslo','flag'=>'🇳🇴','protocol'=>'Reality+XHTTP+WS',
            'port'=>(int)($reality['port']??8443),'status'=>$xray_ok?'active':'error',
            'tags'=>['reality','xhttp','websocket','stealth','main'],'ping'=>null,
        ]]);
        break;

    case 'node-ping':
        $host = trim($_GET['host'] ?? '');
        $port = min(65535, max(1, (int)($_GET['port'] ?? 443)));
        if (!$host) api_err('host required');
        $start = microtime(true);
        $s = @fsockopen($host, $port, $e, $err, 3);
        $ms = (int)round((microtime(true) - $start) * 1000);
        if ($s) { fclose($s); api_ok(['ms'=>$ms,'ok'=>true]); }
        api_ok(['ms'=>null,'ok'=>false]);
        break;

    case 'test-bootstrap':
        $tb_raw = trim((string)@shell_exec('curl -sk --max-time 6 "http://127.0.0.1/api.php?mobile=1&action=bootstrap&_token=' . MOBILE_REPORT_TOKEN . '" 2>/dev/null'));
        if (!$tb_raw) api_err('Bootstrap endpoint did not respond', 503);
        $tb_j = json_decode($tb_raw, true);
        if (!is_array($tb_j)) api_err('Bootstrap endpoint returned invalid JSON');
        if (!($tb_j['ok'] ?? false)) api_err('Bootstrap error: ' . ($tb_j['error'] ?? 'unknown'));
        $tb_d = $tb_j['data'] ?? [];
        foreach (['uuid','address','port','publicKey'] as $tbf) {
            if (empty($tb_d[$tbf])) api_err("Bootstrap missing field: {$tbf}");
        }
        api_ok(['status'=>'ok','profile'=>$tb_d]);
        break;

    // ── HAKIM ADMIN (ADMIN_NOC_ROADMAP.md § 8.11) ───────────────────────
    // Reads hakim-bot's actual running state — systemctl + hakim.db.
    // Never fabricates a status; § 8.0's truth principle applies.
    // bot_config also holds API keys in plaintext — NEVER select those columns.
    case 'hakim-status': {
        $HAKIM_DB = '/var/www/shahnameh/hakim-bot/hakim.db';
        $status = trim((string)@shell_exec('systemctl is-active hakim-bot 2>&1'));
        $out = [
            'bot_status' => in_array($status, ['active', 'inactive', 'failed'], true) ? $status : 'unknown',
            'provider' => null, 'model' => null, 'bot_active' => null, 'config_updated_at' => null,
            'messages_in' => null, 'user_count' => null,
            'requests_logged' => 0, 'success_rate' => null, 'avg_latency_ms' => null,
            'recent_errors' => [], 'knowledge_summary' => null,
        ];
        if (is_readable($HAKIM_DB)) {
            try {
                $hdb = new PDO('sqlite:' . $HAKIM_DB, null, null, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]);
                $cfg = [];
                foreach ($hdb->query("SELECT key, value FROM bot_config WHERE key IN ('ai_provider','bot_active','openai_model','anthropic_model')") as $r) {
                    $cfg[$r['key']] = $r['value'];
                }
                $out['provider']   = $cfg['ai_provider'] ?? null;
                $out['model']      = (($cfg['ai_provider'] ?? '') === 'anthropic') ? ($cfg['anthropic_model'] ?? null) : ($cfg['openai_model'] ?? null);
                $out['bot_active'] = isset($cfg['bot_active']) ? (strtolower($cfg['bot_active']) === 'true') : null;
                $out['config_updated_at'] = $hdb->query("SELECT MAX(updated_at) AS m FROM bot_config")->fetch()['m'] ?? null;
                $out['messages_in']       = (int)($hdb->query("SELECT COUNT(*) AS c FROM bot_messages WHERE direction='in'")->fetch()['c'] ?? 0);
                $out['user_count']        = (int)($hdb->query("SELECT COUNT(*) AS c FROM bot_users")->fetch()['c'] ?? 0);
                try {
                    $reqCount = (int)($hdb->query("SELECT COUNT(*) AS c FROM bot_requests")->fetch()['c'] ?? 0);
                    $out['requests_logged'] = $reqCount;
                    if ($reqCount > 0) {
                        $out['success_rate']   = round(((float)$hdb->query("SELECT AVG(success) AS a FROM bot_requests")->fetch()['a']) * 100, 1);
                        $out['avg_latency_ms'] = round((float)$hdb->query("SELECT AVG(latency_ms) AS a FROM bot_requests")->fetch()['a']);
                        $out['recent_errors']  = $hdb->query("SELECT ts, provider, fallback_used, error FROM bot_requests WHERE success=0 ORDER BY ts DESC LIMIT 10")->fetchAll();
                    }
                } catch (\Throwable $e) { /* bot_requests doesn't exist yet — bot not restarted since instrumentation */ }
            } catch (\Throwable $e) { /* hakim.db unreadable/locked */ }
        }
        $kdir = '/var/www/shahnameh/hakim-bot/realshahnameh';
        if (is_dir($kdir)) {
            $files = array_values(array_filter(scandir($kdir), fn($f) => is_file("$kdir/$f")));
            $bytes = 0; foreach ($files as $f) $bytes += filesize("$kdir/$f");
            $out['knowledge_summary'] = count($files) . ' file(s), ' . round($bytes / 1024, 1) . ' KB total';
        }
        api_ok($out);
        break;
    }

    // GET hakim-test-query?question=... — sends a REAL message to the live bot
    case 'hakim-test-query': {
        $question = trim((string)($_GET['question'] ?? ''));
        if ($question === '') api_err('missing question');
        if (mb_strlen($question) > 500) api_err('question too long (max 500 chars)');
        $script = '/var/www/shahnameh/hakim-bot/admin_test_query.py';
        if (!is_readable($script)) api_err('admin_test_query.py not deployed yet');
        $cmd = 'cd /var/www/shahnameh/hakim-bot && /usr/bin/python3 admin_test_query.py '
             . escapeshellarg($question) . ' 2>&1';
        $raw = @shell_exec($cmd);
        $j = json_decode((string)$raw, true);
        if (!is_array($j) || !isset($j['answer'])) {
            api_err('Hakim test query failed: ' . substr((string)$raw, 0, 300));
        }
        api_ok(['answer' => $j['answer']]);
        break;
    }

    // ── Unified user profile ─────────────────────────────────────────────
    case 'user-profile': {
        $db  = open_analytics_db();
        init_device_tables($db);
        $did = trim((string)($_GET['device_id'] ?? ''));
        if (!$did) api_err('device_id required');

        $dev = $db->prepare('SELECT * FROM devices WHERE device_id=?');
        $dev->execute([$did]);
        $d = $dev->fetch(PDO::FETCH_ASSOC);
        if (!$d) api_err('device not found', 404);
        ensure_user_id($db, $d);

        // ── Identity: handle / persona from device_handles + real_profiles ──
        $dh = $db->prepare('SELECT handle,display_name,avatar_emoji,avatar_color FROM device_handles WHERE device_id=?');
        $dh->execute([$did]);
        $handle_row = $dh->fetch(PDO::FETCH_ASSOC) ?: [];
        $rp = ['handle'=>'','display_name'=>'','avatar_emoji'=>'','persona'=>''];
        if (!empty($d['linked_real_account'])) {
            $rq = $db->prepare('SELECT handle,display_name,avatar_emoji,persona FROM real_profiles WHERE account=?');
            $rq->execute([$d['linked_real_account']]);
            $rp = $rq->fetch(PDO::FETCH_ASSOC) ?: $rp;
        }
        $identity = [
            'device_id'           => $d['device_id'],
            'user_id'             => $d['user_id'] ?? '',
            'linked_real_account' => $d['linked_real_account'] ?? '',
            'real_linked_at'      => $d['real_linked_at'] ?? '',
            'handle'              => $rp['handle'] ?: ($handle_row['handle'] ?? ''),
            'display_name'        => $rp['display_name'] ?: ($handle_row['display_name'] ?? ''),
            'avatar_emoji'        => $rp['avatar_emoji'] ?: ($handle_row['avatar_emoji'] ?? ''),
            'persona'             => $rp['persona'] ?? '',
            'plan'                => $d['plan'] ?? 'free',
            'country'             => $d['country'] ?? '',
            'country_name'        => $d['country_name'] ?? '',
            'platform'            => normalize_platform($d),
            'app_version'         => $d['app_version'] ?? '',
            'created_at'          => $d['created_at'] ?? '',
            'last_seen'           => $d['last_seen'] ?? '',
            'stealth_unlocked'    => (bool)($d['stealth_unlocked'] ?? false),
            'test_mode'           => (bool)($d['test_mode'] ?? false),
            'blocked'             => (bool)($d['blocked'] ?? false),
        ];

        // ── Wallet ───────────────────────────────────────────────────────────
        $total_bytes = (int)($d['quota_bytes_total'] ?? 1073741824);
        $used_bytes  = (int)($d['quota_bytes_used']  ?? 0);
        // Lifetime GB earned = sum of all positive quota_transactions
        $lifetime_q = $db->prepare('SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE device_id=? AND bytes>0');
        $lifetime_q->execute([$did]);
        $lifetime_bytes = (int)$lifetime_q->fetchColumn();
        $txq = $db->prepare('SELECT type,bytes,created_at,metadata FROM quota_transactions WHERE device_id=? ORDER BY id DESC LIMIT 10');
        $txq->execute([$did]);
        // REAL balance lives on the Shahnameh backend, not this DB -- fetch it
        // for real via the same re_fetch_profile_summary() contract §9 already
        // uses elsewhere (found unwired here during Khabat's admin-panel audit,
        // 2026-07-22; this call was previously only used by the REAL-economy
        // spend/grant flows, never by the admin panel itself). No TON/chain
        // balance exists anywhere in this ecosystem's backends as of this
        // audit -- left as null rather than fabricating a fetch for a system
        // that was never actually built, unlike REAL which demonstrably is.
        $real_balance = null;
        if (!empty($d['linked_real_account'])) {
            $profile = re_fetch_profile_summary($db, $d['linked_real_account']);
            if ($profile !== null && isset($profile['economy']['real_balance'])) {
                $real_balance = (float)$profile['economy']['real_balance'];
            }
        }
        $wallet = [
            'quota_total_gb'   => round($total_bytes   / 1073741824, 2),
            'quota_used_gb'    => round($used_bytes     / 1073741824, 2),
            'quota_free_gb'    => round(max(0, $total_bytes - $used_bytes) / 1073741824, 2),
            'quota_pct'        => $total_bytes > 0 ? round($used_bytes / $total_bytes * 100) : 0,
            'lifetime_gb'      => round($lifetime_bytes / 1073741824, 2),
            'plan'             => $d['plan'] ?? 'free',
            'plan_expiry'      => $d['valid_until'] ?? null,
            'real_balance'     => $real_balance,
            'ton_balance'      => null,
            'transactions'     => $txq->fetchAll(PDO::FETCH_ASSOC),
        ];

        // ── Freedom: VPN session summary ─────────────────────────────────────
        $sess_all = $db->prepare("SELECT protocol, bytes_sent, bytes_recv, duration_secs, started_at, ended_at, COALESCE(probe_result,'') AS probe_result FROM vpn_sessions WHERE device_id=? ORDER BY id DESC LIMIT 200");
        $sess_all->execute([$did]);
        $sessions_raw = $sess_all->fetchAll(PDO::FETCH_ASSOC);
        $total_sessions = count($sessions_raw);
        $total_bytes_vpn = array_sum(array_column($sessions_raw, 'bytes_recv')) + array_sum(array_column($sessions_raw, 'bytes_sent'));
        $proto_counts = array_count_values(array_column($sessions_raw, 'protocol'));
        arsort($proto_counts);
        $success = array_filter($sessions_raw, fn($s) => in_array($s['probe_result'], ['ok','connected','success',''], true));
        $freedom = [
            'total_sessions'  => $total_sessions,
            'total_gb'        => round($total_bytes_vpn / 1073741824, 3),
            'top_protocol'    => $proto_counts ? array_key_first($proto_counts) : '',
            'success_rate_pct'=> $total_sessions > 0 ? round(count($success) / $total_sessions * 100) : 0,
            'last_session_at' => $sessions_raw[0]['started_at'] ?? '',
            'recent_sessions' => array_slice($sessions_raw, 0, 5),
        ];

        // ── Clan: referral tree ───────────────────────────────────────────────
        $parent_q = $db->prepare("SELECT d.user_id, d.device_id, d.referral_code FROM referral_uses ru JOIN devices d ON d.device_id=ru.referrer_device_id WHERE ru.new_device_id=? LIMIT 1");
        $parent_q->execute([$did]);
        $parent = $parent_q->fetch(PDO::FETCH_ASSOC) ?: null;
        $children_q = $db->prepare("SELECT d.user_id, d.device_id, d.country, d.plan, d.last_seen, ru.status, ru.created_at FROM referral_uses ru JOIN devices d ON d.device_id=ru.new_device_id WHERE ru.referrer_device_id=? ORDER BY ru.id DESC LIMIT 20");
        $children_q->execute([$did]);
        $children = $children_q->fetchAll(PDO::FETCH_ASSOC);
        $active_invites = (int)$db->prepare("SELECT COUNT(*) FROM referral_uses ru JOIN devices d ON d.device_id=ru.new_device_id WHERE ru.referrer_device_id=? AND (d.internet_ok=1 OR d.last_seen>=datetime('now','-7 days'))")->execute([$did]) ? $db->prepare("SELECT COUNT(*) FROM referral_uses ru JOIN devices d ON d.device_id=ru.new_device_id WHERE ru.referrer_device_id=? AND (d.internet_ok=1 OR d.last_seen>=datetime('now','-7 days'))")->execute([$did]) && 0 : 0;
        // simpler active count
        $ac = $db->prepare("SELECT COUNT(*) FROM referral_uses ru JOIN devices d ON d.device_id=ru.new_device_id WHERE ru.referrer_device_id=? AND d.last_seen>=datetime('now','-7 days')");
        $ac->execute([$did]);
        $clan = [
            'invite_count'   => (int)($d['invite_count'] ?? count($children)),
            'active_invites' => (int)$ac->fetchColumn(),
            'referred_by'    => $parent,
            'referrals'      => $children,
            'rank'           => count($children) >= 10 ? 'king' : (count($children) >= 3 ? 'pahlavan' : 'warrior'),
        ];

        // ── Chat activity ────────────────────────────────────────────────────
        $sent_q = $db->prepare("SELECT COUNT(*) FROM user_messages WHERE sender_device=?");
        $sent_q->execute([$did]);
        $recv_q = $db->prepare("SELECT COUNT(*) FROM user_messages WHERE recipient_device=?");
        $recv_q->execute([$did]);
        $last_msg_q = $db->prepare("SELECT created_at FROM user_messages WHERE sender_device=? OR recipient_device=? ORDER BY id DESC LIMIT 1");
        $last_msg_q->execute([$did, $did]);
        $chat = [
            'messages_sent'     => (int)$sent_q->fetchColumn(),
            'messages_received' => (int)$recv_q->fetchColumn(),
            'last_message_at'   => ($last_msg_q->fetch(PDO::FETCH_ASSOC) ?: ['created_at'=>''])['created_at'],
        ];

        // ── Activity timeline (last 30 events across all tables) ─────────────
        $timeline = [];
        // ── Activity timeline (paginated, filterable) ────────────────────────
        $tl_offset  = max(0, (int)($_GET['tl_offset']  ?? 0));
        $tl_limit   = min(50, max(10, (int)($_GET['tl_limit'] ?? 30)));
        $tl_filter  = trim((string)($_GET['tl_filter'] ?? ''));  // vpn|install|referral|quota|app|''
        $tl_page_size = $tl_limit;

        // Fetch enough raw events to fill a page after merging
        $fetch_n = $tl_offset + $tl_page_size * 3 + 30;

        foreach (array_slice($sessions_raw, 0, min($fetch_n, count($sessions_raw))) as $s) {
            $timeline[] = ['ts'=>$s['started_at'],'type'=>'vpn','icon'=>'🌐',
                'label'=>'Connected via '.($s['protocol']??'?'),
                'detail'=>round(((int)$s['bytes_recv']+(int)$s['bytes_sent'])/1048576,1).' MB · '.round(($s['duration_secs']??0)/60).'m'];
        }
        $iev = $db->prepare("SELECT event,current_version,target_version,created_at FROM install_events WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $iev->execute([$did, $fetch_n]);
        foreach ($iev->fetchAll(PDO::FETCH_ASSOC) as $e) {
            $timeline[] = ['ts'=>$e['created_at'],'type'=>'install','icon'=>'📦',
                'label'=>ucfirst(str_replace('_',' ',$e['event'])),
                'detail'=>($e['current_version']??'').' → '.($e['target_version']??'')];
        }
        foreach ($children as $c) {
            $timeline[] = ['ts'=>$c['created_at'],'type'=>'referral','icon'=>'👥',
                'label'=>'Invited '.($c['user_id'] ?: 'new user'),
                'detail'=>$c['status']??'credited'];
        }
        $tq2 = $db->prepare("SELECT type,bytes,created_at FROM quota_transactions WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $tq2->execute([$did, $fetch_n]);
        foreach ($tq2->fetchAll(PDO::FETCH_ASSOC) as $t) {
            $gb = round(abs((int)$t['bytes'])/1073741824, 2);
            $timeline[] = ['ts'=>$t['created_at'],'type'=>'quota','icon'=>'💰',
                'label'=>ucfirst(str_replace('_',' ',$t['type'])),
                'detail'=>($t['bytes']>0?'+':'-').$gb.' GB'];
        }
        $aev = $db->prepare("SELECT event,props,created_at FROM app_events WHERE device_id=? ORDER BY id DESC LIMIT ?");
        $aev->execute([$did, $fetch_n]);
        foreach ($aev->fetchAll(PDO::FETCH_ASSOC) as $e) {
            $timeline[] = ['ts'=>$e['created_at'],'type'=>'app','icon'=>'🎮',
                'label'=>ucfirst(str_replace('_',' ',$e['event'])),
                'detail'=>strlen($e['props']??'') < 80 ? ($e['props']??'') : substr($e['props'],0,77).'…'];
        }

        usort($timeline, fn($a,$b) => strcmp($b['ts'],$a['ts']));
        if ($tl_filter) {
            $timeline = array_values(array_filter($timeline, fn($e) => $e['type'] === $tl_filter));
        }
        $tl_total = count($timeline);
        $timeline  = array_slice($timeline, $tl_offset, $tl_page_size);

        api_ok(compact('identity','wallet','freedom','clan','chat','timeline') + [
            'tl_total'  => $tl_total,
            'tl_offset' => $tl_offset,
            'tl_limit'  => $tl_page_size,
        ]);
        break;
    }

    // ── Monetization / Ads (RealGram Admin overhaul) ───────────────────────
    // See docs/realgram/MONETIZATION_REPORTING.md for the full source-of-truth
    // explanation. Every number below carries a source_type/status_label —
    // never presented as verified unless it actually came from a provider API
    // or a signed provider callback.

    case 'monetization-overview': {
        $db = open_analytics_db();
        [$from, $to] = mon_window();
        $admob   = am_provider_summary($db, 'admob', $from, $to);
        $adsgram = am_provider_summary($db, 'adsgram', $from, $to);
        $rewardCost = am_reward_cost($db, $from, $to);
        $admobCfg   = admob_sync_status($db);
        $adsgramCfg = adsgram_sync_status($db);
        $cfg = am_config($db);

        $rewardsGranted = (int)$db->query(
            "SELECT COUNT(*) FROM ad_events WHERE reward_granted=1 AND date(created_at) BETWEEN " . $db->quote($from) . " AND " . $db->quote($to)
        )->fetchColumn();
        $rewardsFailed = (int)$db->query(
            "SELECT COUNT(*) FROM ad_events WHERE reward_granted=0 AND validation_status IN ('rejected','review') AND date(created_at) BETWEEN " . $db->quote($from) . " AND " . $db->quote($to)
        )->fetchColumn();

        api_ok([
            'window'   => ['from' => $from, 'to' => $to],
            'admob'    => $admob,
            'adsgram'  => $adsgram,
            'reward_cost' => $rewardCost,
            'rewards_granted_count' => $rewardsGranted,
            'rewards_failed_count'  => $rewardsFailed,
            'base_currency' => $cfg['mon_base_currency'],
            'admob_status'   => $admobCfg,
            'adsgram_status' => $adsgramCfg,
            'alerts' => am_alerts($db, $admobCfg['connected'], $adsgramCfg['configured']),
        ]);
        break;
    }

    case 'monetization-admob': {
        $db = open_analytics_db();
        [$from, $to] = mon_window();
        $arCfg = ar_config($db);
        api_ok([
            'window'  => ['from' => $from, 'to' => $to],
            'summary' => am_provider_summary($db, 'admob', $from, $to),
            'ad_units' => am_ad_unit_breakdown($db, 'admob', $from, $to),
            'sync_status' => admob_sync_status($db),
            'app_config' => [
                'admob_app_id'           => $arCfg['admob_app_id'],
                'admob_rewarded_unit_id' => $arCfg['admob_rewarded_unit_id'],
                'admob_ssv_enabled'      => (bool)$arCfg['admob_ssv_enabled'],
            ],
        ]);
        break;
    }

    case 'monetization-adsgram': {
        $db = open_analytics_db();
        [$from, $to] = mon_window();
        $blockIds = $db->query(
            "SELECT DISTINCT ad_unit_id FROM ad_daily_metrics WHERE provider='adsgram' AND ad_unit_id <> '' ORDER BY ad_unit_id"
        )->fetchAll(PDO::FETCH_COLUMN);
        api_ok([
            'window'  => ['from' => $from, 'to' => $to],
            'summary' => am_provider_summary($db, 'adsgram', $from, $to),
            'ad_units' => am_ad_unit_breakdown($db, 'adsgram', $from, $to),
            'sync_status' => adsgram_sync_status($db),
            'known_block_ids' => $blockIds,
        ]);
        break;
    }

    case 'monetization-reward-events': {
        $db = open_analytics_db();
        $filters = [];
        foreach (['provider', 'validation_status', 'app', 'user_id', 'reward_type', 'platform', 'ad_unit_id', 'from', 'to'] as $k) {
            if (isset($_GET[$k]) && $_GET[$k] !== '') $filters[$k] = (string)$_GET[$k];
        }
        $filters['limit']  = (int)($_GET['limit']  ?? 50);
        $filters['offset'] = (int)($_GET['offset'] ?? 0);
        api_ok(am_reward_events($db, $filters));
        break;
    }

    case 'monetization-reconciliation': {
        $db = open_analytics_db();
        [$from, $to] = mon_window();
        api_ok([
            'window'  => ['from' => $from, 'to' => $to],
            'admob'   => am_reconciliation($db, 'admob', $from, $to),
            'adsgram' => am_reconciliation($db, 'adsgram', $from, $to),
        ]);
        break;
    }

    case 'monetization-config': {
        $db = open_analytics_db();
        $cfg = am_config($db);
        $arCfg = ar_config($db);
        api_ok([
            'config' => $cfg,
            'admob' => [
                'sync_status'    => admob_sync_status($db),
                'app_id'         => $arCfg['admob_app_id'],
                'rewarded_unit_id' => $arCfg['admob_rewarded_unit_id'],
                'ssv_enabled'    => (bool)$arCfg['admob_ssv_enabled'],
                'oauth_start_url' => '/_setalink-admin/admob_oauth_start.php',
            ],
            'adsgram' => [
                'sync_status' => adsgram_sync_status($db),
                'token_configured' => adsgram_publisher_configured($db),
            ],
        ]);
        break;
    }

    case 'monetization-logs': {
        $db = open_analytics_db();
        am_init_tables($db);
        $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
        api_ok([
            'admin_log' => $db->query("SELECT * FROM monetization_admin_log ORDER BY id DESC LIMIT $limit")->fetchAll(PDO::FETCH_ASSOC),
            'csv_imports' => $db->query("SELECT * FROM ad_csv_imports ORDER BY id DESC LIMIT $limit")->fetchAll(PDO::FETCH_ASSOC),
        ]);
        break;
    }

    case 'monetization-csv-export': {
        $db = open_analytics_db();
        $what = (string)($_GET['what'] ?? 'reward-events');
        [$from, $to] = mon_window();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="monetization-' . preg_replace('/[^a-z-]/', '', $what) . '-' . $from . '_' . $to . '.csv"');
        $out = fopen('php://output', 'w');
        if ($what === 'daily-metrics') {
            fputcsv($out, ['date','provider','app','platform','ad_unit_id','requests','matched_requests','shown','impressions','clicks','completions','rewards_granted','rewards_failed','revenue','currency','source_type']);
            $rows = $db->prepare("SELECT * FROM ad_daily_metrics WHERE date BETWEEN ? AND ? ORDER BY date, provider");
            $rows->execute([$from, $to]);
            foreach ($rows as $r) {
                fputcsv($out, [$r['date'],$r['provider'],$r['app'],$r['platform'],$r['ad_unit_id'],$r['requests'],$r['matched_requests'],$r['shown'],$r['impressions'],$r['clicks'],$r['completions'],$r['rewards_granted'],$r['rewards_failed'],$r['revenue'],$r['currency'],$r['source_type']]);
            }
        } else {
            $res = am_reward_events($db, ['from' => $from, 'to' => $to, 'limit' => 5000]);
            fputcsv($out, ['created_at','provider','app','platform','placement','ad_unit_id','user_id','internal_account_id','provider_transaction_id','reward_type','reward_amount','reward_granted','validation_status','source_type','error_message']);
            foreach ($res['rows'] as $r) {
                fputcsv($out, [$r['created_at'],$r['provider'],$r['app'],$r['platform'],$r['placement'],$r['ad_unit_id'],$r['user_id'],$r['internal_account_id'],$r['provider_transaction_id'],$r['reward_type'],$r['reward_amount'],$r['reward_granted'],$r['validation_status'],$r['source_type'],$r['error_message']]);
            }
        }
        fclose($out);
        exit;
    }

    default: api_err('unknown action');
}
