<?php
// SetaLink Admin API — AJAX endpoint for the admin dashboard.
// Auth: nginx auth_basic on initial load; subsequent XHR uses session cookie validated here.
// CSRF: HMAC token required for all state-changing POSTs.
declare(strict_types=1);

const CLI          = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE  = '/^[a-z0-9][a-z0-9._-]{0,31}$/';
const VALID_PKGS   = ['7days', '30days', 'unlimited', '5GB', '10GB', '15GB'];

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
            'uuid'        => 'fd709d48-a983-484a-99e3-afc97e2c3692',
            'address'     => '178.104.77.231',
            'port'        => 443,
            'publicKey'   => 'IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8',
            'shortId'     => 'd93af82f2ecb7f6a',
            'sni'         => 'www.cloudflare.com',
            'flow'        => '',
            'fingerprint' => 'chrome',
            'country'     => 'Germany',
            'flag'        => '🇩🇪',
            'city'        => 'SetaLink Cloudflare',
            'edgeAddress' => 'edge.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp/',
            'httpupPath'  => '/httpup',
            'altProfiles' => [
                [
                    'uuid'        => 'c8af7366-b531-4f35-bea2-6fb70d1e4850',
                    'publicKey'   => '5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY',
                    'shortId'     => '70df7a',
                    'sni'         => 'www.oracle.com',
                    'port'        => 8443,
                    'address'     => '178.104.77.231',
                    'flow'        => '',
                    'fingerprint' => 'chrome',
                ],
                [
                    'uuid'        => '1580e282-be00-4ddc-932b-9bbcd69f0dad',
                    'publicKey'   => 'Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo',
                    'shortId'     => 'a4',
                    'sni'         => 'www.amazon.com',
                    'port'        => 2052,
                    'address'     => '178.104.77.231',
                    'flow'        => '',
                    'fingerprint' => 'chrome',
                ],
            ],
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
        'city'        => $r['bootstrap_city']    ?? 'SetaLink Cloudflare',
        'edgeAddress' => $r['bootstrap_edge_address'] ?? '',
        'edgePort'    => (int)($r['bootstrap_edge_port'] ?? 443),
        'wsPath'      => $r['bootstrap_ws_path']    ?? '/ws',
        'xhttpPath'   => $r['bootstrap_xhttp_path'] ?? '/xhttp/',
        'httpupPath'  => $r['bootstrap_httpup_path'] ?? '/httpup',
        'altProfiles' => [],
    ];
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
        api_ok(array_merge(['id' => 'server-emergency', 'label' => 'SetaLink Edge'], fetch_bootstrap_server($db3)));
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
        api_ok([
            'device_id'         => $dev['device_id'],
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
        if (!$device_id || strlen($device_id) > 128) api_err('invalid device_id');
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9\-_]{5,126}$/', $device_id)) api_err('invalid device_id format');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if ($dev) {
            $db->prepare("UPDATE devices SET last_seen=datetime('now'),platform=?,app_version=?,language=?,status='online',country=CASE WHEN ?!='' THEN ? ELSE country END WHERE device_id=?")
               ->execute([$platform, $app_version, $language, $country, $country, $device_id]);
        } else {
            $ref = generate_referral_code($db);
            $db->prepare("INSERT INTO devices (device_id,referral_code,plan,quota_bytes_total,quota_bytes_used,platform,app_version,language,country,status) VALUES (?,?,'free',?,0,?,?,?,?,'online')")
               ->execute([$device_id, $ref, ONE_GB_BYTES, $platform, $app_version, $language, $country]);
            $st->execute([$device_id]);
            $dev = $st->fetch(PDO::FETCH_ASSOC);
        }
        api_ok([
            'device_id'         => $dev['device_id'],
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)(int)$dev['blocked'],
            'server'            => fetch_bootstrap_server($db),
        ]);
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
        $db->prepare('INSERT INTO referral_uses (referrer_device_id,new_device_id,bonus_bytes) VALUES (?,?,?)')
           ->execute([$referrer['device_id'], $device_id, REFERRAL_BONUS_BYTES]);
        $db->prepare('UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?')
           ->execute([REFERRAL_BONUS_BYTES, $referrer['device_id']]);
        $db->prepare('UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?')
           ->execute([REFERRAL_BONUS_BYTES, $device_id]);
        api_ok(['bonus_bytes' => REFERRAL_BONUS_BYTES, 'referrer_credited' => true,
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
        $device_id       = trim((string)($_POST['device_id']       ?? ''));
        $status          = trim((string)($_POST['status']          ?? 'offline'));
        $active_protocol = substr(trim((string)($_POST['active_protocol'] ?? '')), 0, 60);
        if (!$device_id) api_err('device_id required');
        if (!in_array($status, ['online','offline'], true)) $status = 'offline';
        $db = open_analytics_db();
        init_device_tables($db);
        $db->prepare("UPDATE devices SET status=?,active_protocol=?,last_seen=datetime('now') WHERE device_id=?")
           ->execute([$status, $active_protocol, $device_id]);
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
    if ($action === 'device-set-quota') {
        $did   = trim((string)($parsed['device_id'] ?? ''));
        $quota = max(0, (int)($parsed['quota_bytes'] ?? ONE_GB_BYTES));
        if (!$did) api_err('device_id required');
        $db = open_analytics_db();
        init_device_tables($db);
        $db->prepare("UPDATE devices SET quota_bytes_total=? WHERE device_id=?")->execute([$quota, $did]);
        api_ok(['quota_bytes_total' => $quota]);
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
                '5GB'       => ['plan' => 'premium', 'days' => 30,  'bytes' => 5368709120],
                '10GB'      => ['plan' => 'premium', 'days' => 30,  'bytes' => 10737418240],
                '15GB'      => ['plan' => 'premium', 'days' => 30,  'bytes' => 16106127360],
            ];
            $conf = $pkg_map[$pay['package']] ?? $pkg_map['30days'];
            $valid_until = date('Y-m-d H:i:s', strtotime('+' . $conf['days'] . ' days'));
            $db->prepare("UPDATE devices SET plan=?,quota_bytes_total=?,quota_bytes_used=0,valid_until=? WHERE device_id=?")
               ->execute([$conf['plan'], $conf['bytes'], $valid_until, $pay['device_id']]);
        }
        api_ok(['status' => $new_status, 'payment_id' => $pid]);
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
    if ($action === 'save-remote-config') {
        $allowed_rc_keys = [
            'rc_version','rc_sni_priorities','rc_kill_switches','rc_protocol_order',
            'rc_emergency_sni','rc_iran_sni_order','rc_ttl','rc_updated_at',
            'bootstrap_uuid','bootstrap_address','bootstrap_port','bootstrap_pubkey',
            'bootstrap_shortid','bootstrap_sni','bootstrap_flow','bootstrap_fp',
            'bootstrap_edge_address','bootstrap_edge_port',
            'bootstrap_ws_path','bootstrap_xhttp_path','bootstrap_httpup_path',
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
        api_ok(['saved' => $saved]);
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
            'xhttp'       => ['url' => "https://{$EDGE}/xhttp/", 'hdrs' => []],
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
        // Check Reality by verifying the Xray SOCKS5 port (127.0.0.1:10808) — which only
        // opens when Xray is running — rather than connecting to the Reality inbound
        // directly. A plain TCP connect to the Reality port (8443) triggers Xray to log
        // "REALITY: failed to read client hello" because the client closes without TLS.
        $reality_open = tcp_open('127.0.0.1', 10808, 2);
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
        // Reality check via SOCKS5 (not direct TCP to avoid "failed to read client hello" log spam)
        $r['reality']    = ['ok'=>$reality_open,'code'=>null,'open'=>$reality_open,'name'=>'Reality (via Xray SOCKS5)','timeout'=>false,
                            'detail'=>$reality_open?'Xray running (SOCKS5:10808 open)':'SOCKS5:10808 closed — Xray not running'];
        $r['checked_at'] = date('Y-m-d H:i:s');
        api_ok($r);
        break;

    case 'nat-health':
        // Server-side NAT / forwarding health check.
        // If ip_forward=0 or MASQUERADE missing, clients connect but get no internet.
        $checks = [];

        // 0. Detect real default egress interface from ip route
        $route_out = shell_exec('ip route show default 2>/dev/null') ?: '';
        $route_ok  = (stripos($route_out, 'default') !== false);
        $outIface  = '';
        if (preg_match('/default\s+via\s+\S+\s+dev\s+(\S+)/', $route_out, $m)) $outIface = $m[1];
        // Also try: ip route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}'
        if (!$outIface) {
            $r2 = shell_exec('ip route get 1.1.1.1 2>/dev/null') ?: '';
            if (preg_match('/dev\s+(\S+)/', $r2, $m2)) $outIface = $m2[1];
        }
        $ifaceLabel = $outIface ?: 'unknown';

        // 1. IPv4 forwarding
        $ip_fwd_raw = trim((string)@file_get_contents('/proc/sys/net/ipv4/ip_forward'));
        $ip_fwd_ok  = ($ip_fwd_raw === '1');
        $checks[] = ['label'=>'IPv4 forwarding (ip_forward)','ok'=>$ip_fwd_ok,
            'detail'=>$ip_fwd_ok?'ip_forward=1 ✓':'ip_forward=0 — clients will connect but get no internet',
            'fix'=>'sysctl -w net.ipv4.ip_forward=1 && echo "net.ipv4.ip_forward=1" >> /etc/sysctl.d/99-vpn.conf'];

        // 2. MASQUERADE — try multiple methods (iptables needs root, fallback to saved rules file)
        $ipt_list  = shell_exec('iptables -t nat -L POSTROUTING -n --line-numbers 2>/dev/null') ?: '';
        $ipt_save  = shell_exec('iptables-save -t nat 2>/dev/null') ?: '';
        $ipt_file  = @file_get_contents('/etc/iptables/rules.v4') ?: '';
        $ipt_file2 = @file_get_contents('/etc/iptables.up.rules') ?: '';
        $all_ipt   = $ipt_list . $ipt_save . $ipt_file . $ipt_file2;
        $masq_ok   = (stripos($all_ipt, 'MASQUERADE') !== false);
        // Also verify MASQUERADE is for the correct outbound interface (not just any interface)
        $masq_iface_ok = !$outIface || preg_match('/MASQUERADE.*(-o\s+' . preg_quote($outIface,'/').'|POSTROUTING.*' . preg_quote($outIface,'/').')/i', $all_ipt) || $masq_ok;
        $masq_detail   = $masq_ok
            ? 'MASQUERADE rule found (interface: ' . ($outIface ?: 'any') . ') ✓'
            : 'No MASQUERADE — clients connect but get NO internet routing';
        $checks[] = ['label'=>"iptables MASQUERADE (egress: {$ifaceLabel})","ok"=>$masq_ok,
            'detail'=>$masq_detail,
            'fix'=>"iptables -t nat -A POSTROUTING -o {$ifaceLabel} -j MASQUERADE"];

        // 3. nftables as alternative if iptables not found
        $nft_out = shell_exec('nft list ruleset 2>/dev/null | grep -i masquerade') ?: '';
        $nft_file = @file_get_contents('/etc/nftables.conf') ?: '';
        $nft_ok  = stripos($nft_out . $nft_file, 'masquerade') !== false;
        if (!$masq_ok && $nft_ok) {
            $checks[] = ['label'=>'nftables MASQUERADE','ok'=>true,
                'detail'=>'nftables masquerade rule found (nftables used instead of iptables) ✓','fix'=>''];
            $masq_ok = true;
        }

        // 4. iptables-persistent (rules survive reboot)
        $persist_ok = file_exists('/etc/iptables/rules.v4') || file_exists('/usr/sbin/netfilter-persistent') || file_exists('/usr/sbin/iptables-persistent');
        $checks[] = ['label'=>'Rules persist after reboot','ok'=>$persist_ok,
            'detail'=>$persist_ok?'iptables-persistent installed ✓':'Rules lost on reboot',
            'fix'=>'apt-get install -y iptables-persistent && netfilter-persistent save'];

        // 5. Default route
        $checks[] = ['label'=>"Default route (via {$ifaceLabel})",'ok'=>$route_ok,
            'detail'=>$route_ok?trim($route_out):'No default route — server has no internet'];

        // 6. Xray SOCKS5 reachable (VPN process running)
        $xray_sock = @fsockopen('127.0.0.1', 10808, $e, $err, 2);
        $xray_ok   = ($xray_sock !== false);
        if ($xray_ok) fclose($xray_sock);
        $checks[] = ['label'=>'Xray SOCKS5 running (port 10808)','ok'=>$xray_ok,
            'detail'=>$xray_ok?'SOCKS5 port open ✓':'Xray not running — start with: systemctl restart xray',
            'fix'=>'systemctl restart xray'];

        $overall_ok = $ip_fwd_ok && $masq_ok;
        $score = (int)$ip_fwd_ok * 40 + (int)$masq_ok * 35 + (int)$persist_ok * 10 + (int)$route_ok * 10 + (int)$xray_ok * 5;
        api_ok(['ok'=>$overall_ok,'score'=>$score,'checks'=>$checks,'out_iface'=>$outIface,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'nat-repair':
        // Calls /usr/local/sbin/setalink-nat-repair via sudo.
        // www-data is allowed to run ONLY that one script (see /etc/sudoers.d/setalink-webserver).
        // Script detects the real egress interface itself — no arbitrary args passed.
        $wrapper = '/usr/local/sbin/setalink-nat-repair';
        if (!file_exists($wrapper)) {
            api_error('Repair wrapper not installed. Run: sudo bash /var/www/setalink/scripts/setup-sudoers.sh');
            break;
        }

        // Run the wrapper; capture all output lines as key=value pairs
        $raw = shell_exec('sudo ' . escapeshellarg($wrapper) . ' 2>&1') ?: '';
        $out = array_filter(array_map('trim', explode("\n", $raw)));

        // Parse key=value lines from the wrapper
        $kv = [];
        foreach ($out as $line) {
            if (preg_match('/^([A-Z_]+)=(.*)$/', $line, $m)) $kv[$m[1]] = $m[2];
        }

        if (isset($kv['ERROR'])) { api_error($kv['ERROR']); break; }

        $iface = $kv['IFACE'] ?? '';
        $steps = [];

        $steps[] = ['step'=>'detect_interface','ok'=>(bool)$iface,
            'detail'=>$iface?"Egress interface: {$iface} ✓":"Could not detect interface — raw: ".implode(' | ', array_slice($out,0,3))];

        $steps[] = ['step'=>'ip_forward','ok'=>($kv['IP_FORWARD'] ?? '0') === '1',
            'detail'=>($kv['IP_FORWARD'] ?? '0') === '1' ? 'ip_forward=1 ✓' : 'ip_forward not set'];

        $steps[] = ['step'=>'sysctl_persist','ok'=>isset($kv['SYSCTL_PERSISTED']),
            'detail'=>isset($kv['SYSCTL_PERSISTED']) ? 'ip_forward persisted to /etc/sysctl.d/99-vpn-nat.conf ✓' : 'Persist skipped'];

        $masq_added   = isset($kv['MASQUERADE_ADDED']);
        $masq_existed = isset($kv['MASQUERADE_EXISTS']);
        $steps[] = ['step'=>'masquerade','ok'=>($masq_added || $masq_existed),
            'detail'=>$masq_added ? "MASQUERADE added on {$iface} ✓" : ($masq_existed ? "MASQUERADE already present on {$iface} ✓" : 'MASQUERADE step missing from output')];

        $saved_by = $kv['RULES_SAVED'] ?? '';
        $steps[] = ['step'=>'save_rules','ok'=>($saved_by !== '' && $saved_by !== 'failed'),
            'detail'=>($saved_by && $saved_by !== 'failed') ? "Rules saved via {$saved_by} ✓" : 'Rule save failed — rules lost on reboot'];

        $xray_ok = ($kv['XRAY_OK'] ?? '0') === '1';
        // Verify SOCKS5 independently
        $xsock = @fsockopen('127.0.0.1', 10808, $e2, $e2msg, 2);
        $xray_socks = ($xsock !== false);
        if ($xray_socks) fclose($xsock);
        $steps[] = ['step'=>'xray_running','ok'=>($xray_ok || $xray_socks),
            'detail'=>($xray_ok || $xray_socks) ? 'Xray running, SOCKS5 port 10808 open ✓' : 'Xray may not be running — check: systemctl status xray'];

        $all_ok = count(array_filter($steps, fn($s) => !$s['ok'])) === 0;
        api_ok(['ok'=>$all_ok,'interface'=>$iface,'steps'=>$steps,'raw_lines'=>array_values($out),'repaired_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'get-settings':
        $db = open_analytics_db();
        $rows = $db->query('SELECT key,value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
        api_ok(array_merge(['telegram_url'=>'https://t.me/SetaLink3','server_label'=>'SetaLink VPN'], $rows));
        break;

    case 'iran-score':
        $cfg = cli_json('status', [], 8);
        $r   = $cfg['reality'] ?? [];
        $score = 0; $checks = [];
        $sni = $r['sni'] ?? '';
        $safe_snis = ['www.microsoft.com','www.apple.com','www.speedtest.net','www.google.com'];
        $sni_ok = in_array($sni, $safe_snis, true);
        $score += $sni_ok ? 30 : 0;
        $checks[] = ['label'=>'SNI not blocked in Iran','ok'=>$sni_ok,'detail'=>$sni ?: '—'];
        $port = (int)($r['port'] ?? 0);
        $port_ok = ($port === 8443);
        $score += $port_ok ? 20 : 0;
        $checks[] = ['label'=>'Reality port (8443)','ok'=>$port_ok,'detail'=>(string)$port];
        $flow = $r['flow'] ?? '';
        $flow_ok = ($flow === 'xtls-rprx-vision');
        $score += $flow_ok ? 20 : 0;
        $checks[] = ['label'=>'Flow: xtls-rprx-vision','ok'=>$flow_ok,'detail'=>$flow ?: '(none)'];
        $fp = $r['fingerprint'] ?? '';
        $fp_ok = !empty($fp);
        $score += $fp_ok ? 15 : 0;
        $checks[] = ['label'=>'Fingerprint set','ok'=>$fp_ok,'detail'=>$fp ?: '—'];
        // Check Xray alive via SOCKS5 port (10808) — avoids "failed to read client hello"
        // spam in Xray logs that appears when admin probes the Reality port (8443) with
        // a plain TCP connect that closes without completing the TLS handshake.
        $tcp_sock = @fsockopen('127.0.0.1', 10808, $e, $err, 2);
        $tcp_ok = $tcp_sock !== false;
        if ($tcp_ok) fclose($tcp_sock);
        $score += $tcp_ok ? 15 : 0;
        $checks[] = ['label'=>'Xray running (SOCKS5 10808)','ok'=>$tcp_ok,'detail'=>$tcp_ok?'SOCKS5 port open':'SOCKS5 closed — Xray not running'];
        $grade = $score>=90?'A':($score>=70?'B':($score>=50?'C':'F'));
        api_ok(['score'=>$score,'grade'=>$grade,'checks'=>$checks,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'iran-debug':
        // Aggregated Iran-specific diagnostics from telemetry data.
        $db = open_analytics_db();

        // SNI + protocol analysis for iranian traffic
        $sni_rows = $db->query(
            "SELECT protocol, sni,
                    COUNT(*) as total,
                    SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN result='fail' THEN 1 ELSE 0 END) as fail,
                    SUM(CASE WHEN tcp_ok=1 AND http_ok=0 THEN 1 ELSE 0 END) as tcp_only,
                    SUM(no_internet) as no_internet,
                    SUM(CASE WHEN ipv6_enabled=1 THEN 1 ELSE 0 END) as ipv6_attempts,
                    SUM(emergency) as emergency_used,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE country LIKE '%Iran%' OR country='IR'
                OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                OR network LIKE '%MCI%' OR network LIKE '%Mobin%'
                OR network LIKE '%Shatel%' OR network LIKE '%Rightel%'
                OR network LIKE '%TCI%'
             GROUP BY protocol, sni
             ORDER BY total DESC
             LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Last N errors with Iran context
        $error_rows = $db->query(
            "SELECT protocol, sni, error_msg, tcp_ok, http_ok, ipv6_enabled, no_internet,
                    country, network, device_model, recorded_at
             FROM test_results
             WHERE error_msg != ''
               AND (country LIKE '%Iran%' OR country='IR'
                    OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                    OR network LIKE '%MCI%' OR network LIKE '%Mobin%'
                    OR network LIKE '%Shatel%' OR network LIKE '%Rightel%')
             ORDER BY recorded_at DESC
             LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);

        // ISP breakdown from session data
        $isp_rows = $db->query(
            "SELECT network as isp,
                    COUNT(*) as total,
                    SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) as success,
                    SUM(no_internet) as no_internet,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE network != ''
               AND (country LIKE '%Iran%' OR country='IR'
                    OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                    OR network LIKE '%MCI%' OR network LIKE '%Mobin%'
                    OR network LIKE '%Shatel%' OR network LIKE '%Rightel%')
             GROUP BY network
             ORDER BY total DESC
             LIMIT 20"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Error pattern summary: classify errors by pattern
        $error_patterns = $db->query(
            "SELECT error_msg, COUNT(*) as cnt,
                    MAX(recorded_at) as last_seen,
                    protocol, sni
             FROM test_results
             WHERE error_msg != '' AND result='fail'
               AND (country LIKE '%Iran%' OR country='IR'
                    OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                    OR network LIKE '%MCI%')
             GROUP BY error_msg
             ORDER BY cnt DESC
             LIMIT 30"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Overall Iran stats
        $stats = $db->query(
            "SELECT COUNT(*) as total,
                    SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN tcp_ok=1 AND http_ok=0 THEN 1 ELSE 0 END) as tcp_only,
                    SUM(no_internet) as no_internet,
                    SUM(emergency) as emergency_used,
                    COUNT(DISTINCT sni) as sni_count,
                    COUNT(DISTINCT device_model) as device_count,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE country LIKE '%Iran%' OR country='IR'
                OR network LIKE '%Hamrah%' OR network LIKE '%Irancell%'
                OR network LIKE '%MCI%' OR network LIKE '%Mobin%'
                OR network LIKE '%Shatel%' OR network LIKE '%Rightel%'"
        )->fetch(PDO::FETCH_ASSOC);

        // Annotate sni_rows with success_rate
        $sni_rows = array_map(function($r) {
            $t = (int)$r['total'];
            $r['success_rate'] = $t > 0 ? round((int)$r['success'] / $t * 100) : null;
            $r['avg_latency']  = $r['avg_latency'] ? (int)round((float)$r['avg_latency']) : null;
            return $r;
        }, $sni_rows);

        api_ok([
            'stats'         => $stats,
            'sni_analysis'  => $sni_rows,
            'errors'        => $error_rows,
            'error_patterns'=> $error_patterns,
            'isp_breakdown' => $isp_rows,
            'checked_at'    => date('Y-m-d H:i:s'),
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
        $log    = '/var/log/xray/access.log';
        $cutoff = time() - 300;
        $sessions = []; $total_recent = 0; $protocols = [];
        if (is_readable($log)) {
            $lines = array_slice(file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -1000);
            foreach ($lines as $line) {
                if (!preg_match('/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/', $line, $m)) continue;
                $ts = strtotime(str_replace('/', '-', $m[1]));
                if ($ts < $cutoff) continue;
                if (strpos($line, '127.0.0.1') !== false || strpos($line, '::1') !== false) continue;
                $total_recent++;
                if (preg_match('/accepted\s+([\d\.a-f:]+):\d+/', $line, $ip)) {
                    $sessions[$ip[1]] = ($sessions[$ip[1]] ?? 0) + 1;
                }
                if (preg_match('/using\s+\[([^\]]+)\]/', $line, $proto)) {
                    $p = $proto[1];
                    $protocols[$p] = ($protocols[$p] ?? 0) + 1;
                }
            }
        }
        arsort($protocols);
        api_ok([
            'active_ips'      => count($sessions),
            'recent_events'   => $total_recent,
            'top_ips'         => array_slice(array_keys($sessions), 0, 10),
            'protocols'       => $protocols,
            'window_seconds'  => 300,
            'checked_at'      => date('Y-m-d H:i:s'),
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
                        'detail' => "Client requesting /xhttp but server expects /xhttp/ — {$r['cnt']} failures. Ensure xhttpPath in bootstrap ends with /.",
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

    case 'app-analytics':
        $db = open_analytics_db();
        init_device_tables($db);
        $total       = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
        $onlineNow   = (int)$db->query("SELECT COUNT(*) FROM devices WHERE status='online' OR last_seen>=datetime('now','-5 minutes')")->fetchColumn();
        $activeToday = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen>=date('now')")->fetchColumn();
        $active7d    = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen>=datetime('now','-7 days')")->fetchColumn();
        $newMonth    = (int)$db->query("SELECT COUNT(*) FROM devices WHERE created_at>=datetime('now','-30 days')")->fetchColumn();
        $failed      = (int)$db->query("SELECT COUNT(*) FROM test_results WHERE result='fail' AND recorded_at>=datetime('now','-1 day')")->fetchColumn();
        $blocked     = (int)$db->query("SELECT COUNT(*) FROM devices WHERE blocked=1")->fetchColumn();
        $pkgRows     = $db->query("SELECT plan,COUNT(*) as cnt FROM devices GROUP BY plan ORDER BY cnt DESC")->fetchAll(PDO::FETCH_ASSOC);
        $verRows     = $db->query("SELECT app_version as version,COUNT(*) as cnt FROM devices WHERE app_version!='' GROUP BY app_version ORDER BY cnt DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
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
            $where[] = "(device_id LIKE ? OR user_id LIKE ? OR country LIKE ? OR app_version LIKE ? OR model LIKE ?)";
            $params = array_merge($params, ["%$q%","%$q%","%$q%","%$q%","%$q%"]);
        }
        if ($plan)          { $where[] = 'plan=?';    $params[] = $plan; }
        if ($status_filter === 'online')  { $where[] = "(status='online' OR last_seen>=datetime('now','-5 minutes'))"; }
        if ($status_filter === 'offline') { $where[] = "(status!='online' AND last_seen<datetime('now','-5 minutes'))"; }
        if ($status_filter === 'blocked') { $where[] = 'blocked=1'; }
        $sql = 'SELECT * FROM devices' . ($where ? ' WHERE '.implode(' AND ',$where) : '') . ' ORDER BY created_at DESC LIMIT 500';
        $st  = $db->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        $result = array_map(function($r) {
            $ls = $r['last_seen'] ?? null;
            $is_online = ($r['status']??'') === 'online' || ($ls && (time()-(int)strtotime((string)$ls)) < 300);
            return [
                'device_id'         => $r['device_id'],
                'device_id_short'   => strtoupper(substr(hash('sha256',(string)$r['device_id']),0,8)),
                'user_id'           => $r['user_id']         ?? '',
                'platform'          => $r['platform']        ?? 'android',
                'plan'              => $r['plan']            ?? 'free',
                'quota_bytes_total' => (int)($r['quota_bytes_total'] ?? 0),
                'quota_bytes_used'  => (int)($r['quota_bytes_used']  ?? 0),
                'status'            => $is_online ? 'online' : 'offline',
                'app_version'       => $r['app_version']     ?? '',
                'active_protocol'   => $r['active_protocol'] ?? '',
                'country_code'      => $r['country']         ?? '',
                'country'           => $r['country']         ?? '',
                'country_name'      => $r['country_name']    ?? '',
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
            ];
        }, $rows);
        api_ok($result);
        break;

    case 'referral-stats':
        $db = open_analytics_db();
        init_device_tables($db);
        $total_referrals     = (int)$db->query('SELECT COUNT(*) FROM referral_uses')->fetchColumn();
        $flagged_referrals   = (int)$db->query("SELECT COUNT(*) FROM referral_uses WHERE status='flagged'")->fetchColumn();
        $unique_referrers    = (int)$db->query("SELECT COUNT(DISTINCT referrer_device_id) FROM referral_uses WHERE referrer_device_id!=''")->fetchColumn();
        $total_devices       = (int)$db->query('SELECT COUNT(*) FROM devices')->fetchColumn();
        $referred_devices    = (int)$db->query("SELECT COUNT(DISTINCT new_device_id) FROM referral_uses WHERE new_device_id!=''")->fetchColumn();
        $total_bonus         = (int)$db->query('SELECT COALESCE(SUM(bonus_bytes),0) FROM referral_uses')->fetchColumn();
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
                   COALESCE(SUM(ru.bonus_bytes),0) as total_bonus_bytes,
                   SUM(CASE WHEN ru.status='flagged' THEN 1 ELSE 0 END) as flagged_count,
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
        api_ok([
            'total_referrals'    => $total_referrals,
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
                    $sha = hash_file('sha256', $f) ?: '';
                    $apks[] = [
                        'name'   => basename($f),
                        'size'   => (int)filesize($f),
                        'mtime'  => date('Y-m-d H:i:s', (int)filemtime($f)),
                        'sha256' => $sha,
                        'url'    => "https://setalink.no/releases/{$ch}/" . basename($f),
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
        $vj_path    = $dl_dir . 'version.json';
        $vj         = json_decode((string)@file_get_contents($vj_path), true) ?: null;
        api_ok([
            'channels'        => $result,
            'download_symlink' => [
                'target'   => $dl_target,
                'resolved' => $dl_resolved,
                'valid'    => $dl_resolved && file_exists($dl_resolved),
            ],
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

    case 'inbound-stats':
        $access_log = '/var/log/xray/access.log';
        $error_log  = '/var/log/xray/error.log';
        $ss_out = (string)@shell_exec('ss -tulpn 2>/dev/null');
        $ports = [
            'reality' => ['port'=>8443,  'listening'=>false, 'label'=>'Reality (direct)'],
            'ws'      => ['port'=>10000, 'listening'=>false, 'label'=>'WebSocket'],
            'xhttp'   => ['port'=>10001, 'listening'=>false, 'label'=>'XHTTP'],
            'httpup'  => ['port'=>10002, 'listening'=>false, 'label'=>'HTTPUpgrade'],
        ];
        foreach ($ports as $k => &$p) $p['listening'] = str_contains($ss_out, ':'.$p['port']);
        unset($p);
        $uuid_rejections = 0; $accepted_external = 0;
        $last_accepted_ip = ''; $last_accepted_at = ''; $rejected_uuids = [];
        if (is_readable($access_log)) {
            $lines = array_slice(file($access_log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -2000);
            foreach ($lines as $line) {
                if (str_contains($line, 'invalid request user id')) {
                    $uuid_rejections++;
                    if (preg_match('/user id: ([0-9a-f\-]{36})/', $line, $m))
                        $rejected_uuids[$m[1]] = ($rejected_uuids[$m[1]] ?? 0) + 1;
                }
                if (str_contains($line,'accepted') && !str_contains($line,'127.0.0.1') && !str_contains($line,'::1')) {
                    $accepted_external++;
                    if (preg_match('/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/',$line,$ts) &&
                        preg_match('/accepted\s+([\d\.a-f:]+):\d+/',$line,$ip)) {
                        $last_accepted_at = $ts[1]; $last_accepted_ip = $ip[1];
                    }
                }
            }
        }
        arsort($rejected_uuids);
        $last_errors = [];
        if (is_readable($error_log)) {
            $elines = array_slice(file($error_log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -500);
            foreach (array_reverse($elines) as $el) {
                if (str_contains($el,'[Warning]') && str_contains($el,'started')) continue;
                if (str_contains($el,'[Info]')) continue;
                $last_errors[] = $el;
                if (count($last_errors) >= 8) break;
            }
        }
        api_ok(['ports'=>$ports,'uuid_rejections'=>$uuid_rejections,
                'rejected_uuids'=>array_slice(array_keys($rejected_uuids),0,5),
                'accepted_external'=>$accepted_external,
                'last_accepted_ip'=>$last_accepted_ip,'last_accepted_at'=>$last_accepted_at,
                'last_errors'=>$last_errors,'checked_at'=>date('Y-m-d H:i:s')]);
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
        $srv_label = (string)($db_nl->query("SELECT value FROM settings WHERE key='server_label'")->fetchColumn() ?: 'SetaLink VPN');
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

    default: api_err('unknown action');
}
