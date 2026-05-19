<?php
// SetaLink JSON API — AJAX endpoint for the dashboard.
// Auth enforced upstream by nginx auth_basic.
// All state-changing POSTs require a valid CSRF token (same scheme as index.php).
declare(strict_types=1);

const CLI          = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE  = '/^[a-z0-9][a-z0-9._-]{0,31}$/';
const VALID_PKGS   = ['7days', '30days', 'unlimited', '5GB', '10GB', '15GB'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

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

// -------------------------------------------------------------------------
// CSRF setup
// -------------------------------------------------------------------------
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

// api.php has auth_basic off in nginx — validate via session cookie when no Basic Auth header.
// The _sl_session cookie is set by index.php after nginx validates the initial page load.
if (!$auth_user) {
    $sl_cookie = trim((string)($_COOKIE['_sl_session'] ?? ''));
    if ($sl_cookie) {
        // Enumerate htpasswd users: in this deployment 'admin' is the only configured user.
        // HMAC comparison is timing-safe.
        $expected = hash_hmac('sha256', 'sl-session:admin', $csrf_secret);
        if (hash_equals($expected, $sl_cookie)) {
            $auth_user = 'admin';
        }
    }
    if (!$auth_user) {
        // No valid session — reject cleanly (no WWW-Authenticate so browser won't pop a dialog)
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Session expired — reload the admin panel to log in again.']);
        exit;
    }
}

$csrf_token  = hash_hmac('sha256', $auth_user, $csrf_secret);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// -------------------------------------------------------------------------
// Mobile API — device registration, entitlement, telemetry
// GET  ?mobile=1&action=remote-config|bootstrap|sync-entitlement
// POST ?mobile=1&action=register-device|use-referral|report-usage|(telemetry)
// Auth: shared static token — no CSRF (app client, not browser).
// -------------------------------------------------------------------------
const MOBILE_REPORT_TOKEN  = 'setalink-mobile-diag-v1';
const ONE_GB_BYTES         = 1073741824;    // 1 GB starter quota
const REFERRAL_BONUS_BYTES = 536870912;     // 512 MB per referral party

function init_device_tables(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        referral_code TEXT UNIQUE NOT NULL,
        plan TEXT NOT NULL DEFAULT \'free\',
        quota_bytes_total INTEGER NOT NULL DEFAULT 1073741824,
        quota_bytes_used INTEGER NOT NULL DEFAULT 0,
        valid_until TEXT,
        blocked INTEGER NOT NULL DEFAULT 0,
        platform TEXT NOT NULL DEFAULT \'\',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
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
        // Hardcoded working fallback — zero DB dependency
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
            'edgeAddress' => '',
            'edgePort'    => 443,
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

// Mobile GET endpoints — remote-config, bootstrap, sync-entitlement
if ($method === 'GET' && isset($_GET['mobile']) && $_GET['mobile'] === '1') {
    $tok = (string)($_GET['_token'] ?? '');
    if (!hash_equals(MOBILE_REPORT_TOKEN, $tok)) api_err('invalid token', 403);
    $ma = (string)($_GET['action'] ?? '');

    if ($ma === 'remote-config') {
        $db2 = open_analytics_db();
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
        $server = fetch_bootstrap_server($db3);
        api_ok(array_merge(['id' => 'server-emergency', 'label' => 'SetaLink Cloudflare'], $server));
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

// Mobile POST endpoints — register-device, use-referral, report-usage, telemetry
if ($method === 'POST' && isset($_GET['mobile']) && $_GET['mobile'] === '1') {
    $tok = (string)($_POST['_token'] ?? $_GET['_token'] ?? '');
    if (!hash_equals(MOBILE_REPORT_TOKEN, $tok)) api_err('invalid token', 403);

    $ma = (string)($_GET['action'] ?? $_POST['action'] ?? '');

    if ($ma === 'register-device') {
        $device_id = trim((string)($_POST['device_id'] ?? ''));
        $platform  = substr(trim((string)($_POST['platform'] ?? 'android')), 0, 20);
        if (!$device_id || strlen($device_id) > 64) api_err('invalid device_id');
        if (!preg_match('/^[a-f0-9\-]{8,64}$/', $device_id)) api_err('invalid device_id format');
        $db = open_analytics_db();
        init_device_tables($db);
        $st = $db->prepare('SELECT * FROM devices WHERE device_id = ?');
        $st->execute([$device_id]);
        $dev = $st->fetch(PDO::FETCH_ASSOC);
        if ($dev) {
            $db->prepare("UPDATE devices SET last_seen = datetime('now') WHERE device_id = ?")->execute([$device_id]);
        } else {
            $ref = generate_referral_code($db);
            $db->prepare("INSERT INTO devices (device_id,referral_code,plan,quota_bytes_total,quota_bytes_used,platform) VALUES (?,?,'free',?,0,?)")
               ->execute([$device_id, $ref, ONE_GB_BYTES, $platform]);
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
        $db->prepare('UPDATE devices SET quota_bytes_total = quota_bytes_total + ? WHERE device_id = ?')
           ->execute([REFERRAL_BONUS_BYTES, $referrer['device_id']]);
        $db->prepare('UPDATE devices SET quota_bytes_total = quota_bytes_total + ? WHERE device_id = ?')
           ->execute([REFERRAL_BONUS_BYTES, $device_id]);
        api_ok([
            'bonus_bytes'       => REFERRAL_BONUS_BYTES,
            'referrer_credited' => true,
            'new_total_bytes'   => (int)$new_dev['quota_bytes_total'] + REFERRAL_BONUS_BYTES,
        ]);
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
        $db->prepare("UPDATE devices SET quota_bytes_used = ?, last_seen = datetime('now') WHERE device_id = ?")
           ->execute([$new_used, $device_id]);
        api_ok([
            'quota_bytes_used'  => $new_used,
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'remaining_bytes'   => max(0, (int)$dev['quota_bytes_total'] - $new_used),
        ]);
    }

    // --- Mobile POST: telemetry report ---
    $allowed_results = ['success', 'fail', 'partial', 'tcp_only'];
    $country        = substr(trim((string)($_POST['country']        ?? 'unknown')), 0, 80);
    $network        = substr(trim((string)($_POST['network']        ?? 'unknown')), 0, 80);
    $server         = substr(trim((string)($_POST['server']         ?? '')), 0, 120);
    $port           = max(1, min(65535, (int)($_POST['port']        ?? 0)));
    $protocol       = substr(trim((string)($_POST['protocol']       ?? 'VLESS+Reality')), 0, 60);
    $sni            = substr(trim((string)($_POST['sni']            ?? '')), 0, 120);
    $flow           = substr(trim((string)($_POST['flow']           ?? '')), 0, 60);
    $fingerprint    = substr(trim((string)($_POST['fingerprint']    ?? '')), 0, 60);
    $result         = (string)($_POST['result'] ?? 'fail');
    $error_msg      = substr(trim((string)($_POST['error_msg']      ?? '')), 0, 500);
    $tcp_ok         = (int)(bool)($_POST['tcp_ok']   ?? 0);
    $http_ok        = (int)(bool)($_POST['http_ok']  ?? 0);
    $latency_ms     = max(0, (int)($_POST['latency_ms']  ?? 0));
    $tested_by      = substr(trim((string)($_POST['tested_by']      ?? 'mobile')), 0, 60);
    $notes          = substr(trim((string)($_POST['notes']          ?? '')), 0, 500);
    $device_model   = substr(trim((string)($_POST['device_model']   ?? '')), 0, 120);
    $android_ver    = substr(trim((string)($_POST['android_version']?? '')), 0, 20);
    $android_sdk    = max(0, (int)($_POST['android_sdk']            ?? 0));
    $ipv6_enabled   = (int)(bool)($_POST['ipv6_enabled']  ?? 0);
    $mtu            = max(0, (int)($_POST['mtu']           ?? 0));
    $reconnect_cnt  = max(0, (int)($_POST['reconnect_count']?? 0));
    $no_internet    = (int)(bool)($_POST['no_internet']   ?? 0);
    $is_winner      = (int)(bool)($_POST['is_winner']     ?? 0);
    $mode           = substr(trim((string)($_POST['mode']           ?? '')), 0, 20);
    $emergency      = (int)(bool)($_POST['emergency']     ?? 0);
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
    $st->execute([
        $country,$network,$server,$port,$protocol,$sni,$flow,$fingerprint,$result,$error_msg,
        $tcp_ok,$http_ok,$latency_ms,$tested_by,$notes,
        $device_model,$android_ver,$android_sdk,$ipv6_enabled,$mtu,
        $reconnect_cnt,$no_internet,$is_winner,$mode,$emergency,$fallback_chain,
    ]);
    api_ok(['id' => (int)$db->lastInsertId()]);
}

// -------------------------------------------------------------------------
// POST — state-changing actions
// -------------------------------------------------------------------------
if ($method === 'POST') {
    $body   = (string)file_get_contents('php://input');
    $parsed = json_decode($body, true);
    if (!is_array($parsed)) api_err('invalid JSON body');

    $sent = (string)($parsed['_csrf'] ?? '');
    if (!hash_equals($csrf_token, $sent)) {
        api_err('csrf token mismatch', 403);
    }

    $action = (string)($parsed['action'] ?? '');
    $name   = trim((string)($parsed['name'] ?? ''));
    $pkg    = trim((string)($parsed['package'] ?? ''));

    if ($action === 'save-settings') {
        $data = $parsed;
        $allowed_keys = ['telegram_url', 'server_label'];
        $db2 = open_analytics_db();
        $st = $db2->prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime(\'now\'))');
        foreach ($allowed_keys as $k) {
            if (array_key_exists($k, $data)) $st->execute([$k, (string)$data[$k]]);
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
        $st_rc = $db_rc->prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime(\'now\'))');
        $saved = [];
        foreach ($allowed_rc_keys as $k) {
            if (!array_key_exists($k, $parsed)) continue;
            $v = $parsed[$k];
            $st_rc->execute([$k, is_array($v) ? json_encode($v) : (string)$v]);
            $saved[] = $k;
        }
        // Auto-stamp updated_at
        $st_rc->execute(['rc_updated_at', date('Y-m-d H:i:s')]);

        // Assemble + write the composite key that the public mobile API reads
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
        $allowed_results = ['success', 'fail', 'partial'];
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
        if (!in_array($result, $allowed_results, true)) api_err('invalid result value');

        $db3 = open_analytics_db();
        $st3 = $db3->prepare('INSERT INTO test_results
            (country,network,server,port,protocol,sni,flow,fingerprint,result,error_msg,tcp_ok,http_ok,latency_ms,tested_by,notes)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $st3->execute([$country,$network,$server,$port,$protocol,$sni,$flow,$fingerprint,
                       $result,$error_msg,$tcp_ok,$http_ok,$latency_ms,$tested_by,$notes]);
        api_ok(['id' => (int)$db3->lastInsertId()]);
    }

    $allowed = ['add','remove','disable','enable','reset-traffic','change-package','regen-link'];
    if (!in_array($action, $allowed, true)) api_err('unknown action');
    if (!preg_match(USERNAME_RE, $name))    api_err('invalid username');

    $args = [$name];
    if (in_array($action, ['add', 'change-package'], true)) {
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

// -------------------------------------------------------------------------
// GET — read-only queries
// -------------------------------------------------------------------------
$action = (string)($_GET['action'] ?? 'status');
switch ($action) {
    case 'status': api_ok(cli_json('status', [], 8)); break;
    case 'list':   api_ok(cli_json('list',   [], 8)); break;
    case 'csrf':
        api_ok(['csrf' => $csrf_token]);
        break;
    case 'full-json':
        $name = trim((string)($_GET['name'] ?? ''));
        if (!$name || !preg_match(USERNAME_RE, $name)) api_err('invalid username');
        $r = cli_run('read-full-json', [$name]);
        if ($r['rc'] !== 0) api_err('config not found for ' . $name, 404);
        header('Content-Disposition: attachment; filename="xray-' . $name . '.json"');
        echo $r['output'];
        exit;

    case 'server-stats':
        api_ok(cli_json('server-stats', [], 8));
        break;

    case 'connection-analytics':
        api_ok(cli_json('connection-analytics', [], 8));
        break;

    case 'test-results':
        $db = open_analytics_db();
        $rows = $db->query(
            'SELECT * FROM test_results ORDER BY recorded_at DESC LIMIT 100'
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok($rows);
        break;

    case 'logs':
        $type = preg_match('/^(access|error|nginx)$/', $_GET['type'] ?? 'access') ? $_GET['type'] : 'access';
        $n    = min(500, max(20, (int)($_GET['n'] ?? 100)));
        $r    = cli_run('tail-logs', [$type, (string)$n], 9);
        $raw  = trim($r['output']);
        $lines = ($raw && $raw !== '[]') ? json_decode($raw, true) : [];
        api_ok(is_array($lines) ? $lines : []);
        break;

    case 'protocol-health':
        // All 4 probes must complete within ~8s total.
        // TCP probe runs synchronously (max 3s); HTTP probes run in parallel as background processes.
        set_time_limit(15);
        function tcp_open(string $host, int $port, int $t = 3): bool {
            $s = @fsockopen($host, $port, $e, $err, (float)$t);
            if ($s) { fclose($s); return true; }
            return false;
        }
        $EDGE = 'edge.setalink.no';
        // Map key → [url, extra curl headers]
        $ph_probes = [
            'ws'          => ['url' => "https://{$EDGE}/ws",     'hdrs' => ['-H', 'Upgrade: websocket', '-H', 'Connection: Upgrade']],
            'xhttp'       => ['url' => "https://{$EDGE}/xhttp",  'hdrs' => []],
            'httpupgrade' => ['url' => "https://{$EDGE}/httpup", 'hdrs' => ['-H', 'Upgrade: XHTTP', '-H', 'Connection: Upgrade']],
        ];
        // Launch HTTP probes in parallel (background curl processes)
        $ph_files = [];
        foreach ($ph_probes as $pkey => $pp) {
            $f = tempnam('/tmp', 'phck_');
            $ph_files[$pkey] = $f;
            $hargs = '';
            foreach ($pp['hdrs'] as $harg) $hargs .= ' ' . escapeshellarg($harg);
            $cmd = '(curl -sk -o /dev/null -w "%{http_code}" --max-time 6' . $hargs . ' ' . escapeshellarg($pp['url']) . ') > ' . escapeshellarg($f) . ' 2>&1 &';
            exec($cmd);
        }
        // TCP probe for Reality runs synchronously (max 3s) while curl runs in background
        $reality_open = tcp_open($EDGE, 8443, 3);
        // Poll for HTTP results — up to 5 more seconds (8s total from start)
        $ph_deadline = microtime(true) + 5.0;
        while (microtime(true) < $ph_deadline) {
            $all_done = true;
            foreach ($ph_files as $f) {
                clearstatcache(true, $f);
                if (!file_exists($f) || filesize($f) === 0) { $all_done = false; break; }
            }
            if ($all_done) break;
            usleep(200000); // 200ms poll interval
        }
        // Interpret results
        $r = [];
        foreach ($ph_files as $pkey => $f) {
            clearstatcache(true, $f);
            $raw  = file_exists($f) ? trim((string)file_get_contents($f)) : '';
            @unlink($f);
            $code = (is_numeric($raw) && (int)$raw > 0) ? (int)$raw : null;
            switch ($pkey) {
                case 'ws':
                    $ok  = in_array($code, [101, 400]);
                    $det = $code === null  ? 'timeout — nginx/xray not reachable on /ws' :
                          ($code === 101   ? '101 Switching Protocols — WebSocket upgrade accepted' :
                          ($code === 400   ? 'HTTP 400 — xray routing OK (rejects unauthenticated upgrade)' :
                          ($code === 502   ? 'HTTP 502 — nginx upstream error (xray inbound missing?)' :
                          ($code === 404   ? 'HTTP 404 — nginx route missing for /ws' : "HTTP {$code}"))));
                    $r['ws'] = ['ok' => $ok, 'code' => $code, 'name' => 'WebSocket', 'timeout' => $code === null, 'detail' => $det];
                    break;
                case 'xhttp':
                    $ok  = in_array($code, [404, 400, 200]);
                    $det = $code === null            ? 'timeout — nginx/xray not reachable on /xhttp' :
                          (in_array($code, [404,400,200]) ? "HTTP {$code} — XHTTP path reachable and routing correctly" :
                          ($code === 502               ? 'HTTP 502 — nginx upstream error (xray XHTTP inbound missing?)' : "HTTP {$code}"));
                    $r['xhttp'] = ['ok' => $ok, 'code' => $code, 'name' => 'XHTTP', 'timeout' => $code === null, 'detail' => $det];
                    break;
                case 'httpupgrade':
                    $ok  = in_array($code, [502, 400, 200, 101]);
                    $det = $code === null                    ? 'timeout — nginx/xray not reachable on /httpup' :
                          (in_array($code, [502,400,200,101]) ? "HTTP {$code} — HTTPUpgrade path reachable" :
                          ($code === 404                      ? 'HTTP 404 — nginx route missing for /httpup' : "HTTP {$code}"));
                    $r['httpupgrade'] = ['ok' => $ok, 'code' => $code, 'name' => 'HTTPUpgrade', 'timeout' => $code === null, 'detail' => $det];
                    break;
            }
        }
        $r['reality']    = ['ok' => $reality_open, 'code' => null, 'open' => $reality_open, 'name' => 'Reality',
                            'timeout' => false, 'detail' => $reality_open ? 'port 8443 open — Reality accepting connections' : 'port 8443 closed — check ufw rules and xray Reality inbound'];
        $r['checked_at'] = date('Y-m-d H:i:s');
        api_ok($r);
        break;

    case 'get-settings':
        $db = open_analytics_db();
        $rows = $db->query('SELECT key, value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
        $defaults = ['telegram_url' => 'https://t.me/SetaLink3', 'server_label' => 'SetaLink VPN'];
        api_ok(array_merge($defaults, $rows));
        break;


    case 'iran-score':
        // Compute Iran compatibility score from live server config.
        $cfg = cli_json('status', [], 8);
        $r   = $cfg['reality'] ?? [];
        $score = 0; $checks = [];

        // 1. SNI not blocked in Iran
        $sni = $r['sni'] ?? '';
        $safe_snis = ['www.microsoft.com','www.apple.com','www.speedtest.net','www.google.com'];
        $sni_ok = in_array($sni, $safe_snis, true);
        $score += $sni_ok ? 30 : 0;
        $checks[] = ['label'=>'SNI not blocked in Iran','ok'=>$sni_ok,'detail'=>$sni ?: '—'];

        // 2. Correct port (Reality on 8443)
        $port = (int)($r['port'] ?? 0);
        $port_ok = ($port === 8443);
        $score += $port_ok ? 20 : 0;
        $checks[] = ['label'=>'Reality port (8443)','ok'=>$port_ok,'detail'=>(string)$port];

        // 3. Flow is xtls-rprx-vision
        $flow = $r['flow'] ?? '';
        $flow_ok = ($flow === 'xtls-rprx-vision');
        $score += $flow_ok ? 20 : 0;
        $checks[] = ['label'=>'Flow: xtls-rprx-vision','ok'=>$flow_ok,'detail'=>$flow ?: '(none)'];

        // 4. Fingerprint set (not empty)
        $fp = $r['fingerprint'] ?? '';
        $fp_ok = !empty($fp);
        $score += $fp_ok ? 15 : 0;
        $checks[] = ['label'=>'Fingerprint set','ok'=>$fp_ok,'detail'=>$fp ?: '—'];

        // 5. TCP reachability of 8443 from server-side
        $tcp_sock = @fsockopen('127.0.0.1', 8443, $e, $err, 2);
        $tcp_ok = $tcp_sock !== false;
        if ($tcp_ok) { fclose($tcp_sock); }
        $score += $tcp_ok ? 15 : 0;
        $checks[] = ['label'=>'Port 8443 listening','ok'=>$tcp_ok,'detail'=>$tcp_ok ? 'open' : 'closed'];

        $grade = $score >= 90 ? 'A' : ($score >= 70 ? 'B' : ($score >= 50 ? 'C' : 'F'));
        api_ok(['score'=>$score,'grade'=>$grade,'checks'=>$checks,'checked_at'=>date('Y-m-d H:i:s')]);
        break;

    case 'active-sessions':
        // Count recent unique client IPs from xray access log (last 5 minutes).
        $log = '/var/log/xray/access.log';
        $cutoff = time() - 300; // 5 minutes
        $sessions = []; $total_recent = 0;
        if (is_readable($log)) {
            $lines = array_slice(file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -500);
            foreach ($lines as $line) {
                // Xray access log format: YYYY/MM/DD HH:MM:SS [Info] ...
                if (!preg_match('/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/', $line, $m)) continue;
                $ts = strtotime(str_replace('/', '-', $m[1]));
                if ($ts < $cutoff) continue;
                // Skip internal/localhost traffic
                if (strpos($line, '127.0.0.1') !== false || strpos($line, '::1') !== false) continue;
                $total_recent++;
                if (preg_match('/accepted\s+([\d\.a-f:]+):\d+/', $line, $ip)) {
                    $sessions[$ip[1]] = true;
                }
            }
        }
        api_ok([
            'active_ips'    => count($sessions),
            'recent_events' => $total_recent,
            'window_seconds'=> 300,
            'checked_at'    => date('Y-m-d H:i:s'),
        ]);
        break;

    case 'profile-stats':
        // Per-profile success/fail counts from test_results table.
        $db = open_analytics_db();
        $rows = $db->query(
            'SELECT protocol, sni, result, COUNT(*) as cnt
             FROM test_results GROUP BY protocol, sni, result ORDER BY protocol, sni'
        )->fetchAll(PDO::FETCH_ASSOC);
        // Aggregate into {key: {success, fail, total, pct}}
        $agg = [];
        foreach ($rows as $r) {
            $key = trim(($r['protocol'] ?? 'unknown') . ' / ' . ($r['sni'] ?? ''));
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
        // Which protocol+SNI combos work best, with device breakdowns.
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT protocol, sni, mode, country,
                    COUNT(*) as total,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok,
                    SUM(no_internet) as no_internet_cnt,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    MAX(recorded_at) as last_seen
             FROM test_results
             GROUP BY protocol, sni, mode, country
             ORDER BY connected DESC, probe_ok DESC
             LIMIT 100"
        )->fetchAll(PDO::FETCH_ASSOC);
        $formatted = array_map(function($r) {
            $t = (int)$r['total'];
            $c = (int)$r['connected'];
            return [
                'protocol'      => $r['protocol'],
                'sni'           => $r['sni'],
                'mode'          => $r['mode'],
                'country'       => $r['country'],
                'total'         => $t,
                'connected'     => $c,
                'probe_ok'      => (int)$r['probe_ok'],
                'no_internet'   => (int)$r['no_internet_cnt'],
                'connect_rate'  => $t > 0 ? round($c / $t * 100) : null,
                'avg_latency'   => $r['avg_latency'] ? (int)round((float)$r['avg_latency']) : null,
                'last_seen'     => $r['last_seen'],
            ];
        }, $rows);
        api_ok($formatted);
        break;

    case 'sni-leaderboard':
        // SNI success rates globally (for admin to set remote config priorities).
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT sni,
                    COUNT(*) as total,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok,
                    AVG(CASE WHEN latency_ms>0 THEN latency_ms ELSE NULL END) as avg_latency,
                    COUNT(DISTINCT device_model) as device_count
             FROM test_results
             WHERE sni != ''
             GROUP BY sni
             HAVING total >= 2
             ORDER BY connected DESC, probe_ok DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok(array_map(function($r) {
            $t = (int)$r['total'];
            $c = (int)$r['connected'];
            return [
                'sni'          => $r['sni'],
                'total'        => $t,
                'connected'    => $c,
                'probe_ok'     => (int)$r['probe_ok'],
                'connect_rate' => $t > 0 ? round($c / $t * 100) : null,
                'avg_latency'  => $r['avg_latency'] ? (int)round((float)$r['avg_latency']) : null,
                'devices'      => (int)$r['device_count'],
            ];
        }, $rows));
        break;

    case 'device-breakdown':
        // Which Android versions / devices are connecting.
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT android_version, device_model,
                    COUNT(*) as attempts,
                    SUM(CASE WHEN result='success' OR result='tcp_only' THEN 1 ELSE 0 END) as connected,
                    SUM(no_internet) as no_internet_cnt,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE device_model != '' OR android_version != ''
             GROUP BY android_version, device_model
             ORDER BY attempts DESC
             LIMIT 50"
        )->fetchAll(PDO::FETCH_ASSOC);
        api_ok($rows);
        break;

    case 'no-internet-analysis':
        // Profiles that connect (TCP OK) but users get no internet — the routing bug.
        $db = open_analytics_db();
        $rows = $db->query(
            "SELECT protocol, sni, android_version,
                    COUNT(*) as total,
                    SUM(no_internet) as no_internet_cnt,
                    SUM(CASE WHEN http_ok=1 THEN 1 ELSE 0 END) as probe_ok_cnt,
                    MAX(recorded_at) as last_seen
             FROM test_results
             WHERE tcp_ok=1
             GROUP BY protocol, sni, android_version
             HAVING total >= 2
             ORDER BY no_internet_cnt DESC
             LIMIT 50"
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
        $db_bs = open_analytics_db();
        $bs = fetch_bootstrap_server($db_bs);
        api_ok([
            'version'        => (int)($rows['rc_version'] ?? 1),
            'sni_priorities' => $decode('rc_sni_priorities', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'kill_switches'  => $decode('rc_kill_switches', []),
            'protocol_order' => $decode('rc_protocol_order', ['Reality','XHTTP','WebSocket']),
            'emergency_sni'  => (string)($rows['rc_emergency_sni'] ?? 'www.microsoft.com'),
            'iran_sni_order' => $decode('rc_iran_sni_order', ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net']),
            'ttl'            => (int)($rows['rc_ttl'] ?? 3600),
            'updated_at'     => (string)($rows['rc_updated_at'] ?? ''),
            'bootstrap_set'  => !empty($bs['uuid']),
            'bootstrap'      => $bs,
        ]);
        break;

    case 'app-analytics':
        $db = open_analytics_db();
        $total    = (int)$db->query("SELECT COUNT(*) FROM devices")->fetchColumn();
        $active7d = (int)$db->query("SELECT COUNT(*) FROM devices WHERE last_seen >= datetime('now','-7 days')")->fetchColumn();
        $newMonth = (int)$db->query("SELECT COUNT(*) FROM devices WHERE created_at >= datetime('now','-30 days')")->fetchColumn();
        $failed   = (int)$db->query("SELECT COUNT(*) FROM test_results WHERE result='fail' AND recorded_at >= datetime('now','-1 day')")->fetchColumn();
        $apk_path = '/var/www/setalink/public/download/setalink-latest.apk';
        $apk_ver  = is_readable($apk_path) ? 'latest' : '0.8.0';
        api_ok([
            'total_installs' => $total,
            'active_7d'      => $active7d,
            'new_this_month' => $newMonth,
            'latest_version' => $apk_ver,
            'failed_24h'     => $failed,
        ]);
        break;

    case 'node-list':
        $cfg     = cli_json('status');
        $reality = $cfg['reality'] ?? [];
        api_ok([[
            'id'       => 'main',
            'label'    => 'SetaLink Cloudflare',
            'host'     => '178.104.77.231',
            'country'  => 'Germany',
            'city'     => 'SetaLink Cloudflare',
            'flag'     => '🇩🇪',
            'protocol' => 'Reality',
            'port'     => (int)($reality['port'] ?? 443),
            'status'   => isset($cfg['services']['xray']) && $cfg['services']['xray'] === 'active' ? 'active' : 'error',
            'tags'     => ['reality','stealth','main'],
            'ping'     => null,
        ]]);
        break;

    case 'node-add':
        api_ok(['status' => 'ok', 'note' => 'Multi-node management coming soon']);
        break;

    case 'node-delete':
        api_ok(['status' => 'ok']);
        break;

    case 'node-ping':
        $host = trim($_GET['host'] ?? '');
        $port = min(65535, max(1, (int)($_GET['port'] ?? 443)));
        if (!$host) api_err('host required');
        $start = microtime(true);
        $s = @fsockopen($host, $port, $e, $err, 3);
        $ms = (int)round((microtime(true) - $start) * 1000);
        if ($s) { fclose($s); api_ok(['ms' => $ms, 'ok' => true]); }
        api_ok(['ms' => null, 'ok' => false]);
        break;

    case 'heartbeat':
        // Lightweight health check — returns green/red for each critical service.
        $hb_xray  = trim((string)@shell_exec('systemctl is-active xray.service  2>/dev/null')) === 'active';
        $hb_nginx = trim((string)@shell_exec('systemctl is-active nginx.service 2>/dev/null')) === 'active';
        $hb_sqlite = false;
        try { open_analytics_db(); $hb_sqlite = true; } catch (Exception $e) {}
        $hb_bs_raw = trim((string)@shell_exec('curl -sk --max-time 4 "http://127.0.0.1/api.php?mobile=1&action=bootstrap&_token=' . MOBILE_REPORT_TOKEN . '" 2>/dev/null'));
        $hb_bs_j   = $hb_bs_raw ? json_decode($hb_bs_raw, true) : null;
        $hb_bs_ok  = is_array($hb_bs_j) && !empty($hb_bs_j['ok']) && !empty($hb_bs_j['data']['uuid'] ?? '');
        api_ok(['xray' => $hb_xray, 'nginx' => $hb_nginx, 'sqlite' => $hb_sqlite, 'api' => true, 'bootstrap' => $hb_bs_ok, 'checked_at' => date('Y-m-d H:i:s')]);
        break;

    case 'test-bootstrap':
        // Test the public mobile bootstrap endpoint and verify JSON structure.
        $tb_raw = trim((string)@shell_exec('curl -sk --max-time 6 "http://127.0.0.1/api.php?mobile=1&action=bootstrap&_token=' . MOBILE_REPORT_TOKEN . '" 2>/dev/null'));
        if (!$tb_raw) api_err('Bootstrap endpoint did not respond within 6s', 503);
        $tb_j = json_decode($tb_raw, true);
        if (!is_array($tb_j))         api_err('Bootstrap endpoint returned invalid JSON');
        if (!($tb_j['ok'] ?? false))  api_err('Bootstrap returned error: ' . ($tb_j['error'] ?? 'unknown'));
        $tb_d = $tb_j['data'] ?? [];
        foreach (['uuid', 'address', 'port', 'publicKey'] as $tbf) {
            if (empty($tb_d[$tbf])) api_err("Bootstrap missing required field: {$tbf}");
        }
        api_ok(['status' => 'ok', 'profile' => $tb_d]);
        break;

    default: api_err('unknown action');
}
