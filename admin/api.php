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
function cli_run(string $action, array $args = []): array {
    $cmd = CLI . ' ' . escapeshellarg($action);
    foreach ($args as $a) $cmd .= ' ' . escapeshellarg($a);
    $cmd .= ' 2>&1';
    exec($cmd, $out, $rc);
    return ['rc' => $rc, 'output' => implode("\n", $out)];
}
function cli_json(string $action, array $args = []): array {
    $r = cli_run($action, $args);
    if ($r['rc'] !== 0) return ['_error' => $r['output']];
    $j = json_decode($r['output'], true);
    return is_array($j) ? $j : ['_error' => 'unparseable cli output'];
}

// -------------------------------------------------------------------------
// CSRF setup — same derivation as index.php.
// Falls back to a stable per-installation secret so the panel works even
// before setup-admin.sh creates the secret file.
// -------------------------------------------------------------------------
function csrf_secret(): string {
    $path = '/etc/setalink/admin/csrf.secret';
    if (is_readable($path)) {
        $s = trim((string)file_get_contents($path));
        if ($s !== '') return $s;
    }
    // Stable fallback derived from server identity — never empty.
    return hash('sha256', 'setalink-csrf:' . gethostname() . ':' . __DIR__);
}
$csrf_secret = csrf_secret();
$auth_user   = (string)($_SERVER['PHP_AUTH_USER'] ?? $_SERVER['REMOTE_USER'] ?? '');
$csrf_token  = hash_hmac('sha256', $auth_user, $csrf_secret);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

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
        $db2 = new PDO('sqlite:/etc/setalink/admin/analytics.db', null, null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db2->exec('CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT "", updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )');
        $st = $db2->prepare('INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES(?,?,datetime(\'now\'))');
        foreach ($allowed_keys as $k) {
            if (array_key_exists($k, $data)) $st->execute([$k, (string)$data[$k]]);
        }
        api_ok(['saved' => true]);
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
    case 'status': api_ok(cli_json('status')); break;
    case 'list':   api_ok(cli_json('list'));   break;
    case 'csrf':
        // Returns the CSRF token so JS can bootstrap without a page reload.
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
        api_ok(cli_json('server-stats'));
        break;

    case 'logs':
        $type = preg_match('/^(access|error|nginx)$/', $_GET['type'] ?? 'access') ? $_GET['type'] : 'access';
        $n    = min(500, max(20, (int)($_GET['n'] ?? 100)));
        $r    = cli_run('tail-logs', [$type, (string)$n]);
        $raw  = trim($r['output']);
        $lines = ($raw && $raw !== '[]') ? json_decode($raw, true) : [];
        api_ok(is_array($lines) ? $lines : []);
        break;

    case 'protocol-health':
        function curl_probe(string $url, array $hdrs = [], int $t = 5): string {
            $args = '';
            foreach ($hdrs as $h) $args .= ' -H ' . escapeshellarg($h);
            $cmd = 'curl -sk -o /dev/null -w \'%{http_code}\' --max-time ' . $t . $args . ' ' . escapeshellarg($url);
            return trim((string)shell_exec($cmd));
        }
        function tcp_open(string $host, int $port, int $t = 4): bool {
            $s = @fsockopen($host, $port, $e, $err, $t);
            if ($s) { fclose($s); return true; }
            return false;
        }
        $r = [];
        $ws   = curl_probe('https://edge.setalink.no/ws',    ['Upgrade: websocket','Connection: Upgrade']);
        $r['ws']     = ['ok' => in_array($ws,   ['101','400']), 'code' => $ws,    'name' => 'WebSocket'];
        $xh   = curl_probe('https://edge.setalink.no/xhttp');
        $r['xhttp']  = ['ok' => in_array($xh,   ['404','400','200']), 'code' => $xh,  'name' => 'XHTTP'];
        $hu   = curl_probe('https://edge.setalink.no/httpup', ['Upgrade: XHTTP','Connection: Upgrade']);
        $r['httpup'] = ['ok' => in_array($hu,   ['502','400','200','101']), 'code' => $hu, 'name' => 'HTTPUpgrade'];
        $ok8  = tcp_open('edge.setalink.no', 8443);
        $r['reality']= ['ok' => $ok8, 'code' => $ok8 ? 'open' : 'closed', 'name' => 'Reality'];
        $r['checked_at'] = date('Y-m-d H:i:s');
        api_ok($r);
        break;

    case 'get-settings':
        function open_db(): PDO {
            $db = new PDO('sqlite:/etc/setalink/admin/analytics.db', null, null,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $db->exec('CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT "",
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )');
            return $db;
        }
        $db = open_db();
        $rows = $db->query('SELECT key, value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
        $defaults = ['telegram_url' => 'https://t.me/SetaLink3', 'server_label' => 'SetaLink VPN'];
        api_ok(array_merge($defaults, $rows));
        break;

    default: api_err('unknown action');
}

// POST: save-settings (already past CSRF check above)
// Reached only when action is embedded in POST body and not matched above —
// the POST block exits via api_ok/api_err, so this is unreachable in practice.
