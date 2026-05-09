<?php
// Serves a per-user QR PNG (or vless link as text/plain when fmt=link).
// PHP-FPM runs as www-data, which can't read /etc/setalink/users/<n>/qr.png
// directly (mode 0700/root) — so we proxy through the sudo CLI wrapper.
//
// Auth is enforced upstream by nginx auth_basic; this script trusts that
// PHP-FPM only receives requests that already passed the basic-auth gate.
declare(strict_types=1);

const CLI = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE = '/^[a-z0-9][a-z0-9._-]{0,31}$/';

$name = (string)($_GET['name'] ?? '');
$fmt  = (string)($_GET['fmt']  ?? 'qr');

if (!preg_match(USERNAME_RE, $name)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    exit("invalid username\n");
}
if (!in_array($fmt, ['qr','link'], true)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    exit("invalid fmt\n");
}

$action = ($fmt === 'link') ? 'read-link' : 'read-qr';
$cmd = CLI . ' ' . escapeshellarg($action) . ' ' . escapeshellarg($name);

// Use proc_open so we can capture binary stdout cleanly without exec()'s
// line-buffering, which would mangle PNG bytes.
$desc = [
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
];
$proc = proc_open($cmd, $desc, $pipes);
if (!is_resource($proc)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("could not exec cli\n");
}
$stdout = stream_get_contents($pipes[1]);
$stderr = stream_get_contents($pipes[2]);
foreach ($pipes as $p) { fclose($p); }
$rc = proc_close($proc);

if ($rc !== 0 || $stdout === false || $stdout === '') {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo "not found\n";
    if ($stderr) { echo $stderr; }
    exit;
}

if ($fmt === 'link') {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $stdout;
} else {
    header('Content-Type: image/png');
    header('Content-Length: ' . strlen($stdout));
    header('Cache-Control: no-store');
    header('Content-Disposition: inline; filename="' . preg_replace('/[^a-z0-9._-]/i','_',$name) . '.png"');
    echo $stdout;
}
