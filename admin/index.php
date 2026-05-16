<?php
// SetaLink admin dashboard — premium SaaS-style VPN management panel.
// Auth enforced upstream by nginx auth_basic.
// All state changes use api.php (AJAX); this file is render-only.
declare(strict_types=1);

const CLI         = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE = '/^[a-z0-9][a-z0-9._-]{0,31}$/';
const VALID_PKGS  = ['7days', '30days', 'unlimited', '5GB', '10GB', '15GB'];

// -------------------------------------------------------------------------
// CSRF — same derivation as api.php; fallback ensures it never silently breaks.
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
$csrf_token  = hash_hmac('sha256', $auth_user, $csrf_secret);

$admin_path = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php'), '/') . '/';
setcookie('_csrf', $csrf_token, [
    'path'     => $admin_path,
    'secure'   => true,
    'httponly' => true,
    'samesite' => 'Lax',
]);

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function cli_json(string $action, array $args = []): array {
    $cmd = CLI . ' ' . escapeshellarg($action);
    foreach ($args as $a) $cmd .= ' ' . escapeshellarg($a);
    $cmd .= ' 2>&1';
    exec($cmd, $out, $rc);
    if ($rc !== 0) return ['_error' => implode("\n", $out)];
    $j = json_decode(implode("\n", $out), true);
    return is_array($j) ? $j : ['_error' => 'unparseable cli output'];
}
function fmt_bytes(int $b): string {
    if ($b <= 0) return '0 B';
    $units = ['B','KB','MB','GB','TB'];
    $i = 0; $v = (float)$b;
    while ($v >= 1024 && $i < 4) { $v /= 1024; $i++; }
    return ($v >= 100 ? number_format($v, 0) : number_format($v, 1)) . ' ' . $units[$i];
}
function fmt_relative(?string $iso): string {
    if (!$iso) return '—';
    $t = strtotime($iso);
    if ($t === false) return '—';
    $delta = time() - $t;
    if ($delta < 0)        return 'just now';
    if ($delta < 60)       return $delta . 's ago';
    if ($delta < 3600)     return (int)($delta/60) . 'm ago';
    if ($delta < 86400)    return (int)($delta/3600) . 'h ago';
    if ($delta < 86400*30) return (int)($delta/86400) . 'd ago';
    return date('Y-m-d', $t);
}
function fmt_date(?string $iso, string $fmt = 'M j, Y'): string {
    if (!$iso) return '—';
    $t = strtotime($iso);
    return $t !== false ? date($fmt, $t) : '—';
}
function pkg_class(string $pkg): string {
    return 'pkg-' . strtolower(preg_replace('/[^a-z0-9]/i', '', $pkg));
}

// -------------------------------------------------------------------------
// Page routing
// -------------------------------------------------------------------------
$page = (string)($_GET['page'] ?? 'dashboard');
if (!in_array($page, ['dashboard', 'logs', 'protocols', 'settings'], true)) {
    $page = 'dashboard';
}

// -------------------------------------------------------------------------
// Icons (inline SVG, no external deps)
// -------------------------------------------------------------------------
$I = [
    'link'      => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    'menu'      => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    'qr'        => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="17" y2="14"/><line x1="17" y1="17" x2="17" y2="21"/><line x1="20" y1="14" x2="21" y2="14"/><line x1="21" y1="17" x2="21" y2="17"/><line x1="14" y1="20" x2="14" y2="21"/></svg>',
    'copy'      => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    'enable'    => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'disable'   => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    'trash'     => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    'plus'      => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    'refresh'   => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    'search'    => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'download'  => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    'x'         => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    'json'      => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    'json-dl'   => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    'users'     => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'server'    => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    'logs'      => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    'protocols' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    'settings'  => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    'save'      => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    'tg'        => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    'check'     => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    'pause'     => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
];

// -------------------------------------------------------------------------
// Fetch data (status always needed for sidebar)
// -------------------------------------------------------------------------
$status     = cli_json('status');
$err_status = isset($status['_error']);
$xray_state  = (string)($status['services']['xray']  ?? '?');
$nginx_state = (string)($status['services']['nginx'] ?? '?');
$ufw_state   = (string)($status['services']['ufw']   ?? '?');
$host        = (string)($status['host']               ?? '?');
$sni         = (string)($status['sni']                ?? '?');
$pub_port    = (string)($status['ports']['public']    ?? '?');

// Dashboard page also needs user list
$list      = [];
$users     = [];
$total     = 0; $active = 0; $disabled = 0; $max_users = 50;
$err_list  = false;
if ($page === 'dashboard') {
    $list      = cli_json('list');
    $err_list  = isset($list['_error']);
    $users     = $err_list ? [] : (array)($list['users'] ?? []);
    $total     = (int)($list['total']    ?? 0);
    $active    = (int)($list['active']   ?? 0);
    $disabled  = (int)($list['disabled'] ?? 0);
    $max_users = (int)($list['max']      ?? 50);
}

$page_titles = [
    'dashboard' => ['VPN Dashboard',    'Server management &amp; user control'],
    'logs'      => ['Log Viewer',       'Xray &amp; Nginx real-time logs'],
    'protocols' => ['Protocol Health',  'WS / XHTTP / HTTPUpgrade / Reality status'],
    'settings'  => ['Settings',         'Server configuration &amp; integrations'],
];
[$page_title, $page_sub] = $page_titles[$page];
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>SetaLink Admin — <?= h($page_title) ?></title>
  <link rel="stylesheet" href="style.css">
  <style>
    /* ── Additional styles for new pages ─────────────────────────────── */

    /* Server stats row (dashboard top) */
    .srv-stats-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: .75rem;
      margin-bottom: 1.25rem;
    }
    .srv-stat {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: .9rem 1rem;
      display: flex;
      flex-direction: column;
      gap: .3rem;
      transition: border-color .2s;
    }
    .srv-stat:hover { border-color: var(--border-2); }
    .srv-stat-label {
      font-size: .68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .09em;
      color: var(--muted);
    }
    .srv-stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.1;
    }
    .srv-stat.loading .srv-stat-value { color: var(--muted-2); }
    .srv-stat-bar {
      height: 3px;
      background: var(--panel-2);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 3px;
    }
    .srv-stat-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--accent), #79b8ff);
      transition: width .4s ease;
    }
    .srv-stat-bar-fill.warn   { background: linear-gradient(90deg, var(--warn), #f0c050); }
    .srv-stat-bar-fill.danger { background: linear-gradient(90deg, var(--danger), #ff8a80); }

    /* Protocol mini-row (dashboard) */
    .proto-health-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: .75rem;
      margin-bottom: 2rem;
    }
    .proto-mini {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: .65rem 1rem;
      display: flex;
      align-items: center;
      gap: .55rem;
      font-size: .82rem;
    }
    .proto-mini-name { font-weight: 600; color: var(--text-2); flex: 1; min-width: 0; }
    .proto-mini-code { font-family: "JetBrains Mono", monospace; font-size: .7rem; color: var(--muted); white-space: nowrap; }

    /* Protocol cards page */
    .proto-cards-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .proto-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: .75rem;
      transition: border-color .2s;
    }
    .proto-card:hover { border-color: var(--border-2); }
    .proto-card-header {
      display: flex;
      align-items: center;
      gap: .75rem;
    }
    .proto-dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .proto-dot-ok  { background: var(--ok);     box-shadow: 0 0 8px var(--ok); }
    .proto-dot-bad { background: var(--danger);  box-shadow: 0 0 8px var(--danger); }
    .proto-dot-unk { background: var(--muted-2); }
    .proto-card-name { font-size: 1.1rem; font-weight: 700; color: var(--text); }
    .proto-card-body { font-size: .85rem; color: var(--muted); line-height: 1.65; }
    .proto-code-badge {
      display: inline-block;
      font-family: "JetBrains Mono", monospace;
      font-size: .75rem;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      border: 1px solid var(--border-2);
      color: var(--text-2);
      margin-right: .4rem;
    }
    .proto-meaning { font-weight: 600; }
    .proto-checked { font-size: .72rem; color: var(--muted-2); }
    .proto-actions { display: flex; gap: .6rem; }

    /* Log viewer */
    .log-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      padding: 0 1.25rem;
      background: var(--panel-2);
    }
    .log-tab {
      padding: .7rem 1.1rem;
      font-size: .85rem;
      font-weight: 500;
      color: var(--muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: color .15s, border-color .15s;
      white-space: nowrap;
      margin-bottom: -1px;
    }
    .log-tab:hover { color: var(--text-2); }
    .log-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
    .log-toolbar {
      display: flex;
      align-items: center;
      gap: .6rem;
      padding: .75rem 1.25rem;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      background: var(--panel);
    }
    .log-toolbar-right { margin-left: auto; display: flex; gap: .6rem; align-items: center; }
    .log-search {
      background: var(--panel-2);
      border: 1px solid var(--border-2);
      color: var(--text);
      border-radius: var(--radius-sm);
      padding: .4rem .7rem .4rem 2rem;
      font-size: .875rem;
      width: 260px;
      outline: none;
      transition: border-color .15s;
    }
    .log-search:focus { border-color: var(--accent); }
    .log-search::placeholder { color: var(--muted-2); }
    .log-status-pill {
      display: inline-flex;
      align-items: center;
      gap: .4rem;
      padding: .3rem .7rem;
      border-radius: 999px;
      font-size: .72rem;
      font-weight: 600;
      background: var(--panel-2);
      border: 1px solid var(--border-2);
      color: var(--muted);
    }
    .log-status-pill.live   { color: var(--ok);   border-color: rgba(63,185,80,.3);  background: var(--ok-dim); }
    .log-status-pill.paused { color: var(--warn); border-color: rgba(210,153,34,.3); background: var(--warn-dim); }
    .log-pulse {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--ok);
      animation: pulseOnline 1.5s ease-in-out infinite;
    }
    .log-body { overflow-x: auto; }
    .access-table {
      width: 100%;
      border-collapse: collapse;
      font-size: .78rem;
    }
    .access-table thead th {
      background: var(--panel-2);
      padding: .5rem .85rem;
      font-size: .65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted);
      text-align: left;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .access-table tbody tr { border-bottom: 1px solid var(--border); transition: background .1s; }
    .access-table tbody tr:last-child { border-bottom: none; }
    .access-table tbody tr:hover { background: var(--panel-2); }
    .access-table td {
      padding: .45rem .85rem;
      vertical-align: middle;
      color: var(--text-2);
      white-space: nowrap;
    }
    .access-table .td-dest { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
    .log-lines {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: .75rem;
      line-height: 1.55;
      padding: .75rem 1.25rem;
    }
    .log-line { padding: 2px 0; white-space: pre-wrap; word-break: break-all; border-radius: 2px; }
    .log-line-warn    { color: var(--warn); }
    .log-line-error   { color: var(--danger); }
    .log-line-info    { color: var(--muted); }
    .log-line-default { color: var(--text-2); }
    .log-empty   { text-align: center; padding: 3rem 1.5rem; color: var(--muted); font-size: .85rem; }
    .log-loading { text-align: center; padding: 2.5rem 1.5rem; color: var(--muted-2); font-size: .82rem; }

    /* Settings page */
    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      align-items: start;
    }
    .settings-panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .settings-panel-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--panel-2);
    }
    .settings-panel-header h2 {
      font-size: .75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted);
      margin: 0;
    }
    .settings-panel-body { padding: 1.25rem; }
    .settings-panel-footer {
      padding: .85rem 1.25rem;
      border-top: 1px solid var(--border);
      background: var(--panel-2);
      display: flex;
      justify-content: flex-end;
      gap: .6rem;
    }
    .settings-preview {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: .75rem 1rem;
      margin-top: .75rem;
    }
    .settings-preview-label {
      font-size: .68rem;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted-2);
      margin-bottom: .3rem;
    }
    .settings-preview-link {
      color: var(--accent);
      word-break: break-all;
      font-family: "JetBrains Mono", monospace;
      font-size: .75rem;
    }

    /* Responsive */
    @media (max-width: 1000px) {
      .srv-stats-row { grid-template-columns: repeat(3, 1fr); }
      .proto-health-row { grid-template-columns: repeat(2, 1fr); }
      .proto-cards-grid { grid-template-columns: 1fr; }
      .settings-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .srv-stats-row { grid-template-columns: repeat(2, 1fr); }
      .proto-health-row { grid-template-columns: 1fr 1fr; }
      .log-search { width: 100%; }
      .log-toolbar { flex-direction: column; align-items: stretch; }
      .log-toolbar-right { margin-left: 0; }
    }
  </style>
</head>
<body>

<!-- Mobile overlay -->
<div class="overlay" id="overlay"></div>

<!-- =====================================================================
     Sidebar
     ===================================================================== -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="logo">
      <span class="logo-icon"><?= $I['link'] ?></span>
      SetaLink
      <span class="version-chip">VPN</span>
    </div>
    <button class="sidebar-close" id="sidebarClose" aria-label="Close menu"><?= $I['x'] ?></button>
  </div>

  <nav class="nav" aria-label="Main navigation">
    <div class="nav-section">Management</div>
    <a href="?page=dashboard" class="nav-item<?= $page === 'dashboard' ? ' active' : '' ?>">
      <?= $I['users'] ?>
      Dashboard
    </a>
    <a href="?page=logs" class="nav-item<?= $page === 'logs' ? ' active' : '' ?>">
      <?= $I['logs'] ?>
      Logs
    </a>
    <a href="?page=protocols" class="nav-item<?= $page === 'protocols' ? ' active' : '' ?>">
      <?= $I['protocols'] ?>
      Protocols
    </a>
    <a href="?page=settings" class="nav-item<?= $page === 'settings' ? ' active' : '' ?>">
      <?= $I['settings'] ?>
      Settings
    </a>
  </nav>

  <div class="sidebar-footer">
    <div class="svc-row">
      <span class="dot dot-<?= $xray_state === 'active' ? 'ok' : ($xray_state === '?' ? 'unk' : 'bad') ?>"></span>
      <span class="svc-name">xray</span>
      <span class="svc-state"><?= h($xray_state) ?></span>
    </div>
    <div class="svc-row">
      <span class="dot dot-<?= $nginx_state === 'active' ? 'ok' : ($nginx_state === '?' ? 'unk' : 'bad') ?>"></span>
      <span class="svc-name">nginx</span>
      <span class="svc-state"><?= h($nginx_state) ?></span>
    </div>
    <?php if ($ufw_state !== '?'): ?>
    <div class="svc-row">
      <span class="dot dot-<?= stripos($ufw_state,'active') !== false ? 'ok' : 'unk' ?>"></span>
      <span class="svc-name">ufw</span>
      <span class="svc-state"><?= h($ufw_state) ?></span>
    </div>
    <?php endif; ?>
    <div class="auth-user">
      <small>Signed in as</small>
      <code><?= h($auth_user) ?></code>
    </div>
  </div>
</aside>

<!-- =====================================================================
     Main wrap
     ===================================================================== -->
<div class="main-wrap">
  <header class="topbar" role="banner">
    <button class="menu-btn" id="menuBtn" aria-label="Open sidebar"><?= $I['menu'] ?></button>
    <span class="topbar-logo">
      <span style="color:var(--accent)"><?= $I['link'] ?></span>
      SetaLink
    </span>
    <?php if ($page === 'dashboard'): ?>
    <button class="btn btn-primary btn-sm" id="addUserBtnMobile">
      <?= $I['plus'] ?> Add
    </button>
    <?php endif; ?>
  </header>

  <main class="main" id="mainContent">

    <!-- Page header -->
    <div class="page-header">
      <div>
        <h1><?= h($page_title) ?></h1>
        <p><?= $page_sub ?></p>
      </div>
      <div class="page-header-actions">
        <?php if ($page === 'dashboard'): ?>
        <button class="btn btn-secondary" id="refreshBtn" title="Refresh dashboard">
          <?= $I['refresh'] ?> Refresh
        </button>
        <button class="btn btn-primary" id="addUserBtn">
          <?= $I['plus'] ?> Add User
        </button>
        <?php elseif ($page === 'logs'): ?>
        <button class="btn btn-secondary" id="logRefreshNowBtn" title="Refresh now">
          <?= $I['refresh'] ?> Refresh
        </button>
        <?php elseif ($page === 'protocols'): ?>
        <button class="btn btn-primary" id="runProtoCheckBtn">
          <?= $I['check'] ?> Run Check
        </button>
        <?php elseif ($page === 'settings'): ?>
        <button class="btn btn-primary" id="saveSettingsBtn">
          <?= $I['save'] ?> Save Settings
        </button>
        <?php endif; ?>
      </div>
    </div>

    <?php if ($err_status): ?>
    <div class="alert alert-error">
      <?= h('Server status unavailable: ' . ($status['_error'] ?? '')) ?>
      <button class="alert-close" onclick="this.parentElement.remove()">×</button>
    </div>
    <?php endif; ?>

    <!-- =================================================================
         PAGE: DASHBOARD
         ================================================================= -->
    <?php if ($page === 'dashboard'): ?>

    <?php if ($err_list): ?>
    <div class="alert alert-error">
      <?= h('User list unavailable: ' . ($list['_error'] ?? '')) ?>
      <button class="alert-close" onclick="this.parentElement.remove()">×</button>
    </div>
    <?php endif; ?>

    <!-- Server stats row — populated via AJAX -->
    <div class="srv-stats-row" id="srvStatsRow">
      <div class="srv-stat loading" id="srvCpu">
        <div class="srv-stat-label">CPU</div>
        <div class="srv-stat-value" id="srvCpuVal">—</div>
        <div class="srv-stat-bar"><div class="srv-stat-bar-fill" id="srvCpuBar" style="width:0%"></div></div>
      </div>
      <div class="srv-stat loading" id="srvMem">
        <div class="srv-stat-label">Memory</div>
        <div class="srv-stat-value" id="srvMemVal">—</div>
        <div class="srv-stat-bar"><div class="srv-stat-bar-fill" id="srvMemBar" style="width:0%"></div></div>
      </div>
      <div class="srv-stat loading" id="srvLoad">
        <div class="srv-stat-label">Load (1m)</div>
        <div class="srv-stat-value" id="srvLoadVal">—</div>
      </div>
      <div class="srv-stat loading" id="srvUptime">
        <div class="srv-stat-label">Uptime</div>
        <div class="srv-stat-value" id="srvUptimeVal" style="font-size:1.05rem">—</div>
      </div>
      <div class="srv-stat loading" id="srvDisk">
        <div class="srv-stat-label">Disk</div>
        <div class="srv-stat-value" id="srvDiskVal">—</div>
        <div class="srv-stat-bar"><div class="srv-stat-bar-fill" id="srvDiskBar" style="width:0%"></div></div>
      </div>
    </div>

    <!-- Protocol health mini-row — populated via AJAX -->
    <div class="proto-health-row" id="protoMiniRow">
      <div class="proto-mini">
        <span class="dot dot-unk" id="protoMiniDotWS"></span>
        <span class="proto-mini-name">WebSocket</span>
        <span class="proto-mini-code" id="protoMiniCodeWS">—</span>
      </div>
      <div class="proto-mini">
        <span class="dot dot-unk" id="protoMiniDotXHTTP"></span>
        <span class="proto-mini-name">XHTTP</span>
        <span class="proto-mini-code" id="protoMiniCodeXHTTP">—</span>
      </div>
      <div class="proto-mini">
        <span class="dot dot-unk" id="protoMiniDotHTTPUpgrade"></span>
        <span class="proto-mini-name">HTTPUpgrade</span>
        <span class="proto-mini-code" id="protoMiniCodeHTTPUpgrade">—</span>
      </div>
      <div class="proto-mini">
        <span class="dot dot-unk" id="protoMiniDotReality"></span>
        <span class="proto-mini-name">Reality</span>
        <span class="proto-mini-code" id="protoMiniCodeReality">—</span>
      </div>
    </div>

    <!-- User stat cards -->
    <div class="stats-grid" id="statsGrid">
      <div class="stat-card">
        <div class="stat-label">Total Users</div>
        <div class="stat-value">
          <?= h((string)$total) ?><span class="sub"> / <?= h((string)$max_users) ?></span>
        </div>
        <div class="stat-footer">
          <div class="stat-bar">
            <div class="stat-bar-fill" style="width:<?= $max_users > 0 ? min(100, round($total/$max_users*100)) : 0 ?>%"></div>
          </div>
        </div>
      </div>
      <div class="stat-card stat-card-ok">
        <div class="stat-label">Active</div>
        <div class="stat-value stat-ok"><?= h((string)$active) ?></div>
        <div class="stat-sub">Online users</div>
      </div>
      <div class="stat-card stat-card-warn">
        <div class="stat-label">Disabled</div>
        <div class="stat-value stat-warn"><?= h((string)$disabled) ?></div>
        <div class="stat-sub">Suspended accounts</div>
      </div>
      <div class="stat-card stat-card-accent">
        <div class="stat-label">Public Port</div>
        <div class="stat-value stat-accent"><?= h($pub_port) ?></div>
        <div class="stat-sub">REALITY · VLESS</div>
      </div>
    </div>

    <!-- Server info bar -->
    <?php if (!$err_status): ?>
    <div class="server-bar">
      <div class="server-bar-item">
        <span class="server-bar-label">Host</span>
        <code class="server-bar-val"><?= h($host) ?></code>
      </div>
      <div class="server-bar-item">
        <span class="server-bar-label">SNI</span>
        <code class="server-bar-val"><?= h($sni) ?></code>
      </div>
      <div class="server-bar-item">
        <span class="server-bar-label">Protocol</span>
        <span class="server-bar-val">VLESS · XTLS Vision</span>
      </div>
      <div class="server-bar-item">
        <span class="server-bar-label">Security</span>
        <span class="server-bar-val">REALITY</span>
      </div>
    </div>
    <?php endif; ?>

    <!-- Users section -->
    <div class="section">
      <div class="section-header">
        <h2>Users</h2>
        <div class="section-controls">
          <div class="search-wrap">
            <span class="search-icon"><?= $I['search'] ?></span>
            <input type="search" class="search-input" id="userSearch"
                   placeholder="Search users…" autocomplete="off" spellcheck="false">
          </div>
          <select class="filter-select" id="statusFilter" title="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          <select class="filter-select" id="pkgFilter" title="Filter by package">
            <option value="">All packages</option>
            <?php foreach (VALID_PKGS as $p): ?>
            <option value="<?= h(strtolower($p)) ?>"><?= h($p) ?></option>
            <?php endforeach; ?>
          </select>
          <span class="user-count" id="userCount"><?= h((string)count($users)) ?> users</span>
        </div>
      </div>

      <div class="table-wrap">
        <?php if (empty($users)): ?>
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <p>No users yet. Add your first VPN user.</p>
          <button class="btn btn-primary" id="addUserBtnEmpty">
            <?= $I['plus'] ?> Add First User
          </button>
        </div>
        <?php else: ?>
        <table id="usersTable" aria-label="Users list">
          <thead>
            <tr>
              <th>User</th>
              <th>Package</th>
              <th>Traffic</th>
              <th>Created</th>
              <th class="col-expires">Expires</th>
              <th class="col-lastseen">Last Seen</th>
              <th>Status</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="usersBody">
          <?php foreach ($users as $u):
            $name     = (string)$u['name'];
            $is_dis   = (bool)$u['disabled'];
            $is_exp   = (bool)($u['is_expired'] ?? false);
            $pkg      = (string)($u['package_name'] ?? 'unlimited');
            $used     = (int)($u['used_bytes']     ?? 0);
            $upload   = (int)($u['upload_bytes']   ?? 0);
            $download = (int)($u['download_bytes'] ?? 0);
            $quota    = (int)($u['quota_bytes']    ?? 0);
            $pct      = $u['usage_percent'];
            $expires  = $u['expires_at']  ?? null;
            $lastseen = $u['last_seen_at'] ?? null;
            $uuid     = (string)($u['uuid'] ?? '');
            $is_online = $lastseen && (time() - (int)strtotime($lastseen)) < 300;

            $bar_pct = ($pct === null) ? 0 : max(0, min(100, (int)$pct));
            $bar_cls = 'bar-ok';
            if ($pct !== null) {
                if ($pct >= 90) $bar_cls = 'bar-danger';
                elseif ($pct >= 70) $bar_cls = 'bar-warn';
            }

            if ($is_exp) {
                $badge   = '<span class="badge badge-danger">expired</span>';
                $row_cls = 'row-expired';
            } elseif ($is_dis) {
                $badge   = '<span class="badge badge-warn">disabled</span>';
                $row_cls = 'row-disabled';
            } else {
                $badge   = '<span class="badge badge-ok">active</span>';
                $row_cls = '';
            }

            $exp_cls = '';
            if ($expires) {
                $exp_ts = strtotime($expires);
                if ($exp_ts !== false) {
                    $days_left = ($exp_ts - time()) / 86400;
                    if ($days_left <= 0)    $exp_cls = 'text-danger';
                    elseif ($days_left < 4) $exp_cls = 'text-warn';
                }
            }
          ?>
          <tr class="<?= h($row_cls) ?>"
              data-name="<?= h($name) ?>"
              data-status="<?= $is_dis || $is_exp ? 'disabled' : 'active' ?>"
              data-pkg="<?= h(strtolower($pkg)) ?>">
            <td>
              <div class="user-cell">
                <div class="user-avatar"><?= h(strtoupper(substr($name, 0, 1))) ?></div>
                <div>
                  <div class="user-name"><?= h($name) ?></div>
                  <div class="user-uuid" title="<?= h($uuid) ?>"><?= h($uuid) ?></div>
                </div>
              </div>
            </td>
            <td><span class="pkg-badge <?= h(pkg_class($pkg)) ?>"><?= h($pkg) ?></span></td>
            <td>
              <div class="traffic-cell">
                <?php if ($upload > 0 || $download > 0): ?>
                <div class="traffic-dirs">
                  <span class="traffic-up" title="Upload">&#8593; <?= h(fmt_bytes($upload)) ?></span>
                  <span class="traffic-down" title="Download">&#8595; <?= h(fmt_bytes($download)) ?></span>
                </div>
                <?php endif; ?>
                <div class="traffic-text">
                  <?= h(fmt_bytes($used)) ?>
                  <?php if ($quota > 0): ?>
                    <span class="muted-2"> / <?= h(fmt_bytes($quota)) ?></span>
                  <?php else: ?>
                    <span class="traffic-inf"> / ∞</span>
                  <?php endif; ?>
                </div>
                <?php if ($quota > 0): ?>
                <div class="traffic-bar">
                  <div class="traffic-bar-fill <?= h($bar_cls) ?>" style="width:<?= $bar_pct ?>%"></div>
                </div>
                <?php endif; ?>
              </div>
            </td>
            <td class="cell-date"><?= h(fmt_date($u['created'] ?? null)) ?></td>
            <td class="cell-date col-expires">
              <?php if ($expires): ?>
                <span class="<?= h($exp_cls) ?>"><?= h(fmt_date($expires)) ?></span>
              <?php else: ?>
                <span class="muted-2">∞</span>
              <?php endif; ?>
            </td>
            <td class="cell-date col-lastseen">
              <?php if ($is_online): ?><span class="online-dot" title="Online — connected in last 5 min"></span><?php endif; ?>
              <span class="<?= $is_online ? '' : 'muted' ?>"><?= h(fmt_relative($lastseen)) ?></span>
            </td>
            <td><?= $badge ?></td>
            <td>
              <div class="row-actions" style="justify-content:flex-end">
                <button class="btn-icon icon-qr js-qr-btn"
                        data-name="<?= h($name) ?>"
                        title="Show QR code &amp; VLESS link">
                  <?= $I['qr'] ?>
                </button>
                <button class="btn-icon icon-copy js-copy-btn"
                        data-name="<?= h($name) ?>"
                        title="Copy VLESS link">
                  <?= $I['copy'] ?>
                </button>
                <button class="btn-icon icon-json js-json-dl-btn"
                        data-name="<?= h($name) ?>"
                        title="Download full Xray JSON config">
                  <?= $I['json-dl'] ?>
                </button>
                <button class="btn-icon icon-json js-json-copy-btn"
                        data-name="<?= h($name) ?>"
                        title="Copy full Xray JSON config">
                  <?= $I['json'] ?>
                </button>
                <?php if ($is_dis || $is_exp): ?>
                <button class="btn-icon icon-enable js-action-btn"
                        data-action="enable" data-name="<?= h($name) ?>"
                        title="Enable user">
                  <?= $I['enable'] ?>
                </button>
                <?php else: ?>
                <button class="btn-icon icon-disable js-action-btn"
                        data-action="disable" data-name="<?= h($name) ?>"
                        title="Disable user">
                  <?= $I['disable'] ?>
                </button>
                <?php endif; ?>
                <button class="btn-icon icon-delete js-delete-btn"
                        data-name="<?= h($name) ?>"
                        title="Delete user">
                  <?= $I['trash'] ?>
                </button>
              </div>
            </td>
          </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
        <?php endif; ?>
      </div>
    </div><!-- /.section -->

    <!-- =================================================================
         PAGE: LOGS
         ================================================================= -->
    <?php elseif ($page === 'logs'): ?>

    <div class="section" id="logViewer">
      <div class="log-tabs" id="logTabBar">
        <button class="log-tab active" data-log-type="access">Access Logs</button>
        <button class="log-tab" data-log-type="error">Error Logs</button>
        <button class="log-tab" data-log-type="nginx">Nginx Logs</button>
      </div>
      <div class="log-toolbar">
        <div class="search-wrap">
          <span class="search-icon"><?= $I['search'] ?></span>
          <input type="search" class="log-search" id="logSearchInput"
                 placeholder="Filter log lines…" autocomplete="off" spellcheck="false">
        </div>
        <div class="log-toolbar-right">
          <span class="log-status-pill live" id="logStatusPill">
            <span class="log-pulse" id="logPulseDot"></span>
            <span id="logStatusText">Live</span>
          </span>
          <button class="btn btn-secondary btn-sm" id="logPauseBtn">
            <?= $I['pause'] ?> Pause
          </button>
        </div>
      </div>
      <div class="log-body" id="logBody">
        <div class="log-loading">Loading logs…</div>
      </div>
    </div>

    <!-- =================================================================
         PAGE: PROTOCOLS
         ================================================================= -->
    <?php elseif ($page === 'protocols'): ?>

    <div class="proto-cards-grid" id="protoCardsGrid">
      <div class="proto-card" id="protoCardWS">
        <div class="proto-card-header">
          <span class="proto-dot proto-dot-unk" id="protoDotWS"></span>
          <span class="proto-card-name">WebSocket</span>
        </div>
        <div class="proto-card-body" id="protoBodyWS"><span class="muted">Checking…</span></div>
        <div class="proto-checked" id="protoCheckedWS"></div>
        <div class="proto-actions">
          <button class="btn btn-secondary btn-sm js-proto-recheck" data-proto="WS">
            <?= $I['refresh'] ?> Re-check
          </button>
        </div>
      </div>

      <div class="proto-card" id="protoCardXHTTP">
        <div class="proto-card-header">
          <span class="proto-dot proto-dot-unk" id="protoDotXHTTP"></span>
          <span class="proto-card-name">XHTTP</span>
        </div>
        <div class="proto-card-body" id="protoBodyXHTTP"><span class="muted">Checking…</span></div>
        <div class="proto-checked" id="protoCheckedXHTTP"></div>
        <div class="proto-actions">
          <button class="btn btn-secondary btn-sm js-proto-recheck" data-proto="XHTTP">
            <?= $I['refresh'] ?> Re-check
          </button>
        </div>
      </div>

      <div class="proto-card" id="protoCardHTTPUpgrade">
        <div class="proto-card-header">
          <span class="proto-dot proto-dot-unk" id="protoDotHTTPUpgrade"></span>
          <span class="proto-card-name">HTTPUpgrade</span>
        </div>
        <div class="proto-card-body" id="protoBodyHTTPUpgrade"><span class="muted">Checking…</span></div>
        <div class="proto-checked" id="protoCheckedHTTPUpgrade"></div>
        <div class="proto-actions">
          <button class="btn btn-secondary btn-sm js-proto-recheck" data-proto="HTTPUpgrade">
            <?= $I['refresh'] ?> Re-check
          </button>
        </div>
      </div>

      <div class="proto-card" id="protoCardReality">
        <div class="proto-card-header">
          <span class="proto-dot proto-dot-unk" id="protoDotReality"></span>
          <span class="proto-card-name">Reality</span>
        </div>
        <div class="proto-card-body" id="protoBodyReality"><span class="muted">Checking…</span></div>
        <div class="proto-checked" id="protoCheckedReality"></div>
        <div class="proto-actions">
          <button class="btn btn-secondary btn-sm js-proto-recheck" data-proto="Reality">
            <?= $I['refresh'] ?> Re-check
          </button>
        </div>
      </div>
    </div>

    <!-- =================================================================
         PAGE: SETTINGS
         ================================================================= -->
    <?php elseif ($page === 'settings'): ?>

    <div class="settings-grid">
      <div class="settings-panel">
        <div class="settings-panel-header"><h2>General Settings</h2></div>
        <div class="settings-panel-body">
          <div class="form-group">
            <label for="settingTelegramUrl"><?= $I['tg'] ?> Telegram URL</label>
            <input type="url" id="settingTelegramUrl"
                   placeholder="https://t.me/yourchannel"
                   autocomplete="off" spellcheck="false">
            <div class="form-hint">Telegram channel or bot link shown to users</div>
          </div>
          <div id="telegramPreview" style="display:none" class="settings-preview">
            <div class="settings-preview-label">Preview</div>
            <a class="settings-preview-link" id="telegramPreviewLink" href="#" target="_blank" rel="noopener"></a>
          </div>
          <div class="form-group" style="margin-top:1.1rem">
            <label for="settingServerLabel">Server Label</label>
            <input type="text" id="settingServerLabel"
                   placeholder="e.g. SetaLink VPN · EU-West"
                   maxlength="80" autocomplete="off" spellcheck="false">
            <div class="form-hint">Display name shown in configs and user-facing pages</div>
          </div>
          <div id="settingsAlert" class="alert" style="display:none;margin-top:1rem"></div>
        </div>
        <div class="settings-panel-footer">
          <button class="btn btn-secondary" id="reloadSettingsBtn">
            <?= $I['refresh'] ?> Reload
          </button>
          <button class="btn btn-primary" id="saveSettingsBtnPanel">
            <?= $I['save'] ?> Save
          </button>
        </div>
      </div>

      <div class="settings-panel">
        <div class="settings-panel-header"><h2>Server Info</h2></div>
        <div class="settings-panel-body">
          <div style="display:flex;flex-direction:column;gap:.65rem">
            <div class="server-bar-item">
              <span class="server-bar-label">Host</span>
              <code class="server-bar-val"><?= h($host) ?></code>
            </div>
            <div class="server-bar-item">
              <span class="server-bar-label">SNI</span>
              <code class="server-bar-val"><?= h($sni) ?></code>
            </div>
            <div class="server-bar-item">
              <span class="server-bar-label">Port</span>
              <code class="server-bar-val"><?= h($pub_port) ?></code>
            </div>
            <div class="server-bar-item">
              <span class="server-bar-label">xray</span>
              <span class="dot dot-<?= $xray_state === 'active' ? 'ok' : 'bad' ?>" style="margin:0 .3rem"></span>
              <span class="server-bar-val"><?= h($xray_state) ?></span>
            </div>
            <div class="server-bar-item">
              <span class="server-bar-label">nginx</span>
              <span class="dot dot-<?= $nginx_state === 'active' ? 'ok' : 'bad' ?>" style="margin:0 .3rem"></span>
              <span class="server-bar-val"><?= h($nginx_state) ?></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <?php endif; ?>

  </main>
</div><!-- /.main-wrap -->

<!-- =====================================================================
     Toast area
     ===================================================================== -->
<div id="toastArea" aria-live="polite" aria-atomic="true"></div>

<!-- =====================================================================
     Modal: Add User
     ===================================================================== -->
<div class="modal" id="addUserModal" role="dialog" aria-modal="true" aria-labelledby="addUserTitle">
  <div class="modal-dialog">
    <div class="modal-header">
      <h3 id="addUserTitle"><?= $I['plus'] ?> Add New User</h3>
      <button class="modal-close js-modal-close" aria-label="Close"><?= $I['x'] ?></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label for="newUsername">Username</label>
        <input type="text" id="newUsername" name="name"
               pattern="[a-z0-9][a-z0-9._\-]{0,31}" maxlength="32"
               placeholder="e.g. alice_2024" autocomplete="off" spellcheck="false">
        <div class="form-hint">lowercase letters, numbers, . _ − (max 32 chars, starts with letter/number)</div>
      </div>
      <div class="form-group">
        <label for="newPackage">Package</label>
        <select id="newPackage" name="package">
          <option value="7days">7 Days — 7-day access</option>
          <option value="30days" selected>30 Days — 30-day access</option>
          <option value="unlimited">Unlimited — no expiry</option>
          <optgroup label="Data-limited (legacy)">
            <option value="5GB">5 GB</option>
            <option value="10GB">10 GB</option>
            <option value="15GB">15 GB</option>
          </optgroup>
        </select>
      </div>
      <div id="addUserError" class="alert alert-error" style="display:none;margin-top:.75rem"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary js-modal-close">Cancel</button>
      <button class="btn btn-primary" id="addUserSubmit">
        <?= $I['plus'] ?> Add User
      </button>
    </div>
  </div>
</div>

<!-- =====================================================================
     Modal: QR Code / Config
     ===================================================================== -->
<div class="modal" id="qrModal" role="dialog" aria-modal="true" aria-labelledby="qrModalTitle">
  <div class="modal-dialog">
    <div class="modal-header">
      <h3 id="qrModalTitle">VPN Configuration</h3>
      <button class="modal-close js-modal-close" aria-label="Close"><?= $I['x'] ?></button>
    </div>
    <div class="modal-body">
      <div class="qr-container">
        <div class="qr-img-wrap" id="qrImgWrap">
          <div class="qr-loading">Loading QR…</div>
        </div>
        <div class="vless-link-box">
          <span class="vless-link-text" id="vlessLinkText">Loading…</span>
        </div>
        <div class="qr-actions">
          <button class="btn btn-secondary" id="qrCopyBtn">
            <?= $I['copy'] ?> Copy Link
          </button>
          <a class="btn btn-secondary" id="qrDownloadBtn" href="#" download>
            <?= $I['download'] ?> Download QR
          </a>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- =====================================================================
     Modal: Delete Confirm
     ===================================================================== -->
<div class="modal" id="deleteModal" role="dialog" aria-modal="true" aria-labelledby="deleteModalTitle">
  <div class="modal-dialog modal-dialog-sm">
    <div class="modal-header">
      <h3 id="deleteModalTitle">Delete User</h3>
      <button class="modal-close js-modal-close" aria-label="Close"><?= $I['x'] ?></button>
    </div>
    <div class="modal-body">
      <p>Are you sure you want to delete <strong id="deleteUserLabel"></strong>?</p>
      <p class="muted text-sm" style="margin-top:.5rem">
        This will permanently revoke VPN access and cannot be undone.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary js-modal-close">Cancel</button>
      <button class="btn btn-danger" id="deleteConfirmBtn">
        <?= $I['trash'] ?> Delete User
      </button>
    </div>
  </div>
</div>

<!-- =====================================================================
     Modal: Change Package
     ===================================================================== -->
<div class="modal" id="changePkgModal" role="dialog" aria-modal="true" aria-labelledby="changePkgTitle">
  <div class="modal-dialog modal-dialog-sm">
    <div class="modal-header">
      <h3 id="changePkgTitle">Change Package</h3>
      <button class="modal-close js-modal-close" aria-label="Close"><?= $I['x'] ?></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>User: <strong id="changePkgUserLabel"></strong></label>
      </div>
      <div class="form-group">
        <label for="changePkgSelect">New Package</label>
        <select id="changePkgSelect">
          <option value="7days">7 Days</option>
          <option value="30days">30 Days</option>
          <option value="unlimited">Unlimited</option>
          <optgroup label="Data-limited">
            <option value="5GB">5 GB</option>
            <option value="10GB">10 GB</option>
            <option value="15GB">15 GB</option>
          </optgroup>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary js-modal-close">Cancel</button>
      <button class="btn btn-primary" id="changePkgConfirm">Update Package</button>
    </div>
  </div>
</div>

<!-- Modal backdrop (shared) -->
<div class="modal-backdrop" id="modalBackdrop"></div>

<!-- =====================================================================
     Bootstrap data + scripts
     ===================================================================== -->
<script>
const CSRF         = <?= json_encode($csrf_token) ?>;
const API_URL      = 'api.php';
const QR_URL       = 'qr.php';
const CURRENT_PAGE = <?= json_encode($page) ?>;
</script>
<script src="app.js"></script>
<script>
// =========================================================================
// SetaLink extended page logic
// Runs after app.js — showToast, apiPost, closeModal are already defined.
// =========================================================================
'use strict';
window.SL = window.SL || {};

SL.esc = function(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// =========================================================================
// DASHBOARD — server stats (15s) + protocol mini-row (30s)
// =========================================================================
if (CURRENT_PAGE === 'dashboard') {

    // ── Server stats ─────────────────────────────────────────────────────
    function setBarClass(el, pct) {
        el.classList.remove('warn', 'danger');
        if (pct >= 90)      el.classList.add('danger');
        else if (pct >= 70) el.classList.add('warn');
    }

    async function loadServerStats() {
        try {
            const r = await fetch(API_URL + '?action=server-stats', { credentials: 'same-origin' });
            if (!r.ok) return;
            const j = await r.json();
            const d = j.data || j;

            const cpuPct = parseFloat(d.cpu_percent ?? 0);
            const memPct = parseFloat(d.memory_percent ?? 0);
            const dskPct = parseFloat(d.disk_percent ?? 0);

            const set = (valId, cardId, val) => {
                const el = document.getElementById(valId);
                if (el) el.textContent = val;
                document.getElementById(cardId)?.classList.remove('loading');
            };

            set('srvCpuVal',    'srvCpu',    cpuPct.toFixed(1) + '%');
            set('srvMemVal',    'srvMem',    memPct.toFixed(1) + '%');
            set('srvLoadVal',   'srvLoad',   d.load_1    ?? '—');
            set('srvUptimeVal', 'srvUptime', d.uptime    ?? '—');
            set('srvDiskVal',   'srvDisk',   dskPct.toFixed(1) + '%');

            const cpuBar = document.getElementById('srvCpuBar');
            const memBar = document.getElementById('srvMemBar');
            const dskBar = document.getElementById('srvDiskBar');
            if (cpuBar) { cpuBar.style.width = Math.min(cpuPct, 100) + '%'; setBarClass(cpuBar, cpuPct); }
            if (memBar) { memBar.style.width = Math.min(memPct, 100) + '%'; setBarClass(memBar, memPct); }
            if (dskBar) { dskBar.style.width = Math.min(dskPct, 100) + '%'; setBarClass(dskBar, dskPct); }
        } catch (e) { /* silently ignore */ }
    }

    loadServerStats();
    setInterval(loadServerStats, 15000);

    // ── Protocol health mini-row ──────────────────────────────────────────
    function interpretProto(key, code, open) {
        if (key === 'WS') {
            if (code === 101) return true;
            if (code === 400) return true;
            return false;
        }
        if (key === 'XHTTP') {
            return code !== null && [404, 400, 200].includes(code);
        }
        if (key === 'HTTPUpgrade') {
            return code !== null && [502, 400, 200, 101].includes(code);
        }
        if (key === 'Reality') {
            return open === true;
        }
        return false;
    }

    async function loadProtoMini() {
        try {
            const r = await fetch(API_URL + '?action=protocol-health', { credentials: 'same-origin' });
            if (!r.ok) return;
            const j = await r.json();
            const protos = j.data || j.protocols || j;

            const map = {
                WS: 'WS', XHTTP: 'XHTTP', HTTPUpgrade: 'HTTPUpgrade', Reality: 'Reality'
            };
            Object.entries(map).forEach(([key, id]) => {
                const entry = protos[key] || protos[key.toLowerCase()] || {};
                const code  = entry.code ?? entry.status_code ?? null;
                const open  = entry.open ?? null;
                const ok    = interpretProto(key, code, open);

                const dotEl  = document.getElementById('protoMiniDot'  + id);
                const codeEl = document.getElementById('protoMiniCode' + id);
                if (dotEl)  dotEl.className  = 'dot ' + (ok ? 'dot-ok' : 'dot-bad');
                if (codeEl) codeEl.textContent = code !== null
                    ? String(code)
                    : (open !== null ? (open ? 'open' : 'closed') : '—');
            });
        } catch (e) { /* silently ignore */ }
    }

    loadProtoMini();
    setInterval(loadProtoMini, 30000);
}

// =========================================================================
// LOGS PAGE
// =========================================================================
if (CURRENT_PAGE === 'logs') {
    let _logType   = 'access';
    let _logPaused = false;
    let _logTimer  = null;
    let _logFilter = '';
    let _logLines  = [];

    const logBody    = document.getElementById('logBody');
    const pauseBtn   = document.getElementById('logPauseBtn');
    const statusPill = document.getElementById('logStatusPill');
    const statusText = document.getElementById('logStatusText');
    const pulseDot   = document.getElementById('logPulseDot');
    const searchEl   = document.getElementById('logSearchInput');

    const SVG_PAUSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    const SVG_PLAY  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    function setPaused(val) {
        _logPaused = val;
        if (val) {
            if (pauseBtn)   { pauseBtn.innerHTML   = SVG_PLAY + ' Resume'; }
            if (statusPill) { statusPill.className = 'log-status-pill paused'; }
            if (statusText) { statusText.textContent = 'Paused'; }
            if (pulseDot)   { pulseDot.style.display = 'none'; }
            clearTimeout(_logTimer);
        } else {
            if (pauseBtn)   { pauseBtn.innerHTML   = SVG_PAUSE + ' Pause'; }
            if (statusPill) { statusPill.className = 'log-status-pill live'; }
            if (statusText) { statusText.textContent = 'Live'; }
            if (pulseDot)   { pulseDot.style.display = ''; }
            scheduleRefresh();
        }
    }

    pauseBtn?.addEventListener('click', () => setPaused(!_logPaused));
    document.getElementById('logRefreshNowBtn')?.addEventListener('click', () => fetchLogs(_logType));
    searchEl?.addEventListener('input', () => {
        _logFilter = (searchEl.value || '').toLowerCase().trim();
        renderLogs(_logType, _logLines);
    });

    document.querySelectorAll('.log-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _logType  = tab.dataset.logType;
            _logLines = [];
            if (logBody) logBody.innerHTML = '<div class="log-loading">Loading logs…</div>';
            fetchLogs(_logType);
        });
    });

    // Parse xray access log line
    // e.g.: 2026/05/15 13:04:28.185743 from 37.155.49.214:0 accepted tcp:57.144.127.33:443 [direct] email: testuser
    function parseAccess(raw) {
        const m = raw.match(
            /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\.\d+\s+from\s+(\S+)\s+accepted\s+(\S+):(\S+)\s+\[([^\]]+)\](?:\s+email:\s+(\S+))?/
        );
        if (!m) return null;
        return {
            time:      m[1],
            src:       m[2],
            transport: m[3],
            dest:      m[4],
            routing:   m[5],
            user:      m[6] || '—',
        };
    }

    function renderAccessTable(lines) {
        const filt = lines.filter(l => !_logFilter || l.toLowerCase().includes(_logFilter));
        if (!filt.length) {
            logBody.innerHTML = '<div class="log-empty">No matching log lines.</div>';
            return;
        }
        const rows = filt.slice(-100).reverse().map(raw => {
            const p = parseAccess(raw);
            if (!p) return `<tr><td colspan="6" style="font-family:monospace;font-size:.72rem;color:var(--muted-2)">${SL.esc(raw)}</td></tr>`;
            const uc = p.user !== '—' ? 'color:var(--accent)' : 'color:var(--muted)';
            return `<tr>
              <td>${SL.esc(p.time)}</td>
              <td>${SL.esc(p.src)}</td>
              <td><span class="badge badge-ok" style="font-size:.65rem">${SL.esc(p.transport)}</span></td>
              <td style="${uc}">${SL.esc(p.user)}</td>
              <td style="font-size:.72rem;color:var(--muted)">[${SL.esc(p.routing)}]</td>
              <td class="td-dest" title="${SL.esc(p.dest)}">${SL.esc(p.dest)}</td>
            </tr>`;
        }).join('');
        logBody.innerHTML = `<table class="access-table">
          <thead><tr>
            <th>Time</th><th>Source IP</th><th>Transport</th>
            <th>User</th><th>Routing</th><th>Destination</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    function renderGenericLines(lines) {
        const filt = lines.filter(l => !_logFilter || l.toLowerCase().includes(_logFilter));
        if (!filt.length) {
            logBody.innerHTML = '<div class="log-empty">No matching log lines.</div>';
            return;
        }
        const html = filt.slice(-100).reverse().map(raw => {
            const low = raw.toLowerCase();
            let cls = 'log-line-default';
            if (low.includes(' warning') || low.includes('[warning]') || low.includes(' warn'))
                cls = 'log-line-warn';
            else if (low.includes(' error') || low.includes('[error]'))
                cls = 'log-line-error';
            else if (low.includes(' info') || low.includes('[info]'))
                cls = 'log-line-info';
            return `<div class="log-line ${cls}">${SL.esc(raw)}</div>`;
        }).join('');
        logBody.innerHTML = `<div class="log-lines">${html}</div>`;
    }

    function renderLogs(type, lines) {
        _logLines = lines;
        if (type === 'access') renderAccessTable(lines);
        else                   renderGenericLines(lines);
    }

    async function fetchLogs(type) {
        try {
            const r = await fetch(`${API_URL}?action=logs&type=${encodeURIComponent(type)}`, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            renderLogs(type, j.lines || j.data || []);
        } catch (e) {
            if (logBody) logBody.innerHTML = `<div class="log-empty" style="color:var(--danger)">Failed to load: ${SL.esc(e.message)}</div>`;
        }
    }

    function scheduleRefresh() {
        clearTimeout(_logTimer);
        if (_logPaused) return;
        _logTimer = setTimeout(async () => {
            await fetchLogs(_logType);
            scheduleRefresh();
        }, 8000);
    }

    fetchLogs(_logType);
    scheduleRefresh();
}

// =========================================================================
// PROTOCOLS PAGE
// =========================================================================
if (CURRENT_PAGE === 'protocols') {

    function interpretProtoFull(key, entry) {
        const code = entry.code ?? entry.status_code ?? null;
        const open = entry.open ?? null;
        const none = code === null && open === null;

        if (key === 'WS') {
            if (code === 101) return { ok: true,  meaning: 'Connected',      detail: '101 Switching Protocols — WebSocket upgrade accepted by xray.' };
            if (code === 400) return { ok: true,  meaning: 'Routing OK',     detail: 'HTTP 400 — xray is reachable and rejecting unauthenticated upgrades (expected behavior).' };
            if (none)         return { ok: false, meaning: 'No response',    detail: 'Could not reach the WebSocket endpoint. Check nginx and xray.' };
            return              { ok: false, meaning: 'Unexpected',          detail: `HTTP ${code} — possible routing or configuration issue.` };
        }
        if (key === 'XHTTP') {
            if (code !== null && [404, 400, 200].includes(code))
                              return { ok: true,  meaning: 'Routing OK',     detail: `HTTP ${code} — XHTTP path is reachable and routing correctly.` };
            if (none)         return { ok: false, meaning: 'No response',    detail: 'Could not reach the XHTTP endpoint.' };
            return              { ok: false, meaning: 'Unexpected',          detail: `HTTP ${code} — service may be misconfigured.` };
        }
        if (key === 'HTTPUpgrade') {
            if (code !== null && [502, 400, 200, 101].includes(code))
                              return { ok: true,  meaning: 'Routing OK',     detail: `HTTP ${code} — HTTPUpgrade path is reachable.` };
            if (none)         return { ok: false, meaning: 'No response',    detail: 'Could not reach the HTTPUpgrade endpoint.' };
            return              { ok: false, meaning: 'Unexpected',          detail: `HTTP ${code} — check nginx upstream and xray inbound config.` };
        }
        if (key === 'Reality') {
            if (open === true)  return { ok: true,  meaning: 'Port Open',    detail: 'REALITY port is reachable and accepting TLS connections.' };
            return                { ok: false, meaning: 'Port Closed',       detail: 'Cannot connect to the REALITY port. Check ufw and xray.' };
        }
        return { ok: false, meaning: 'Unknown', detail: 'No data returned.' };
    }

    function updateProtoCard(key, entry, ts) {
        const safe  = key.replace(/[^a-zA-Z0-9]/g, '');
        const dotEl = document.getElementById('protoDot'     + safe);
        const bEl   = document.getElementById('protoBody'    + safe);
        const cEl   = document.getElementById('protoChecked' + safe);
        if (!dotEl) return;

        const info = interpretProtoFull(key, entry || {});
        const code = entry?.code ?? entry?.status_code ?? null;
        const open = entry?.open ?? null;

        dotEl.className = 'proto-dot ' + (info.ok ? 'proto-dot-ok' : 'proto-dot-bad');

        let codeBadge = '';
        if (code !== null) codeBadge = `<span class="proto-code-badge">${SL.esc(String(code))}</span>`;
        else if (open !== null) codeBadge = `<span class="proto-code-badge">${open ? 'open' : 'closed'}</span>`;

        const color = info.ok ? 'var(--ok)' : 'var(--danger)';
        bEl.innerHTML = `${codeBadge}<span class="proto-meaning" style="color:${color}">${SL.esc(info.meaning)}</span><br><span style="color:var(--muted);font-size:.8rem">${SL.esc(info.detail)}</span>`;
        if (cEl) cEl.textContent = ts ? 'Last checked: ' + ts : '';
    }

    const PROTO_KEYS = ['WS', 'XHTTP', 'HTTPUpgrade', 'Reality'];

    async function runAllChecks() {
        PROTO_KEYS.forEach(k => {
            const safe = k.replace(/[^a-zA-Z0-9]/g, '');
            const bEl  = document.getElementById('protoBody' + safe);
            if (bEl) bEl.innerHTML = '<span class="muted">Checking…</span>';
        });
        try {
            const r = await fetch(API_URL + '?action=protocol-health', { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j   = await r.json();
            const prt = j.data || j.protocols || j;
            const ts  = new Date().toLocaleTimeString();
            PROTO_KEYS.forEach(k => {
                const entry = prt[k] || prt[k.toLowerCase()] || {};
                updateProtoCard(k, entry, ts);
            });
            showToast('Protocol check complete', 'ok', 3000);
        } catch (e) {
            const ts = new Date().toLocaleTimeString();
            PROTO_KEYS.forEach(k => updateProtoCard(k, {}, ts));
            showToast('Check failed: ' + e.message, 'error', 4000);
        }
    }

    document.getElementById('runProtoCheckBtn')?.addEventListener('click', runAllChecks);

    document.querySelectorAll('.js-proto-recheck').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key  = btn.dataset.proto;
            const safe = key.replace(/[^a-zA-Z0-9]/g, '');
            const bEl  = document.getElementById('protoBody' + safe);
            if (bEl) bEl.innerHTML = '<span class="muted">Checking…</span>';
            btn.disabled = true;
            try {
                const r = await fetch(`${API_URL}?action=protocol-health`, { credentials: 'same-origin' });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const j   = await r.json();
                const prt = j.data || j.protocols || j;
                const ts  = new Date().toLocaleTimeString();
                const entry = prt[key] || prt[key.toLowerCase()] || {};
                updateProtoCard(key, entry, ts);
            } catch (e) {
                updateProtoCard(key, {}, new Date().toLocaleTimeString());
                showToast('Re-check failed: ' + e.message, 'error', 4000);
            }
            btn.disabled = false;
        });
    });

    runAllChecks();
}

// =========================================================================
// SETTINGS PAGE
// =========================================================================
if (CURRENT_PAGE === 'settings') {
    const tgInput   = document.getElementById('settingTelegramUrl');
    const lblInput  = document.getElementById('settingServerLabel');
    const alertEl   = document.getElementById('settingsAlert');
    const tgPreview = document.getElementById('telegramPreview');
    const tgLink    = document.getElementById('telegramPreviewLink');

    function showSettingsAlert(msg, type) {
        alertEl.className    = 'alert alert-' + (type === 'ok' ? 'ok' : 'error');
        alertEl.textContent  = msg;
        alertEl.style.display = 'flex';
        setTimeout(() => { alertEl.style.display = 'none'; }, 5000);
    }

    function updateTgPreview() {
        const val = (tgInput?.value || '').trim();
        if (val && /^https?:\/\//.test(val)) {
            tgPreview.style.display = 'block';
            tgLink.href        = val;
            tgLink.textContent = val;
        } else {
            tgPreview.style.display = 'none';
        }
    }

    tgInput?.addEventListener('input', updateTgPreview);

    async function loadSettings() {
        try {
            const r = await fetch(API_URL + '?action=get-settings', { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            const d = j.data || j;
            if (tgInput  && d.telegram_url  !== undefined) { tgInput.value  = d.telegram_url  || ''; updateTgPreview(); }
            if (lblInput && d.server_label  !== undefined) { lblInput.value = d.server_label  || ''; }
        } catch (e) {
            showSettingsAlert('Failed to load settings: ' + e.message, 'error');
        }
    }

    async function saveSettings() {
        try {
            const r = await fetch(API_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    _csrf:         CSRF,
                    action:        'save-settings',
                    telegram_url:  (tgInput?.value  || '').trim(),
                    server_label:  (lblInput?.value || '').trim(),
                }),
            });
            const j = await r.json();
            if (j.ok) {
                showSettingsAlert('Settings saved.', 'ok');
                showToast('Settings saved', 'ok', 3000);
            } else {
                showSettingsAlert(j.error || 'Failed to save.', 'error');
            }
        } catch (e) {
            showSettingsAlert('Save error: ' + e.message, 'error');
        }
    }

    document.getElementById('saveSettingsBtn')?.addEventListener('click',     saveSettings);
    document.getElementById('saveSettingsBtnPanel')?.addEventListener('click', saveSettings);
    document.getElementById('reloadSettingsBtn')?.addEventListener('click',   loadSettings);

    loadSettings();
}
</script>
</body>
</html>
