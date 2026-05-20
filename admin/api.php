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
const REFERRAL_BONUS_BYTES = 536870912;

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
    ];
    foreach ($migrations as $sql) {
        try { $db->exec($sql); } catch (Exception $e) {}
    }
    $db->exec('CREATE TABLE IF NOT EXISTS referral_uses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_device_id TEXT NOT NULL,
        new_device_id TEXT NOT NULL,
        bonus_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
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
            'address'     => '5.249.252.221',
            'port'        => 8443,
            'publicKey'   => 'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
            'shortId'     => '7f81892e',
            'sni'         => 'www.microsoft.com',
            'flow'        => 'xtls-rprx-vision',
            'fingerprint' => 'chrome',
            'country'     => 'Netherlands',
            'flag'        => '🇳🇱',
            'city'        => 'SetaLink Edge',
            'edgeAddress' => 'edge.setalink.no',
            'edgePort'    => 443,
            'wsPath'      => '/ws',
            'xhttpPath'   => '/xhttp',
            'httpupPath'  => '/httpup',
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
        'xhttpPath'   => $r['bootstrap_xhttp_path'] ?? '/xhttp',
        'httpupPath'  => $r['bootstrap_httpup_path'] ?? '/httpup',
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
        if (!$device_id || strlen($device_id) > 128) api_err('invalid device_id');
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9\-_]{5,126}$/', $device_id)) api_err('invalid device_id format');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if ($dev) {
            $db->prepare("UPDATE devices SET last_seen=datetime('now'),platform=?,app_version=?,language=? WHERE device_id=?")
               ->execute([$platform, $app_version, $language, $device_id]);
        } else {
            $ref = generate_referral_code($db);
            $db->prepare("INSERT INTO devices (device_id,referral_code,plan,quota_bytes_total,quota_bytes_used,platform,app_version,language) VALUES (?,?,'free',?,0,?,?,?)")
               ->execute([$device_id, $ref, ONE_GB_BYTES, $platform, $app_version, $language]);
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
    $fallback_chain = substr(trim((string)($_POST['fallback_chain'] ?? '')), 0, 500);
    if (!in_array($result, $allowed_results, true)) $result = 'fail';
    if (!$server) api_err('server required');
    $db = open_analytics_db();
    $st = $db->prepare('INSERT INTO test_results
        (country,network,server,port,protocol,sni,flow,fingerprint,result,error_msg,
         tcp_ok,http_ok,latency_ms,tested_by,notes,
         device_model,android_version,android_sdk,ipv6_enabled,mtu,
         reconnect_count,no_internet,is_winner,mode,emergency,fallback_chain)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $st->execute([$country,$network,$server,$port,$protocol,$sni,$flow,$fingerprint,$result,$error_msg,
                  $tcp_ok,$http_ok,$latency_ms,$tested_by,$notes,
                  $device_model,$android_ver,$android_sdk,$ipv6_enabled,$mtu,
                  $reconnect_cnt,$no_internet,$is_winner,$mode,$emergency,$fallback_chain]);
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
            device_id TEXT NOT NULL,
            memo TEXT DEFAULT '',
            package TEXT NOT NULL DEFAULT '30days',
            amount_usdt REAL DEFAULT 0,
            tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')),
            reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '',
            note TEXT DEFAULT ''
        )");
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
        $pkg  = trim((string)($parsed['package'] ?? '30days'));
        $memo = substr(trim((string)($parsed['memo'] ?? '')), 0, 255);
        $tx   = substr(trim((string)($parsed['tx_hash'] ?? '')), 0, 100);
        $amt  = (float)($parsed['amount_usdt'] ?? 0);
        if (!$did) api_err('device_id required');
        if (!in_array($pkg, VALID_PKGS, true)) api_err('invalid package');
        $db = open_analytics_db();
        $db->exec("CREATE TABLE IF NOT EXISTS payment_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL, memo TEXT DEFAULT '',
            package TEXT NOT NULL DEFAULT '30days', amount_usdt REAL DEFAULT 0,
            tx_hash TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '', note TEXT DEFAULT ''
        )");
        $db->prepare("INSERT INTO payment_queue (device_id,package,memo,tx_hash,amount_usdt) VALUES (?,?,?,?,?)")
           ->execute([$did, $pkg, $memo, $tx, $amt]);
        api_ok(['payment_id' => (int)$db->lastInsertId()]);
    }
    if ($action === 'save-settings') {
        $allowed_keys = ['telegram_url','server_label'];
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
            'xhttp'       => ['url' => "https://{$EDGE}/xhttp",  'hdrs' => []],
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
        $reality_open = tcp_open($EDGE, 8443, 3);
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
        $r['reality']    = ['ok'=>$reality_open,'code'=>null,'open'=>$reality_open,'name'=>'Reality','timeout'=>false,
                            'detail'=>$reality_open?'port 8443 open':'port 8443 closed — check UFW + xray inbound'];
        $r['checked_at'] = date('Y-m-d H:i:s');
        api_ok($r);
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
        $tcp_sock = @fsockopen('127.0.0.1', 8443, $e, $err, 2);
        $tcp_ok = $tcp_sock !== false;
        if ($tcp_ok) fclose($tcp_sock);
        $score += $tcp_ok ? 15 : 0;
        $checks[] = ['label'=>'Port 8443 listening','ok'=>$tcp_ok,'detail'=>$tcp_ok?'open':'closed'];
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

    case 'get-remote-config':
        $db = open_analytics_db();
        $rows = $db->query("SELECT key,value FROM settings")->fetchAll(PDO::FETCH_KEY_PAIR);
        $decode = function(string $key, mixed $def) use ($rows): mixed {
            if (!isset($rows[$key])) return $def;
            $v = json_decode($rows[$key], true);
            return ($v !== null) ? $v : $rows[$key];
        };
        api_ok([
            'version'        => (int)($rows['rc_version'] ?? 1),
            'sni_priorities' => $decode('rc_sni_priorities', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'kill_switches'  => $decode('rc_kill_switches',  []),
            'protocol_order' => $decode('rc_protocol_order', ['Reality','XHTTP','WebSocket']),
            'emergency_sni'  => (string)($rows['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order' => $decode('rc_iran_sni_order', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'ttl'            => (int)($rows['rc_ttl'] ?? 3600),
            'updated_at'     => (string)($rows['rc_updated_at'] ?? ''),
            'bootstrap'      => fetch_bootstrap_server($db),
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
            $where[] = "(device_id LIKE ? OR country LIKE ? OR app_version LIKE ?)";
            $params = array_merge($params, ["%$q%","%$q%","%$q%"]);
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
                'platform'          => $r['platform']        ?? 'android',
                'plan'              => $r['plan']            ?? 'free',
                'quota_bytes_total' => (int)($r['quota_bytes_total'] ?? 0),
                'quota_bytes_used'  => (int)($r['quota_bytes_used']  ?? 0),
                'status'            => $is_online ? 'online' : 'offline',
                'app_version'       => $r['app_version']     ?? '',
                'active_protocol'   => $r['active_protocol'] ?? '',
                'country'           => $r['country']         ?? '',
                'language'          => $r['language']        ?? '',
                'created_at'        => $r['created_at'],
                'last_seen'         => $r['last_seen'],
                'blocked'           => (bool)(int)($r['blocked'] ?? 0),
                'referral_code'     => $r['referral_code']   ?? '',
            ];
        }, $rows);
        api_ok($result);
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
            started_at TEXT, ended_at TEXT DEFAULT (datetime('now')), client_ip TEXT DEFAULT ''
        )");
        $db->exec("CREATE TABLE IF NOT EXISTS ip_isp_cache (
            ip TEXT PRIMARY KEY, isp TEXT, asn TEXT, country TEXT,
            cached_at TEXT DEFAULT (datetime('now'))
        )");
        $today      = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions WHERE ended_at>=date('now')")->fetchColumn();
        $total_sess = (int)$db->query("SELECT COUNT(*) FROM vpn_sessions")->fetchColumn();
        $avg_dur    = (float)($db->query("SELECT AVG(duration_secs) FROM vpn_sessions WHERE duration_secs>10")->fetchColumn() ?? 0);
        $total_bytes = (int)($db->query("SELECT SUM(bytes_sent+bytes_recv) FROM vpn_sessions")->fetchColumn() ?? 0);
        $by_protocol = $db->query(
            "SELECT protocol,COUNT(*) as sessions,
                    SUM(duration_secs) as total_secs,SUM(bytes_sent+bytes_recv) as total_bytes
             FROM vpn_sessions GROUP BY protocol ORDER BY sessions DESC LIMIT 10"
        )->fetchAll(PDO::FETCH_ASSOC);
        $recent = $db->query(
            "SELECT device_id,protocol,bytes_sent,bytes_recv,duration_secs,ended_at,client_ip
             FROM vpn_sessions ORDER BY ended_at DESC LIMIT 20"
        )->fetchAll(PDO::FETCH_ASSOC);
        $isp_breakdown = $db->query(
            "SELECT c.isp,c.country,COUNT(*) as sessions
             FROM vpn_sessions s JOIN ip_isp_cache c ON s.client_ip=c.ip
             GROUP BY c.isp ORDER BY sessions DESC LIMIT 15"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(['today'=>$today,'total'=>$total_sess,'avg_duration'=>round($avg_dur),
                'total_bytes'=>$total_bytes,'by_protocol'=>$by_protocol,
                'isp_breakdown'=>$isp_breakdown,'recent'=>$recent]);
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
            device_id TEXT NOT NULL, memo TEXT DEFAULT '',
            package TEXT NOT NULL DEFAULT '30days', amount_usdt REAL DEFAULT 0,
            tx_hash TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
            submitted_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT DEFAULT NULL,
            reviewed_by TEXT DEFAULT '', note TEXT DEFAULT ''
        )");
        $sf    = $_GET['status'] ?? 'pending';
        if (!in_array($sf, ['pending','approved','rejected','all'], true)) $sf = 'pending';
        $where = $sf === 'all' ? '' : "WHERE p.status = '$sf'";
        $rows  = $db->query("SELECT p.*,d.platform,d.plan,d.quota_bytes_total,d.quota_bytes_used
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
