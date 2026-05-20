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
define('DB_PATH', __DIR__ . '/../data/analytics.db');

header('Content-Type: application/json');

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Token check
$token = ($method === 'POST')
    ? ($_POST['_token'] ?? $_GET['_token'] ?? '')
    : ($_GET['_token'] ?? '');

if (!hash_equals(MOBILE_TOKEN, $token)) {
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
    ];
    foreach ($migrations as $sql) {
        try { $pdo->exec($sql); } catch (\Exception $e) { /* column already exists */ }
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS referral_uses (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        referral_code TEXT,
        used_by       TEXT,
        used_at       TEXT DEFAULT (datetime('now'))
    )");
}

function generate_referral_code(PDO $pdo): string {
    do {
        $code = strtoupper(substr(bin2hex(random_bytes(4)), 0, 7));
        $exists = $pdo->query("SELECT 1 FROM devices WHERE referral_code='$code'")->fetchColumn();
    } while ($exists);
    return $code;
}

function hardcoded_bootstrap(): array {
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
    ];
}

function ok($data): void  { echo json_encode(['ok' => true,  'data'  => $data]); exit; }
function err($msg): void  { echo json_encode(['ok' => false, 'error' => $msg]);  exit; }

// ── Routes ───────────────────────────────────────────────────────────────────

if ($method === 'GET') {

    if ($action === 'remote-config') {
        $pdo = db();
        try {
            $row = $pdo->query("SELECT value FROM settings WHERE key='remote_config' LIMIT 1")->fetch();
        } catch (\Exception $e) { $row = null; }
        if ($row) {
            $cfg = json_decode($row['value'], true);
            if (is_array($cfg)) { ok($cfg); }
        }
        // Return hardcoded defaults if no config saved yet
        ok([
            'version'        => 1,
            'sni_priorities' => ['www.microsoft.com', 'www.bing.com', 'www.apple.com', 'www.samsung.com'],
            'kill_switches'  => [],
            'protocol_order' => ['Reality', 'XHTTP', 'WebSocket'],
            'emergency_sni'  => 'www.microsoft.com',
            'iran_sni_order' => ['www.microsoft.com', 'www.bing.com', 'www.apple.com'],
            'ttl'            => 3600,
            'updated_at'     => '',
        ]);
    }

    if ($action === 'profile-bundle') {
        $pdo = db();
        $rows = [];
        try { $rows = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'bundle_%'")->fetchAll(PDO::FETCH_KEY_PAIR); } catch (\Exception $e) {}
        $sni_candidates = json_decode($rows['bundle_sni_candidates'] ?? '[]', true) ?: ['www.microsoft.com','www.bing.com','www.apple.com','www.samsung.com','www.speedtest.net'];
        $spoof_snis     = json_decode($rows['bundle_spoof_snis'] ?? '[]', true) ?: ['auth.vercel.com','cdn.jsdelivr.net','hcaptcha.com','assets.vercel.com','images.unsplash.com','cloudflare.com'];
        $backup_ips     = json_decode($rows['bundle_backup_ips'] ?? '[]', true) ?: ['5.249.252.221'];
        $backup_domains = json_decode($rows['bundle_backup_domains'] ?? '[]', true) ?: ['edge.setalink.no'];
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
        ]);
    }

    if ($action === 'sync-entitlement') {
        $deviceId = trim($_GET['device_id'] ?? '');
        if (!$deviceId) err('missing device_id');
        $pdo = db();
        $row = $pdo->prepare("SELECT * FROM devices WHERE device_id=?");
        $row->execute([$deviceId]);
        $dev = $row->fetch();
        if (!$dev) err('device not found');
        $srv = fetch_bootstrap_server($pdo);
        ok([
            'device_id'         => $dev['device_id'],
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)$dev['blocked'],
            'server'            => $srv,
        ]);
    }

    err('unknown action');
}

if ($method === 'POST') {

    if ($action === 'register-device') {
        $deviceId   = trim($_POST['device_id']    ?? '');
        $platform   = substr(trim($_POST['platform']    ?? 'android'), 0, 20);
        $appVersion = substr(trim($_POST['app_version'] ?? ''), 0, 20);
        $language   = substr(trim($_POST['language']    ?? ''), 0, 30);
        if (!$deviceId) err('missing device_id');

        $pdo  = db();
        $stmt = $pdo->prepare("SELECT * FROM devices WHERE device_id=?");
        $stmt->execute([$deviceId]);
        $dev  = $stmt->fetch();

        if (!$dev) {
            $code = generate_referral_code($pdo);
            $pdo->prepare(
                "INSERT INTO devices (device_id, referral_code, platform, app_version, language) VALUES (?, ?, ?, ?, ?)"
            )->execute([$deviceId, $code, $platform, $appVersion, $language]);
            $stmt->execute([$deviceId]);
            $dev = $stmt->fetch();
        } else {
            $pdo->prepare("UPDATE devices SET last_seen=datetime('now'), platform=?, app_version=?, language=? WHERE device_id=?")
                ->execute([$platform, $appVersion, $language, $deviceId]);
        }

        $srv = fetch_bootstrap_server($pdo);
        ok([
            'device_id'         => $dev['device_id'],
            'referral_code'     => $dev['referral_code'],
            'plan'              => $dev['plan'],
            'quota_bytes_total' => (int)$dev['quota_bytes_total'],
            'quota_bytes_used'  => (int)$dev['quota_bytes_used'],
            'valid_until'       => $dev['valid_until'],
            'blocked'           => (bool)$dev['blocked'],
            'server'            => $srv,
        ]);
    }

    if ($action === 'use-referral') {
        $deviceId = trim($_POST['device_id']    ?? '');
        $refCode  = strtoupper(trim($_POST['referral_code'] ?? ''));
        if (!$deviceId || !$refCode) err('missing params');

        $pdo  = db();
        $owner = $pdo->prepare("SELECT device_id FROM devices WHERE referral_code=?");
        $owner->execute([$refCode]);
        $ownerRow = $owner->fetch();
        if (!$ownerRow)                         err('invalid referral code');
        if ($ownerRow['device_id'] === $deviceId) err('cannot use own referral code');

        $already = $pdo->prepare(
            "SELECT 1 FROM referral_uses WHERE referral_code=? AND used_by=?"
        );
        $already->execute([$refCode, $deviceId]);
        if ($already->fetchColumn()) err('referral already used');

        $bonus = 536870912; // 512 MB
        $pdo->prepare(
            "INSERT INTO referral_uses (referral_code, used_by) VALUES (?, ?)"
        )->execute([$refCode, $deviceId]);
        $pdo->prepare(
            "UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?"
        )->execute([$bonus, $deviceId]);
        $pdo->prepare(
            "UPDATE devices SET quota_bytes_total=quota_bytes_total+? WHERE device_id=?"
        )->execute([$bonus, $ownerRow['device_id']]);

        $dev = $pdo->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?");
        $dev->execute([$deviceId]);
        $row = $dev->fetch();
        ok([
            'bonus_bytes'     => $bonus,
            'new_total_bytes' => (int)$row['quota_bytes_total'],
        ]);
    }

    if ($action === 'report-usage') {
        $deviceId  = trim($_POST['device_id']  ?? '');
        $bytesUsed = (int)($_POST['bytes_used'] ?? 0);
        if (!$deviceId) err('missing device_id');

        $pdo = db();
        $pdo->prepare(
            "UPDATE devices SET quota_bytes_used=quota_bytes_used+?, last_seen=datetime('now') WHERE device_id=?"
        )->execute([$bytesUsed, $deviceId]);

        $dev = $pdo->prepare("SELECT quota_bytes_total, quota_bytes_used FROM devices WHERE device_id=?");
        $dev->execute([$deviceId]);
        $row = $dev->fetch();
        if (!$row) err('device not found');

        ok(['remaining_bytes' => max(0, (int)$row['quota_bytes_total'] - (int)$row['quota_bytes_used'])]);
    }

    if ($action === 'update-status') {
        $deviceId = trim($_POST['device_id'] ?? '');
        $status   = trim($_POST['status']    ?? 'offline');
        $protocol = substr(trim($_POST['active_protocol'] ?? ''), 0, 60);
        if (!$deviceId) err('missing device_id');
        if (!in_array($status, ['online', 'offline'], true)) $status = 'offline';

        $pdo = db();
        $pdo->prepare(
            "UPDATE devices SET status=?, active_protocol=?, last_seen=datetime('now') WHERE device_id=?"
        )->execute([$status, $protocol, $deviceId]);
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
        $backup_ips     = json_decode($rows['bundle_backup_ips']     ?? '[]', true) ?: ['5.249.252.221'];
        $backup_domains = json_decode($rows['bundle_backup_domains'] ?? '[]', true) ?: ['edge.setalink.no'];

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

    if ($action === 'submit-payment') {
        $deviceId = trim($_POST['device_id']  ?? '');
        $pkg      = trim($_POST['package']     ?? '');
        $memo     = substr(trim($_POST['memo'] ?? ''), 0, 255);
        $tx       = substr(trim($_POST['tx_hash'] ?? ''), 0, 100);
        $amt      = (float)($_POST['amount_usdt'] ?? 0);
        $validPkgs = ['7days','30days','unlimited','5GB','10GB','15GB'];
        if (!$deviceId) err('missing device_id');
        if (!in_array($pkg, $validPkgs, true)) err('invalid package');

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
        $pdo->prepare("INSERT INTO payment_queue (device_id, package, memo, tx_hash, amount_usdt) VALUES (?,?,?,?,?)")
            ->execute([$deviceId, $pkg, $memo, $tx, $amt]);
        ok(['payment_id' => (int)$pdo->lastInsertId()]);
    }

    if ($action === 'report-session') {
        $deviceId     = trim($_POST['device_id']     ?? '');
        $protocol     = substr(trim($_POST['protocol']  ?? ''), 0, 60);
        $bytesSent    = (int)($_POST['bytes_sent']    ?? 0);
        $bytesRecv    = (int)($_POST['bytes_recv']    ?? 0);
        $durationSecs = (int)($_POST['duration_secs'] ?? 0);
        $appVersion   = substr(trim($_POST['app_version'] ?? ''), 0, 20);
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
        $pdo->prepare(
            "INSERT INTO vpn_sessions
                (device_id, protocol, bytes_sent, bytes_recv, duration_secs, app_version, started_at, ended_at, client_ip)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', ? || ' seconds'), datetime('now'), ?)"
        )->execute([
            $deviceId, $protocol, $bytesSent, $bytesRecv,
            $durationSecs, $appVersion,
            '-' . $durationSecs,
            $_SERVER['REMOTE_ADDR'] ?? '',
        ]);
        // Accumulate quota usage
        $total = $bytesSent + $bytesRecv;
        if ($total > 0) {
            $pdo->prepare(
                "UPDATE devices SET quota_bytes_used=quota_bytes_used+?, last_seen=datetime('now') WHERE device_id=?"
            )->execute([$total, $deviceId]);
        }
        ok(['recorded' => true]);
    }

    err('unknown action');
}

err('method not allowed');
