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
if (!in_array($page, ['dashboard', 'logs', 'protocols', 'settings', 'diagnostics'], true)) {
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

$LOGO_ICON = '<img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="SetaLink" style="display:block;border-radius:6px">';

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
    'dashboard'   => ['VPN Dashboard',    'Server management &amp; user control'],
    'logs'        => ['Log Viewer',       'Xray &amp; Nginx real-time logs'],
    'protocols'   => ['Protocol Health',  'WS / XHTTP / HTTPUpgrade / Reality status'],
    'settings'    => ['Settings',         'Server configuration &amp; integrations'],
    'diagnostics' => ['Diagnostics',      'Server config · Iran/Turkey tests · Connection analytics'],
];
[$page_title, $page_sub] = $page_titles[$page];
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>SetaLink Admin — <?= h($page_title) ?></title>
  <link rel="icon" type="image/png" href="/assets/logo/shirokhorshid/favicon.ico">
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
      <span class="logo-icon"><?= $LOGO_ICON ?></span>
      <span class="logo-text">SetaLink</span>
      <span class="version-chip">VPN</span>
    </div>
    <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Collapse sidebar" title="Collapse sidebar">
      <svg id="collapseIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="sidebar-close" id="sidebarClose" aria-label="Close menu"><?= $I['x'] ?></button>
  </div>

  <nav class="nav" aria-label="Main navigation">
    <div class="nav-section">Management</div>
    <a href="?page=dashboard" class="nav-item<?= $page === 'dashboard' ? ' active' : '' ?>" data-tooltip="Dashboard">
      <?= $I['users'] ?>
      <span class="nav-label">Dashboard</span>
    </a>
    <a href="?page=logs" class="nav-item<?= $page === 'logs' ? ' active' : '' ?>" data-tooltip="Logs">
      <?= $I['logs'] ?>
      <span class="nav-label">Logs</span>
    </a>
    <a href="?page=protocols" class="nav-item<?= $page === 'protocols' ? ' active' : '' ?>" data-tooltip="Protocols">
      <?= $I['protocols'] ?>
      <span class="nav-label">Protocols</span>
    </a>
    <a href="?page=settings" class="nav-item<?= $page === 'settings' ? ' active' : '' ?>" data-tooltip="Settings">
      <?= $I['settings'] ?>
      <span class="nav-label">Settings</span>
    </a>
    <a href="?page=diagnostics" class="nav-item<?= $page === 'diagnostics' ? ' active' : '' ?>" data-tooltip="Diagnostics">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <span class="nav-label">Diagnostics</span>
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
<div class="main-wrap" id="mainWrap">
  <header class="topbar" role="banner">
    <button class="menu-btn" id="menuBtn" aria-label="Open sidebar"><?= $I['menu'] ?></button>
    <span class="topbar-logo">
      <span style="color:var(--accent)"><?= $LOGO_ICON ?></span>
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
        <?php elseif ($page === 'diagnostics'): ?>
        <button class="btn btn-secondary" id="diagRefreshBtn" title="Refresh diagnostics">
          <?= $I['refresh'] ?> Refresh
        </button>
        <button class="btn btn-primary" id="recordTestBtn">
          <?= $I['plus'] ?> Record Test
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


    <!-- =================================================================
         APP ANALYTICS OVERVIEW
         ================================================================= -->
    <div class="section" style="margin-bottom:1.5rem">
      <div class="section-header">
        <h2>App Analytics</h2>
        <div class="section-controls">
          <span class="badge badge-muted" id="appAnalyticsPeriod">Last 30 days</span>
          <button class="btn btn-secondary" id="refreshAppAnalyticsBtn" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>
      <div class="section-body" style="padding:1.25rem">
        <div class="srv-stats-row" id="appStatsRow" style="grid-template-columns:repeat(5,1fr)">
          <div class="srv-stat">
            <div class="srv-stat-label">Total Installs</div>
            <div class="srv-stat-value" id="appStatInstalls">—</div>
          </div>
          <div class="srv-stat">
            <div class="srv-stat-label">Active (7d)</div>
            <div class="srv-stat-value" id="appStatActive7d">—</div>
          </div>
          <div class="srv-stat">
            <div class="srv-stat-label">New This Month</div>
            <div class="srv-stat-value" id="appStatNewMonth">—</div>
          </div>
          <div class="srv-stat">
            <div class="srv-stat-label">Latest APK</div>
            <div class="srv-stat-value" id="appStatVersion" style="font-size:1.1rem">0.2.0</div>
          </div>
          <div class="srv-stat">
            <div class="srv-stat-label">Failed (24h)</div>
            <div class="srv-stat-value" id="appStatFailed" style="color:var(--danger)">—</div>
          </div>
        </div>

        <div style="margin-top:1rem">
          <div class="section-header" style="padding:0 0 .75rem;border-bottom:1px solid var(--border);margin-bottom:.75rem">
            <span style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Version Distribution</span>
          </div>
          <div id="appVersionDist" style="display:flex;flex-direction:column;gap:.5rem">
            <div class="app-ver-row" data-ver="1.0.0" data-pct="100">
              <span class="app-ver-label">v1.0.0</span>
              <div class="app-ver-bar-wrap"><div class="app-ver-bar" style="width:100%"></div></div>
              <span class="app-ver-pct">100%</span>
            </div>
          </div>
        </div>

        <style>
          .app-ver-row{display:flex;align-items:center;gap:.75rem}
          .app-ver-label{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:var(--text-2);min-width:56px}
          .app-ver-bar-wrap{flex:1;height:6px;background:var(--panel-2);border-radius:3px;overflow:hidden}
          .app-ver-bar{height:100%;background:linear-gradient(90deg,var(--accent),#79b8ff);border-radius:3px;transition:width .4s}
          .app-ver-pct{font-size:.75rem;color:var(--muted);min-width:36px;text-align:right}
        </style>
      </div>
    </div>

    <!-- =================================================================
         SERVER NODES MANAGEMENT
         ================================================================= -->
    <div class="section" style="margin-bottom:1.5rem">
      <div class="section-header">
        <h2>Server Nodes</h2>
        <div class="section-controls">
          <button class="btn btn-primary" id="addNodeBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Node
          </button>
          <button class="btn btn-secondary" id="refreshNodesBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>
        </div>
      </div>
      <div class="section-body" style="padding:0">
        <table class="user-table" id="nodesTable">
          <thead>
            <tr>
              <th>Node</th>
              <th>Location</th>
              <th>Protocol</th>
              <th>Status</th>
              <th>Ping</th>
              <th>Load</th>
              <th>Users</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="nodesTbody">
            <!-- Populated by JS -->
            <tr id="nodesPlaceholder">
              <td colspan="8" style="text-align:center;color:var(--muted);padding:2rem 0">
                Loading nodes…
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Node Modal -->
    <div class="modal-overlay" id="addNodeModal" style="display:none" role="dialog" aria-modal="true">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Add Server Node</h3>
          <button class="modal-close" id="addNodeModalClose" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
          <div class="form-group">
            <label class="form-label">Node Label</label>
            <input type="text" class="form-input" id="nodeLabel" placeholder="e.g. DE-01 Frankfurt" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">IP / Hostname</label>
            <input type="text" class="form-input" id="nodeHost" placeholder="e.g. 185.123.45.67 or de01.example.com" autocomplete="off">
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div class="form-group">
              <label class="form-label">Country</label>
              <input type="text" class="form-input" id="nodeCountry" placeholder="Germany" autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">Flag Emoji</label>
              <input type="text" class="form-input" id="nodeFlag" placeholder="🇩🇪" maxlength="4">
            </div>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div class="form-group">
              <label class="form-label">Protocol</label>
              <select class="form-input" id="nodeProtocol">
                <option value="VLESS+Reality">VLESS + Reality</option>
                <option value="VLESS+XHTTP">VLESS + XHTTP</option>
                <option value="VLESS+WS">VLESS + WebSocket</option>
                <option value="VLESS+HTTPUpgrade">VLESS + HTTPUpgrade</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Port</label>
              <input type="number" class="form-input" id="nodePort" value="443" min="1" max="65535">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tags (comma-separated)</label>
            <input type="text" class="form-input" id="nodeTags" placeholder="premium, europe" autocomplete="off">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="addNodeModalCancel">Cancel</button>
          <button class="btn btn-primary" id="addNodeConfirmBtn">Add Node</button>
        </div>
      </div>
    </div>

    <style>
      #nodesTable .node-flag{font-size:1.1rem}
      #nodesTable .node-label{font-weight:600;color:var(--text)}
      #nodesTable .node-host{font-family:"JetBrains Mono",monospace;font-size:.78rem;color:var(--muted)}
      #nodesTable .node-ping{font-family:"JetBrains Mono",monospace;font-size:.82rem}
      #nodesTable .node-ping.good{color:var(--ok)}
      #nodesTable .node-ping.warn{color:var(--warn)}
      #nodesTable .node-ping.bad{color:var(--danger)}
    </style>

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

    <?php elseif ($page === 'diagnostics'): ?>
    <?php
    // Pre-load server config details for the diagnostics page
    $srv_cfg = cli_json('status');
    $reality = $srv_cfg['reality'] ?? [];
    $transports = $srv_cfg['transports'] ?? [];
    ?>

    <style>
      .diag-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; margin-bottom:1.5rem; }
      .diag-full { grid-column:1/-1; }
      .diag-panel { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius-lg); overflow:hidden; }
      .diag-panel-head {
        padding:.9rem 1.25rem; border-bottom:1px solid var(--border); background:var(--panel-2);
        display:flex; align-items:center; justify-content:space-between;
      }
      .diag-panel-head h2 { font-size:.75rem; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0; }
      .diag-panel-body { padding:1.1rem 1.25rem; }
      .cfg-row { display:flex; align-items:baseline; gap:.6rem; padding:.4rem 0; border-bottom:1px solid var(--border); }
      .cfg-row:last-child { border-bottom:none; }
      .cfg-key { font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); min-width:120px; flex-shrink:0; }
      .cfg-val { font-family:"JetBrains Mono",monospace; font-size:.82rem; color:var(--text-2); word-break:break-all; }
      .cfg-val.ok { color:var(--ok); }
      .cfg-val.warn { color:var(--warn); }
      .cfg-val.danger { color:var(--danger); }
      .transport-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:.75rem; margin-top:.5rem; }
      .transport-card { background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius); padding:.75rem 1rem; }
      .transport-name { font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:.4rem; }
      .transport-detail { font-family:"JetBrains Mono",monospace; font-size:.78rem; color:var(--text-2); }
      .test-result-row { display:flex; align-items:flex-start; gap:1rem; padding:.8rem 0; border-bottom:1px solid var(--border); }
      .test-result-row:last-child { border-bottom:none; }
      .test-country { font-weight:700; color:var(--text); min-width:80px; font-size:.9rem; }
      .test-badge-ok { display:inline-flex; align-items:center; gap:.35rem; padding:.25rem .65rem; border-radius:999px; font-size:.72rem; font-weight:700; background:rgba(63,185,80,.12); color:var(--ok); border:1px solid rgba(63,185,80,.3); }
      .test-badge-fail { display:inline-flex; align-items:center; gap:.35rem; padding:.25rem .65rem; border-radius:999px; font-size:.72rem; font-weight:700; background:rgba(248,81,73,.12); color:var(--danger); border:1px solid rgba(248,81,73,.3); }
      .test-badge-partial { display:inline-flex; align-items:center; gap:.35rem; padding:.25rem .65rem; border-radius:999px; font-size:.72rem; font-weight:700; background:rgba(210,153,34,.12); color:var(--warn); border:1px solid rgba(210,153,34,.3); }
      .test-meta { font-size:.78rem; color:var(--muted); margin-top:.3rem; font-family:"JetBrains Mono",monospace; }
      .test-error { font-size:.78rem; color:var(--danger); margin-top:.3rem; max-width:480px; line-height:1.5; }
      .test-analysis { font-size:.8rem; color:var(--text-2); margin-top:.4rem; line-height:1.6; background:var(--panel-2); border-radius:var(--radius); padding:.5rem .75rem; border-left:3px solid var(--warn); }
      .analytic-num { font-size:1.6rem; font-weight:700; color:var(--text); line-height:1; }
      .analytic-label { font-size:.7rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin-top:.25rem; }
      .analytic-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.75rem; }
      .analytic-card { background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius); padding:.9rem 1rem; }
      .error-log-line { font-family:"JetBrains Mono",monospace; font-size:.72rem; line-height:1.55; padding:2px 0; white-space:pre-wrap; word-break:break-all; color:var(--muted); }
      .error-log-line.is-error { color:var(--danger); }
      .error-log-line.is-warn { color:var(--warn); }
      .error-log-empty { text-align:center; padding:2rem 1rem; color:var(--muted-2); font-size:.85rem; }
      .diag-loading { text-align:center; padding:2rem 1rem; color:var(--muted-2); font-size:.82rem; }
      @media(max-width:900px){ .diag-grid{grid-template-columns:1fr;} .diag-full{grid-column:1;} .analytic-grid{grid-template-columns:repeat(2,1fr);} .transport-grid{grid-template-columns:1fr;} }
    </style>

    <div class="diag-grid">

      <!-- ── Server Config ───────────────────────────────────── -->
      <div class="diag-panel">
        <div class="diag-panel-head">
          <h2>Reality Config</h2>
          <span style="font-size:.7rem;color:var(--muted)">vpn.setalink.no</span>
        </div>
        <div class="diag-panel-body">
          <?php
          $r_host = h((string)($reality['host'] ?? $host));
          $r_port = (int)($reality['port'] ?? 8443);
          $r_sni  = h((string)($reality['sni'] ?? '—'));
          $r_sid  = h((string)($reality['shortId'] ?? '—'));
          $r_flow = h((string)($reality['flow'] ?? '—'));
          $r_fp   = h((string)($reality['fingerprint'] ?? '—'));
          $r_pk   = (string)($reality['publicKey'] ?? '');
          $r_pk_short = strlen($r_pk) > 12 ? substr($r_pk, 0, 8) . '…' . substr($r_pk, -4) : '—';
          ?>
          <div class="cfg-row">
            <span class="cfg-key">Host</span>
            <code class="cfg-val"><?= $r_host ?>:<?= $r_port ?></code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">Protocol</span>
            <code class="cfg-val ok">VLESS + Reality</code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">SNI</span>
            <code class="cfg-val <?= $r_sni === 'www.oracle.com' ? 'danger' : 'ok' ?>"><?= $r_sni ?></code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">Flow</span>
            <code class="cfg-val"><?= $r_flow ?: '(none)' ?></code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">Fingerprint</span>
            <code class="cfg-val"><?= $r_fp ?></code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">ShortId prefix</span>
            <code class="cfg-val"><?= $r_sid ?>…</code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">PublicKey</span>
            <code class="cfg-val" title="<?= h($r_pk) ?>"><?= h($r_pk_short) ?></code>
          </div>
          <div class="cfg-row">
            <span class="cfg-key">Port</span>
            <code class="cfg-val"><?= $r_port ?></code>
          </div>
        </div>
      </div>

      <!-- ── Transport Endpoints ────────────────────────────── -->
      <div class="diag-panel">
        <div class="diag-panel-head">
          <h2>TLS Transport Endpoints</h2>
          <span style="font-size:.7rem;color:var(--muted)">edge.setalink.no:443</span>
        </div>
        <div class="diag-panel-body">
          <?php
          $e_host  = h((string)($transports['edge_host'] ?? '—'));
          $e_port  = (int)($transports['edge_port'] ?? 443);
          $ws_path = h((string)($transports['ws']['path']    ?? '/ws'));
          $xh_path = h((string)($transports['xhttp']['path'] ?? '/xhttp'));
          $hu_path = h((string)($transports['httpup']['path'] ?? '/httpup'));
          ?>
          <div class="transport-grid">
            <div class="transport-card">
              <div class="transport-name">WebSocket</div>
              <div class="transport-detail"><?= $e_host ?>:<?= $e_port ?></div>
              <div class="transport-detail" style="color:var(--muted)"><?= $ws_path ?></div>
            </div>
            <div class="transport-card">
              <div class="transport-name">XHTTP</div>
              <div class="transport-detail"><?= $e_host ?>:<?= $e_port ?></div>
              <div class="transport-detail" style="color:var(--muted)"><?= $xh_path ?></div>
            </div>
            <div class="transport-card">
              <div class="transport-name">HTTPUpgrade</div>
              <div class="transport-detail"><?= $e_host ?>:<?= $e_port ?></div>
              <div class="transport-detail" style="color:var(--muted)"><?= $hu_path ?></div>
            </div>
          </div>
          <div style="margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--border)">
            <div class="cfg-row">
              <span class="cfg-key">Security</span>
              <code class="cfg-val ok">TLS (nginx → xray)</code>
            </div>
            <div class="cfg-row">
              <span class="cfg-key">Camouflage SNI</span>
              <code class="cfg-val"><?= h((string)($srv_cfg['sni'] ?? '—')) ?></code>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Country Test Results ───────────────────────────── -->
      <div class="diag-panel diag-full">
        <div class="diag-panel-head">
          <h2>Country Test Results</h2>
          <span style="font-size:.7rem;color:var(--muted)" id="testResultsCount">Loading…</span>
        </div>
        <div class="diag-panel-body" id="testResultsBody">
          <!-- Known results pre-seeded from the 2026-05-18 test session -->
          <div class="test-result-row">
            <div>
              <div class="test-country">🇹🇷 Turkey</div>
              <div class="test-meta">All 3 configs · 2026-05-18 · SETAEI</div>
            </div>
            <div>
              <span class="test-badge-ok">✓ SUCCESS</span>
              <div class="test-meta">TCP OK · HTTP OK · Browser/IP check passed · Real traffic flowing</div>
            </div>
          </div>
          <div class="test-result-row">
            <div>
              <div class="test-country">🇮🇷 Iran</div>
              <div class="test-meta">178.104.77.231:8443 · sni=www.oracle.com · flow=none · 2026-05-18 · SETAEI</div>
            </div>
            <div>
              <span class="test-badge-fail">✗ FAILED</span>
              <div class="test-error">TCP OK but HTTP+HTTPS probes failed — Read timed out. Traffic not flowing through VPN server. Native probe: SOCKS5 timeout after TUN started.</div>
              <div class="test-analysis">
                <strong>Root cause analysis:</strong> Client config uses <code>sni=www.oracle.com</code> but server is configured for <code>www.microsoft.com</code>.
                Oracle.com is blocked by Iran's national firewall (GFW) — TLS ClientHello with this SNI gets intercepted.
                TCP connects before DPI activates, but subsequent traffic is dropped.
                <br><strong>Fix:</strong> Distribute configs with <code>sni=www.microsoft.com</code> (matches server config, not blocked in Iran).
                Alternatively test VLESS+XHTTP or WebSocket on port 443 which bypass Reality port filtering.
              </div>
            </div>
          </div>
          <div id="dbTestResults"></div>
        </div>
      </div>

      <!-- ── Connection Analytics ──────────────────────────── -->
      <div class="diag-panel">
        <div class="diag-panel-head">
          <h2>Connection Analytics</h2>
          <span class="diag-loading" id="analyticsStatus" style="font-size:.7rem;padding:0;color:var(--muted)">Loading…</span>
        </div>
        <div class="diag-panel-body">
          <div class="analytic-grid" id="analyticsGrid">
            <div class="analytic-card">
              <div class="analytic-num" id="statUserConns">—</div>
              <div class="analytic-label">User Connections</div>
            </div>
            <div class="analytic-card">
              <div class="analytic-num" id="statUniqueIPs">—</div>
              <div class="analytic-label">Unique Client IPs</div>
            </div>
            <div class="analytic-card">
              <div class="analytic-num" id="statErrors" style="color:var(--danger)">—</div>
              <div class="analytic-label">Xray Errors</div>
            </div>
            <div class="analytic-card">
              <div class="analytic-num" id="statRestarts" style="color:var(--warn)">—</div>
              <div class="analytic-label">Xray Restarts</div>
            </div>
          </div>
          <div style="margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--border)">
            <div class="cfg-row">
              <span class="cfg-key">Last user conn</span>
              <code class="cfg-val" id="statLastConn">—</code>
            </div>
            <div class="cfg-row">
              <span class="cfg-key">API polls</span>
              <code class="cfg-val" id="statApiPolls">—</code>
            </div>
            <div class="cfg-row">
              <span class="cfg-key">Warnings (log)</span>
              <code class="cfg-val" id="statWarnings">—</code>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Recent Error Log ──────────────────────────────── -->
      <div class="diag-panel">
        <div class="diag-panel-head">
          <h2>Recent Xray Errors / Warnings</h2>
          <button class="btn btn-secondary" style="padding:.3rem .7rem;font-size:.72rem" id="refreshErrorLogBtn">
            <?= $I['refresh'] ?> Refresh
          </button>
        </div>
        <div class="diag-panel-body" style="padding:0;max-height:320px;overflow-y:auto">
          <div id="errorLogBody" style="padding:.75rem 1rem">
            <div class="diag-loading">Loading error log…</div>
          </div>
        </div>
      </div>

      <!-- ── Iran Compatibility Score ─────────────────────── -->
      <div class="diag-panel" id="iranScorePanel">
        <div class="diag-panel-head">
          <h2>Iran Compatibility Score</h2>
          <span style="font-size:.7rem;color:var(--muted)" id="iranScoreAt">Loading…</span>
        </div>
        <div class="diag-panel-body">
          <div style="display:flex;align-items:center;gap:1.5rem;margin-bottom:1rem">
            <div style="text-align:center">
              <div id="iranScoreNum" style="font-size:2.8rem;font-weight:800;color:var(--ok);line-height:1">—</div>
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:.3rem">Score / 100</div>
            </div>
            <div style="text-align:center;background:var(--panel-2);border-radius:var(--radius);padding:.6rem 1.2rem;border:1px solid var(--border)">
              <div id="iranScoreGrade" style="font-size:2rem;font-weight:900;color:var(--ok);line-height:1">—</div>
              <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-top:.3rem">Grade</div>
            </div>
          </div>
          <div id="iranScoreChecks"></div>
        </div>
      </div>

      <!-- ── Active Sessions ────────────────────────────────── -->
      <div class="diag-panel" id="activeSessionsPanel">
        <div class="diag-panel-head">
          <h2>Active Sessions</h2>
          <span style="font-size:.7rem;color:var(--muted)" id="activeSessionsAt">Loading…</span>
        </div>
        <div class="diag-panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.75rem">
            <div class="analytic-card">
              <div class="analytic-num" id="activeIPs">—</div>
              <div class="analytic-label">Active IPs (5 min)</div>
            </div>
            <div class="analytic-card">
              <div class="analytic-num" id="recentEvents">—</div>
              <div class="analytic-label">Log Events (5 min)</div>
            </div>
          </div>
          <div style="font-size:.75rem;color:var(--muted);margin-top:.5rem">
            Unique client IPs seen in the last 5 minutes via Xray access log. Auto-refreshes every 30s.
          </div>
        </div>
      </div>

      <!-- ── Profile Success Rates ──────────────────────────── -->
      <div class="diag-panel diag-full" id="profileStatsPanel">
        <div class="diag-panel-head">
          <h2>Profile Success Rates</h2>
          <span style="font-size:.7rem;color:var(--muted)">From recorded test results</span>
        </div>
        <div class="diag-panel-body">
          <div id="profileStatsBody">
            <div class="diag-loading">Loading profile statistics…</div>
          </div>
        </div>
      </div>

      <!-- ── No-Internet Analysis ──────────────────────────── -->
      <div class="diag-panel diag-full" id="noInternetPanel">
        <div class="diag-panel-head">
          <h2>CONNECTED + No Internet Analysis</h2>
          <span style="font-size:.7rem;color:var(--danger)">Routing bug tracker</span>
        </div>
        <div class="diag-panel-body">
          <div style="font-size:.78rem;color:var(--muted);margin-bottom:.75rem">
            Profiles that reach TCP OK but apps report no internet.
            High <code>no_internet</code> count = routing/IPv6 issue on that profile+device combo.
          </div>
          <div id="noInternetBody"><div class="diag-loading">Loading…</div></div>
        </div>
      </div>

      <!-- ── SNI Leaderboard ───────────────────────────────── -->
      <div class="diag-panel diag-full" id="sniLeaderboardPanel">
        <div class="diag-panel-head">
          <h2>SNI Leaderboard</h2>
          <span style="font-size:.7rem;color:var(--muted)">Global success rates — use to set remote config priorities</span>
        </div>
        <div class="diag-panel-body">
          <div id="sniLeaderboardBody"><div class="diag-loading">Loading…</div></div>
        </div>
      </div>

      <!-- ── Learning Intelligence ─────────────────────────── -->
      <div class="diag-panel diag-full" id="learningPanel">
        <div class="diag-panel-head">
          <h2>Learning Intelligence</h2>
          <span style="font-size:.7rem;color:var(--muted)">Per-country, per-mode protocol effectiveness</span>
        </div>
        <div class="diag-panel-body">
          <div id="learningBody"><div class="diag-loading">Loading…</div></div>
        </div>
      </div>

      <!-- ── Device Breakdown ──────────────────────────────── -->
      <div class="diag-panel" id="deviceBreakdownPanel">
        <div class="diag-panel-head">
          <h2>Device Breakdown</h2>
          <span style="font-size:.7rem;color:var(--muted)">Android versions + models</span>
        </div>
        <div class="diag-panel-body">
          <div id="deviceBreakdownBody"><div class="diag-loading">Loading…</div></div>
        </div>
      </div>

      <!-- ── Remote Config Editor ──────────────────────────── -->
      <div class="diag-panel" id="remoteConfigPanel">
        <div class="diag-panel-head">
          <h2>Remote Config</h2>
          <span style="font-size:.7rem;color:var(--muted)">Pushed to all apps on next refresh</span>
        </div>
        <div class="diag-panel-body">
          <div id="remoteConfigLoaded">
            <div class="diag-loading">Loading current config…</div>
          </div>

          <!-- Bootstrap Server Section -->
          <details style="margin-bottom:1.25rem" open>
            <summary style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text);cursor:pointer;padding:.5rem 0;user-select:none">Bootstrap Server (Starter Profile for Fresh Installs)</summary>
            <div style="margin-top:.75rem;padding:1rem;background:var(--panel-2);border:1px solid var(--border);border-radius:var(--radius)">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">UUID</label>
                  <input type="text" id="bsUuid" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="ef317b14-...">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Server Address (IP or domain)</label>
                  <input type="text" id="bsAddress" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="5.249.252.221 or setalink.no">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Reality Port</label>
                  <input type="number" id="bsPort" style="width:100%;font-family:monospace;font-size:.8rem" value="8443">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Public Key (X25519)</label>
                  <input type="text" id="bsPubkey" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Short ID</label>
                  <input type="text" id="bsShortid" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="176477b70b8b518b">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">SNI (Reality server name)</label>
                  <input type="text" id="bsSni" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="www.microsoft.com">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Flow</label>
                  <input type="text" id="bsFlow" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="xtls-rprx-vision">
                </div>
                <div class="form-group">
                  <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Fingerprint</label>
                  <input type="text" id="bsFp" style="width:100%;font-family:monospace;font-size:.8rem" placeholder="chrome">
                </div>
              </div>
              <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)">
                <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.5rem">Edge Transport (nginx proxy for WebSocket / XHTTP)</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:.75rem">
                  <div class="form-group">
                    <label style="font-size:.68rem;font-weight:600;color:var(--muted)">Edge Host</label>
                    <input type="text" id="bsEdgeAddress" style="width:100%;font-family:monospace;font-size:.78rem" placeholder="edge.setalink.no">
                  </div>
                  <div class="form-group">
                    <label style="font-size:.68rem;font-weight:600;color:var(--muted)">Edge Port</label>
                    <input type="number" id="bsEdgePort" style="width:100%;font-family:monospace;font-size:.78rem" value="443">
                  </div>
                  <div class="form-group">
                    <label style="font-size:.68rem;font-weight:600;color:var(--muted)">WS Path</label>
                    <input type="text" id="bsWsPath" style="width:100%;font-family:monospace;font-size:.78rem" placeholder="/ws">
                  </div>
                  <div class="form-group">
                    <label style="font-size:.68rem;font-weight:600;color:var(--muted)">XHTTP Path</label>
                    <input type="text" id="bsXhttpPath" style="width:100%;font-family:monospace;font-size:.78rem" placeholder="/xhttp">
                  </div>
                  <div class="form-group">
                    <label style="font-size:.68rem;font-weight:600;color:var(--muted)">HTTPUpgrade Path</label>
                    <input type="text" id="bsHttpupPath" style="width:100%;font-family:monospace;font-size:.78rem" placeholder="/httpup">
                  </div>
                </div>
              </div>
            </div>
          </details>

          <!-- SNI / Kill-switch section -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div class="form-group">
              <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">SNI Priorities (comma-separated)</label>
              <input type="text" id="rcSniPriorities" style="width:100%;font-family:monospace;font-size:.82rem"
                     placeholder="www.microsoft.com, www.bing.com, www.apple.com, …">
            </div>
            <div class="form-group">
              <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Iran SNI Order (comma-separated)</label>
              <input type="text" id="rcIranSniOrder" style="width:100%;font-family:monospace;font-size:.82rem"
                     placeholder="www.microsoft.com, www.bing.com, …">
            </div>
            <div class="form-group">
              <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Kill-Switches (comma-separated)</label>
              <input type="text" id="rcKillSwitches" style="width:100%;font-family:monospace;font-size:.82rem"
                     placeholder="www.oracle.com, VMess/ws, …">
            </div>
            <div class="form-group">
              <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Emergency SNI</label>
              <input type="text" id="rcEmergencySni" style="width:100%;font-family:monospace;font-size:.82rem"
                     placeholder="www.microsoft.com">
            </div>
          </div>
          <button class="btn btn-primary" id="rcSaveBtn" style="margin-top:.75rem">Save Remote Config</button>
          <span id="rcSaveStatus" style="font-size:.78rem;margin-left:.75rem;color:var(--muted)"></span>
          <span id="rcLastUpdated" style="font-size:.72rem;color:var(--muted);margin-left:.5rem"></span>
        </div>
      </div>

      <!-- ── Iran Investigation Notes ──────────────────────── -->
      <div class="diag-panel diag-full" style="border-color:rgba(210,153,34,.35)">
        <div class="diag-panel-head" style="background:rgba(210,153,34,.08)">
          <h2 style="color:var(--warn)">Iran Connectivity Investigation</h2>
          <span style="font-size:.7rem;color:var(--warn)">Updated 2026-05-18</span>
        </div>
        <div class="diag-panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem">
            <div>
              <div style="font-size:.8rem;font-weight:700;color:var(--text);margin-bottom:.6rem">What we know</div>
              <div style="font-size:.82rem;color:var(--text-2);line-height:1.75">
                <div>✅ Turkey: All 3 configs connect successfully</div>
                <div>❌ Iran: TCP OK but all HTTP/HTTPS probes timeout</div>
                <div>❌ Iran: "Read timed out" on SOCKS5 validation</div>
                <div>⚠️ Client SNI mismatch: <code>oracle.com</code> vs server <code>microsoft.com</code></div>
                <div>⚠️ oracle.com is partially blocked in Iran by the GFW</div>
                <div>ℹ️ Port 8443 is reachable (TCP connects from Iran)</div>
              </div>
            </div>
            <div>
              <div style="font-size:.8rem;font-weight:700;color:var(--text);margin-bottom:.6rem">Recommended fixes (priority order)</div>
              <div style="font-size:.82rem;color:var(--text-2);line-height:1.75">
                <div><strong>1.</strong> Regenerate all user VLESS links → <code>sni=www.microsoft.com</code></div>
                <div><strong>2.</strong> Test VLESS+XHTTP on port 443 from Iran (bypasses port filter)</div>
                <div><strong>3.</strong> Test VLESS+WebSocket on port 443 from Iran</div>
                <div><strong>4.</strong> Enable AI Optimizer in app to auto-detect working config</div>
                <div><strong>5.</strong> Consider CDN fronting (Cloudflare) as fallback</div>
                <div><strong>6.</strong> Try alternative SNI: <code>www.apple.com</code>, <code>www.speedtest.net</code></div>
              </div>
            </div>
          </div>
          <div style="margin-top:1rem;padding:.75rem 1rem;background:var(--panel-2);border-radius:var(--radius);border:1px solid var(--border);font-size:.78rem;color:var(--muted);font-family:'JetBrains Mono',monospace">
            Server SNI: <?= h((string)($reality['sni'] ?? 'www.microsoft.com')) ?> | Port: <?= (int)($reality['port'] ?? 8443) ?> | Flow: <?= h((string)($reality['flow'] ?? 'xtls-rprx-vision')) ?> | FP: <?= h((string)($reality['fingerprint'] ?? 'chrome')) ?>
          </div>
        </div>
      </div>

    </div><!-- /.diag-grid -->

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
const API_URL      = '/_setalink-admin/api.php';
const QR_URL       = '/_setalink-admin/qr.php';
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

            const cpuPct = parseFloat(d.cpu_pct ?? d.cpu_percent ?? 0);
            const memPct = parseFloat(d.mem_pct ?? d.memory_percent ?? 0);
            const dskPct = parseFloat(d.disk_pct ?? d.disk_percent ?? 0);

            const set = (valId, cardId, val) => {
                const el = document.getElementById(valId);
                if (el) el.textContent = val;
                document.getElementById(cardId)?.classList.remove('loading');
            };

            const sec = d.uptime_sec ?? d.uptime ?? 0;
            const uptimeStr = sec > 86400
                ? Math.floor(sec / 86400) + 'd ' + Math.floor((sec % 86400) / 3600) + 'h'
                : Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';

            set('srvCpuVal',    'srvCpu',    cpuPct.toFixed(1) + '%');
            set('srvMemVal',    'srvMem',    memPct.toFixed(1) + '%');
            set('srvLoadVal',   'srvLoad',   d.load1 ?? d.load_1 ?? '—');
            set('srvUptimeVal', 'srvUptime', uptimeStr);
            set('srvDiskVal',   'srvDisk',   dskPct.toFixed(1) + '%');

            const cpuBar = document.getElementById('srvCpuBar');
            const memBar = document.getElementById('srvMemBar');
            const dskBar = document.getElementById('srvDiskBar');
            if (cpuBar) { cpuBar.style.width = Math.min(cpuPct, 100) + '%'; setBarClass(cpuBar, cpuPct); }
            if (memBar) { memBar.style.width = Math.min(memPct, 100) + '%'; setBarClass(memBar, memPct); }
            if (dskBar) { dskBar.style.width = Math.min(dskPct, 100) + '%'; setBarClass(dskBar, dskPct); }
        } catch (e) {
            ['srvCpu','srvMem','srvLoad','srvUptime','srvDisk'].forEach(id => {
                document.getElementById(id)?.classList.remove('loading');
            });
        }
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
        const ctrlM = new AbortController();
        const tidM  = setTimeout(() => ctrlM.abort(), 30000);
        try {
            const r = await fetch(API_URL + '?action=protocol-health', { credentials: 'same-origin', signal: ctrlM.signal });
            clearTimeout(tidM);
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
        } catch (e) { clearTimeout(tidM); /* silently ignore on mini dashboard */ }
    }

    loadProtoMini();
    setInterval(loadProtoMini, 30000);

    // ── App analytics ─────────────────────────────────────────────────────
    async function loadAppAnalytics() {
        try {
            const r = await fetch(API_URL + '?action=app-analytics', { credentials: 'same-origin' });
            if (!r.ok) return;
            const j = await r.json();
            const d = j.data || j;
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('appStatInstalls',  d.total_installs  ?? '—');
            set('appStatActive7d',  d.active_7d       ?? '—');
            set('appStatNewMonth',  d.new_this_month  ?? '—');
            set('appStatVersion',   d.latest_version  ? 'v' + d.latest_version : '0.2.0');
            set('appStatFailed',    d.failed_24h      ?? '—');
        } catch (e) { /* silently ignore */ }
    }

    loadAppAnalytics();
    setInterval(loadAppAnalytics, 60000);
    document.getElementById('refreshAppAnalyticsBtn')?.addEventListener('click', loadAppAnalytics);

    // ── Nodes table ───────────────────────────────────────────────────────
    async function loadNodes() {
        try {
            const r = await fetch(API_URL + '?action=node-list', { credentials: 'same-origin' });
            if (!r.ok) return;
            const j = await r.json();
            const nodes = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
            const tbody = document.getElementById('nodesTbody');
            const ph    = document.getElementById('nodesPlaceholder');
            if (!tbody) return;

            const existing = tbody.querySelectorAll('tr[data-node-id]');
            existing.forEach(r => r.remove());
            if (ph) ph.style.display = nodes.length ? 'none' : '';

            const pingClass = p => p < 80 ? 'good' : p < 200 ? 'warn' : 'bad';
            nodes.forEach(n => {
                const tr = document.createElement('tr');
                tr.dataset.nodeId = n.id;
                tr.innerHTML = `
                    <td><span class="node-flag">${SL.esc(n.flag ?? '🌐')}</span> <span class="node-label">${SL.esc(n.label)}</span></td>
                    <td>${SL.esc(n.country ?? '—')}<br><span class="node-host">${SL.esc(n.city ?? '')}</span></td>
                    <td><code>${SL.esc(n.protocol ?? '—')}</code></td>
                    <td><span class="dot ${(n.online || n.status === 'active') ? 'dot-ok' : 'dot-bad'}"></span> ${(n.online || n.status === 'active') ? 'Online' : 'Offline'}</td>
                    <td class="node-ping ${pingClass(n.ping ?? 999)}">${n.ping != null ? n.ping + 'ms' : '—'}</td>
                    <td>${n.load != null ? n.load + '%' : '—'}</td>
                    <td>${n.user_count ?? '—'}</td>
                    <td style="text-align:right">
                        <button class="btn btn-icon" title="Remove" data-action="del-node" data-id="${SL.esc(String(n.id))}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                    </td>`;
                tbody.appendChild(tr);
            });

            tbody.querySelectorAll('[data-action="del-node"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Remove this node?')) return;
                    await fetch(API_URL, { method: 'POST', credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ _csrf: CSRF, action: 'node-delete', id: btn.dataset.id }) });
                    loadNodes();
                });
            });
        } catch (e) { /* silently ignore */ }
    }

    loadNodes();
    document.getElementById('refreshNodesBtn')?.addEventListener('click', loadNodes);

    document.getElementById('addNodeBtn')?.addEventListener('click', () => {
        const modal = document.getElementById('addNodeModal');
        if (modal) modal.classList.add('open');
    });

    document.getElementById('nodeModalCancel')?.addEventListener('click', () => {
        const modal = document.getElementById('addNodeModal');
        if (modal) modal.classList.remove('open');
    });

    document.getElementById('nodeModalSave')?.addEventListener('click', async () => {
        const payload = {
            action:   'node-add',
            label:    document.getElementById('nodeLabel')?.value.trim()   ?? '',
            host:     document.getElementById('nodeHost')?.value.trim()    ?? '',
            country:  document.getElementById('nodeCountry')?.value.trim() ?? '',
            flag:     document.getElementById('nodeFlag')?.value.trim()    ?? '',
            protocol: document.getElementById('nodeProtocol')?.value       ?? 'Reality',
            port:     parseInt(document.getElementById('nodePort')?.value  ?? '443', 10),
            tags:     (document.getElementById('nodeTags')?.value ?? '').split(',').map(s => s.trim()).filter(Boolean),
        };
        if (!payload.label || !payload.host) { showToast('Label and host are required.', 'error', 3000); return; }
        const r = await fetch(API_URL, { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _csrf: CSRF, ...payload }) });
        const j = await r.json();
        if (j.ok || j.success) {
            document.getElementById('addNodeModal')?.classList.remove('open');
            showToast('Node added.', 'success', 2500);
            loadNodes();
        } else {
            showToast(j.error || 'Failed to add node.', 'error', 3000);
        }
    });
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
            logBody.innerHTML = _logFilter
                ? '<div class="log-empty">No log lines match the filter.</div>'
                : '<div class="log-empty">No access log entries yet.</div>';
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
            logBody.innerHTML = _logFilter
                ? '<div class="log-empty">No log lines match the filter.</div>'
                : '<div class="log-empty">No log entries yet.</div>';
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
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 12000);
        try {
            const r = await fetch(`${API_URL}?action=logs&type=${encodeURIComponent(type)}`, { credentials: 'same-origin', signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            const lines = j.lines || j.data || [];
            if (!lines.length) {
                if (logBody) logBody.innerHTML = '<div class="log-empty">No log entries yet.</div>';
            } else {
                renderLogs(type, lines);
            }
        } catch (e) {
            clearTimeout(tid);
            const msg = e.name === 'AbortError' ? 'Request timed out' : SL.esc(e.message);
            if (logBody) logBody.innerHTML = `<div class="log-empty" style="color:var(--danger)">Failed to load: ${msg}</div>`;
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
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 30000);
        try {
            const r = await fetch(API_URL + '?action=protocol-health', { credentials: 'same-origin', signal: ctrl.signal });
            clearTimeout(tid);
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
            clearTimeout(tid);
            const ts  = new Date().toLocaleTimeString();
            const msg = e.name === 'AbortError' ? 'Timed out (30s)' : e.message;
            PROTO_KEYS.forEach(k => updateProtoCard(k, {}, ts));
            showToast('Check failed: ' + msg, 'error', 4000);
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
            const ctrl2 = new AbortController();
            const tid2  = setTimeout(() => ctrl2.abort(), 30000);
            try {
                const r = await fetch(`${API_URL}?action=protocol-health`, { credentials: 'same-origin', signal: ctrl2.signal });
                clearTimeout(tid2);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const j   = await r.json();
                const prt = j.data || j.protocols || j;
                const ts  = new Date().toLocaleTimeString();
                const entry = prt[key] || prt[key.toLowerCase()] || {};
                updateProtoCard(key, entry, ts);
            } catch (e) {
                clearTimeout(tid2);
                const msg2 = e.name === 'AbortError' ? 'Timed out (30s)' : e.message;
                updateProtoCard(key, {}, new Date().toLocaleTimeString());
                showToast('Re-check failed: ' + msg2, 'error', 4000);
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


<!-- =====================================================================
     Modal: Record Test Result
     ===================================================================== -->
<div class="modal" id="recordTestModal" role="dialog" aria-modal="true" aria-labelledby="recordTestTitle">
  <div class="modal-dialog" style="max-width:560px">
    <div class="modal-header">
      <h3 id="recordTestTitle">Record Test Result</h3>
      <button class="modal-close js-modal-close" aria-label="Close"><?= $I['x'] ?></button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:.9rem">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div class="form-group">
          <label>Country</label>
          <input type="text" id="rtCountry" class="form-input" placeholder="e.g. Iran" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Network / ISP</label>
          <input type="text" id="rtNetwork" class="form-input" placeholder="e.g. MCI, Irancell" autocomplete="off">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 80px;gap:.75rem">
        <div class="form-group">
          <label>Server</label>
          <input type="text" id="rtServer" class="form-input" placeholder="e.g. 178.104.77.231" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Port</label>
          <input type="number" id="rtPort" class="form-input" value="8443" min="1" max="65535">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div class="form-group">
          <label>Protocol</label>
          <select id="rtProtocol" class="form-input">
            <option value="VLESS+Reality">VLESS + Reality</option>
            <option value="VLESS+XHTTP">VLESS + XHTTP</option>
            <option value="VLESS+WS">VLESS + WebSocket</option>
            <option value="VLESS+HTTPUpgrade">VLESS + HTTPUpgrade</option>
          </select>
        </div>
        <div class="form-group">
          <label>Result</label>
          <select id="rtResult" class="form-input">
            <option value="fail">✗ Failed</option>
            <option value="success">✓ Success</option>
            <option value="partial">~ Partial</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem">
        <div class="form-group">
          <label>SNI</label>
          <input type="text" id="rtSni" class="form-input" placeholder="www.microsoft.com" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Flow</label>
          <input type="text" id="rtFlow" class="form-input" placeholder="xtls-rprx-vision or empty" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Fingerprint</label>
          <input type="text" id="rtFp" class="form-input" placeholder="chrome" autocomplete="off">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;cursor:pointer">
            <input type="checkbox" id="rtTcpOk"> TCP OK
          </label>
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;cursor:pointer;margin-left:.75rem">
            <input type="checkbox" id="rtHttpOk"> HTTP OK
          </label>
        </div>
        <div class="form-group">
          <label>Latency (ms)</label>
          <input type="number" id="rtLatency" class="form-input" value="0" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>Error message (if failed)</label>
        <textarea id="rtError" class="form-input" rows="2" placeholder="e.g. Read timed out / Deep validation failed" style="resize:vertical"></textarea>
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="rtNotes" class="form-input" rows="2" placeholder="Additional observations" style="resize:vertical"></textarea>
      </div>
      <div id="rtAlert" class="alert" style="display:none"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary js-modal-close">Cancel</button>
      <button class="btn btn-primary" id="rtSubmitBtn">Save Test Result</button>
    </div>
  </div>
</div>

<script>
// ─── Diagnostics page ────────────────────────────────────────────────────────

if (document.getElementById('diagRefreshBtn')) {

  // Fetch with a hard timeout — prevents widgets from staying on "Loading…" forever
  async function diagFetch(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { credentials: 'same-origin', signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') throw new Error('Request timed out after ' + (timeoutMs/1000) + 's');
      throw e;
    }
  }

  async function loadConnectionAnalytics() {
    const el = document.getElementById('analyticsStatus');
    if (el) el.textContent = 'Loading…';
    try {
      const j = await diagFetch(API_URL + '?action=connection-analytics');
      if (!j.ok) { if (el) el.textContent = 'Error: ' + (j.error || 'failed'); return; }
      const d = j.data;

      document.getElementById('statUserConns').textContent  = d.user_connections ?? '—';
      document.getElementById('statUniqueIPs').textContent  = d.unique_client_ips ?? '—';
      document.getElementById('statErrors').textContent     = d.error_count ?? '—';
      document.getElementById('statRestarts').textContent   = d.xray_restarts ?? '—';
      document.getElementById('statLastConn').textContent   = d.last_user_conn_at ?? 'none yet';
      document.getElementById('statApiPolls').textContent   = d.internal_api_polls ?? '—';
      document.getElementById('statWarnings').textContent   = d.warning_count ?? '—';

      if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      if (el) el.textContent = 'Error: ' + e.message;
    }
  }

  async function loadErrorLog() {
    const body = document.getElementById('errorLogBody');
    if (!body) return;
    body.innerHTML = '<div class="diag-loading">Loading…</div>';
    try {
      const j = await diagFetch(API_URL + '?action=connection-analytics');
      const errors = j?.data?.recent_errors ?? [];
      if (!errors.length) {
        body.innerHTML = '<div class="error-log-empty">No errors or warnings in log.</div>';
        return;
      }
      body.innerHTML = errors.map(line => {
        const cls = line.includes('[Error]') ? 'is-error' : line.includes('[Warning]') ? 'is-warn' : '';
        return `<div class="error-log-line ${cls}">${escHtml(line)}</div>`;
      }).join('');
    } catch (e) {
      body.innerHTML = `<div class="error-log-empty" style="color:var(--danger)">Failed to load: ${escHtml(e.message)}</div>`;
    }
  }

  async function loadDbTestResults() {
    const el     = document.getElementById('dbTestResults');
    const countEl = document.getElementById('testResultsCount');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=test-results');
      if (!j.ok) throw new Error(j.error || 'API error');
      const rows = j?.data ?? [];
      if (countEl) countEl.textContent = (rows.length + 2) + ' results';

      if (!rows.length) { el.innerHTML = ''; return; }

      el.innerHTML = rows.map(r => {
        const badgeCls = r.result === 'success' ? 'test-badge-ok' : r.result === 'partial' ? 'test-badge-partial' : 'test-badge-fail';
        const badgeLabel = r.result === 'success' ? '✓ SUCCESS' : r.result === 'partial' ? '~ PARTIAL' : '✗ FAILED';
        const probes = [r.tcp_ok ? 'TCP ✓' : 'TCP ✗', r.http_ok ? 'HTTP ✓' : 'HTTP ✗'].join(' · ');
        const latency = r.latency_ms > 0 ? ` · ${r.latency_ms}ms` : '';
        const errHtml = r.error_msg ? `<div class="test-error">${escHtml(r.error_msg)}</div>` : '';
        const notesHtml = r.notes ? `<div class="test-meta" style="color:var(--muted-2)">${escHtml(r.notes)}</div>` : '';
        return `<div class="test-result-row">
          <div>
            <div class="test-country">${escHtml(r.country)}</div>
            <div class="test-meta">${escHtml(r.server)}:${r.port} · ${escHtml(r.sni)} · ${escHtml(r.recorded_at)} · ${escHtml(r.tested_by || '—')}</div>
          </div>
          <div>
            <span class="${badgeCls}">${badgeLabel}</span>
            <div class="test-meta">${probes}${latency} · ${escHtml(r.protocol)}</div>
            ${errHtml}${notesHtml}
          </div>
        </div>`;
      }).join('');
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }



  document.getElementById('refreshErrorLogBtn')?.addEventListener('click', loadErrorLog);

  // Record Test modal
  document.getElementById('recordTestBtn')?.addEventListener('click', () => {
    // Pre-fill with server config
    document.getElementById('rtServer').value  = '<?= h($host) ?>';
    document.getElementById('rtPort').value    = '<?= h((string)($reality['port'] ?? '8443')) ?>';
    document.getElementById('rtSni').value     = '<?= h((string)($reality['sni'] ?? '')) ?>';
    document.getElementById('rtFlow').value    = '<?= h((string)($reality['flow'] ?? '')) ?>';
    document.getElementById('rtFp').value      = '<?= h((string)($reality['fingerprint'] ?? 'chrome')) ?>';
    document.getElementById('rtResult').value  = 'fail';
    document.getElementById('rtTcpOk').checked = false;
    document.getElementById('rtHttpOk').checked = false;
    document.getElementById('rtLatency').value  = '0';
    document.getElementById('rtError').value    = '';
    document.getElementById('rtNotes').value    = '';
    document.getElementById('rtAlert').style.display = 'none';
    openModal('recordTestModal');
  });

  document.getElementById('rtSubmitBtn')?.addEventListener('click', async () => {
    const country = document.getElementById('rtCountry').value.trim();
    const server  = document.getElementById('rtServer').value.trim();
    if (!country || !server) {
      const a = document.getElementById('rtAlert');
      a.textContent = 'Country and server are required.';
      a.className = 'alert alert-error';
      a.style.display = 'flex';
      return;
    }
    const payload = {
      action:      'record-test',
      country,
      network:     document.getElementById('rtNetwork').value.trim(),
      server,
      port:        parseInt(document.getElementById('rtPort').value) || 8443,
      protocol:    document.getElementById('rtProtocol').value,
      sni:         document.getElementById('rtSni').value.trim(),
      flow:        document.getElementById('rtFlow').value.trim(),
      fingerprint: document.getElementById('rtFp').value.trim(),
      result:      document.getElementById('rtResult').value,
      error_msg:   document.getElementById('rtError').value.trim(),
      tcp_ok:      document.getElementById('rtTcpOk').checked,
      http_ok:     document.getElementById('rtHttpOk').checked,
      latency_ms:  parseInt(document.getElementById('rtLatency').value) || 0,
      notes:       document.getElementById('rtNotes').value.trim(),
    };
    try {
      const r = await apiPost(payload);
      if (r.ok) {
        closeModal('recordTestModal');
        showToast('Test result recorded', 'ok');
        loadDbTestResults();
      } else {
        const a = document.getElementById('rtAlert');
        a.textContent = r.error || 'Failed to save';
        a.className = 'alert alert-error';
        a.style.display = 'flex';
      }
    } catch (e) {
      const a = document.getElementById('rtAlert');
      a.textContent = 'Error: ' + e.message;
      a.className = 'alert alert-error';
      a.style.display = 'flex';
    }
  });

  // ── Iran compatibility score ──────────────────────────────────────────
  async function loadIranScore() {
    const el_checks = document.getElementById('iranScoreChecks');
    try {
      const j = await diagFetch(API_URL + '?action=iran-score');
      if (!j.ok) throw new Error(j.error || 'API error');
      const d = j.data;
      const el_num   = document.getElementById('iranScoreNum');
      const el_grade = document.getElementById('iranScoreGrade');
      const el_at    = document.getElementById('iranScoreAt');
      if (!el_num) return;

      const color = d.score >= 90 ? 'var(--ok)' : d.score >= 70 ? 'var(--warn)' : 'var(--danger)';
      el_num.textContent   = d.score;
      el_num.style.color   = color;
      el_grade.textContent = d.grade;
      el_grade.style.color = color;
      el_at.textContent    = 'Checked ' + d.checked_at;

      if (el_checks) el_checks.innerHTML = (d.checks || []).map(c => `
        <div class="cfg-row">
          <span class="cfg-key">${escHtml(c.label)}</span>
          <code class="cfg-val ${c.ok ? 'ok' : 'danger'}">${c.ok ? '✓' : '✗'} ${escHtml(c.detail)}</code>
        </div>`).join('');
    } catch(e) { if (el_checks) el_checks.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── Active sessions ────────────────────────────────────────────────────
  async function loadActiveSessions() {
    const elAt = document.getElementById('activeSessionsAt');
    try {
      const j = await diagFetch(API_URL + '?action=active-sessions');
      if (!j.ok) throw new Error(j.error || 'API error');
      const d = j.data;
      const elIPs = document.getElementById('activeIPs');
      const elEv  = document.getElementById('recentEvents');
      if (elIPs) elIPs.textContent = d.active_ips;
      if (elEv)  elEv.textContent  = d.recent_events;
      if (elAt)  elAt.textContent  = 'Updated ' + d.checked_at;
    } catch(e) { if (elAt) elAt.textContent = 'Error: ' + e.message; }
  }

  // ── Profile success rates ──────────────────────────────────────────────
  async function loadProfileStats() {
    const el = document.getElementById('profileStatsBody');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=profile-stats');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(j.error||'failed')}</div>`; return; }
      if (!j.data.length) {
        el.innerHTML = '<div class="diag-loading">No profile data yet.</div>';
        return;
      }
      el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem">` +
        j.data.map(p => {
          const pct = p.pct !== null ? p.pct : '—';
          const color = p.pct === null ? 'var(--muted)' : p.pct >= 80 ? 'var(--ok)' : p.pct >= 50 ? 'var(--warn)' : 'var(--danger)';
          return `<div class="analytic-card">
            <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.4rem">${escHtml(p.protocol || '—')}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-2);margin-bottom:.5rem">${escHtml(p.sni || '—')}</div>
            <div style="font-size:1.6rem;font-weight:700;color:${color};line-height:1">${pct}${pct !== '—' ? '%' : ''}</div>
            <div style="font-size:.65rem;color:var(--muted);margin-top:.2rem">${p.success} success / ${p.fail} fail (${p.total} total)</div>
          </div>`;
        }).join('') + `</div>`;
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── No-internet analysis ──────────────────────────────────────────────────
  async function loadNoInternetAnalysis() {
    const el = document.getElementById('noInternetBody');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=no-internet-analysis');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(j.error||'failed')}</div>`; return; }
      if (!j.data.length) {
        el.innerHTML = '<div class="diag-loading">No no-internet events recorded yet — good!</div>';
        return;
      }
      el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Protocol / SNI</th>
          <th style="text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Android</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Total</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--danger);font-size:.7rem;text-transform:uppercase">No-Internet</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--ok);font-size:.7rem;text-transform:uppercase">Probe OK</th>
        </tr>` +
        j.data.map(r => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.4rem .6rem;font-family:monospace">${escHtml(r.protocol)} / ${escHtml(r.sni)}</td>
          <td style="padding:.4rem .6rem;font-family:monospace">${escHtml(r.android_version || '—')}</td>
          <td style="padding:.4rem .6rem;text-align:right">${r.total}</td>
          <td style="padding:.4rem .6rem;text-align:right;color:${r.no_internet_cnt>0?'var(--danger)':'var(--ok)'}">${r.no_internet_cnt}</td>
          <td style="padding:.4rem .6rem;text-align:right">${r.probe_ok_cnt}</td>
        </tr>`).join('') + `</table></div>`;
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── SNI leaderboard ───────────────────────────────────────────────────────
  async function loadSniLeaderboard() {
    const el = document.getElementById('sniLeaderboardBody');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=sni-leaderboard');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(j.error||'failed')}</div>`; return; }
      if (!j.data.length) {
        el.innerHTML = '<div class="diag-loading">No SNI data yet — accumulates after app connections.</div>';
        return;
      }
      el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">SNI</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Total</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--ok);font-size:.7rem;text-transform:uppercase">Connected</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--ok);font-size:.7rem;text-transform:uppercase">Rate</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Avg ms</th>
        </tr>` +
        j.data.map(r => {
          const rate = r.connect_rate !== null ? r.connect_rate : '—';
          const color = r.connect_rate === null ? 'var(--muted)' : r.connect_rate >= 80 ? 'var(--ok)' : r.connect_rate >= 50 ? 'var(--warn)' : 'var(--danger)';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:.4rem .6rem;font-family:monospace;font-weight:600">${escHtml(r.sni)}</td>
            <td style="padding:.4rem .6rem;text-align:right">${r.total}</td>
            <td style="padding:.4rem .6rem;text-align:right;color:var(--ok)">${r.connected}</td>
            <td style="padding:.4rem .6rem;text-align:right;font-weight:700;color:${color}">${rate !== '—' ? rate + '%' : '—'}</td>
            <td style="padding:.4rem .6rem;text-align:right;font-family:monospace">${r.avg_latency ?? '—'}</td>
          </tr>`;
        }).join('') + `</table></div>`;
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── Learning intelligence ─────────────────────────────────────────────────
  async function loadLearningStats() {
    const el = document.getElementById('learningBody');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=learning-stats');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(j.error||'failed')}</div>`; return; }
      if (!j.data.length) {
        el.innerHTML = '<div class="diag-loading">No learning data yet — accumulates as mobile app connects.</div>';
        return;
      }
      el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Country/Mode</th>
          <th style="text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Protocol / SNI</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Attempts</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--ok);font-size:.7rem;text-transform:uppercase">Rate</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--danger);font-size:.7rem;text-transform:uppercase">No-Net</th>
          <th style="text-align:right;padding:.4rem .6rem;color:var(--muted);font-size:.7rem;text-transform:uppercase">Avg ms</th>
        </tr>` +
        j.data.slice(0, 50).map(r => {
          const rate  = r.connect_rate !== null ? r.connect_rate : '—';
          const color = r.connect_rate === null ? 'var(--muted)' : r.connect_rate >= 80 ? 'var(--ok)' : r.connect_rate >= 50 ? 'var(--warn)' : 'var(--danger)';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:.4rem .6rem;font-weight:600">${escHtml(r.country||'?')} / ${escHtml(r.mode||'?')}</td>
            <td style="padding:.4rem .6rem;font-family:monospace;font-size:.72rem">${escHtml(r.protocol)} / ${escHtml(r.sni)}</td>
            <td style="padding:.4rem .6rem;text-align:right">${r.total}</td>
            <td style="padding:.4rem .6rem;text-align:right;font-weight:700;color:${color}">${rate !== '—' ? rate+'%' : '—'}</td>
            <td style="padding:.4rem .6rem;text-align:right;color:${r.no_internet_cnt>0?'var(--danger)':'var(--muted)'}">${r.no_internet_cnt}</td>
            <td style="padding:.4rem .6rem;text-align:right;font-family:monospace">${r.avg_latency ?? '—'}</td>
          </tr>`;
        }).join('') + `</table></div>`;
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── Device breakdown ──────────────────────────────────────────────────────
  async function loadDeviceBreakdown() {
    const el = document.getElementById('deviceBreakdownBody');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=device-breakdown');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(j.error||'failed')}</div>`; return; }
      if (!j.data.length) {
        el.innerHTML = '<div class="diag-loading">No device data yet — appears after mobile app telemetry reports.</div>';
        return;
      }
      el.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:.3rem .5rem;color:var(--muted);font-size:.68rem;text-transform:uppercase">Model</th>
          <th style="text-align:left;padding:.3rem .5rem;color:var(--muted);font-size:.68rem;text-transform:uppercase">Android</th>
          <th style="text-align:right;padding:.3rem .5rem;color:var(--muted);font-size:.68rem;text-transform:uppercase">Attempts</th>
          <th style="text-align:right;padding:.3rem .5rem;color:var(--ok);font-size:.68rem;text-transform:uppercase">Connected</th>
          <th style="text-align:right;padding:.3rem .5rem;color:var(--danger);font-size:.68rem;text-transform:uppercase">No-Net</th>
        </tr>` +
        j.data.map(r => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.3rem .5rem;font-family:monospace;font-size:.72rem">${escHtml(r.device_model||'unknown')}</td>
          <td style="padding:.3rem .5rem;font-family:monospace">${escHtml(r.android_version||'—')}</td>
          <td style="padding:.3rem .5rem;text-align:right">${r.attempts}</td>
          <td style="padding:.3rem .5rem;text-align:right;color:var(--ok)">${r.connected}</td>
          <td style="padding:.3rem .5rem;text-align:right;color:${r.no_internet_cnt>0?'var(--danger)':'var(--muted)'}">${r.no_internet_cnt}</td>
        </tr>`).join('') + `</table></div>`;
    } catch(e) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">Error: ${escHtml(e.message)}</div>`; }
  }

  // ── Remote config loader + saver ──────────────────────────────────────────
  async function loadRemoteConfigEditor() {
    const el = document.getElementById('remoteConfigLoaded');
    if (!el) return;
    try {
      const j = await diagFetch(API_URL + '?action=get-remote-config');
      if (!j.ok) { el.innerHTML = `<div class="diag-loading" style="color:var(--danger)">API error: ${escHtml(j.error||'unknown')}</div>`; return; }
      const d = j.data;
      el.innerHTML = `<div style="font-size:.75rem;color:var(--muted);margin-bottom:.5rem">
        Version ${d.version} — Updated: ${d.updated_at || 'never'} — Bootstrap: ${d.bootstrap_set ? '<span style="color:var(--ok)">✅ Configured</span>' : '<span style="color:var(--danger)">❌ Not set</span>'}
      </div>`;
      const f = (id, val) => { const el2 = document.getElementById(id); if (el2) el2.value = Array.isArray(val) ? val.join(', ') : (val||''); };
      f('rcSniPriorities', d.sni_priorities);
      f('rcIranSniOrder',  d.iran_sni_order);
      f('rcKillSwitches',  d.kill_switches);
      f('rcEmergencySni',  d.emergency_sni);
      // Populate bootstrap fields if available
      if (d.bootstrap) {
        const bs = d.bootstrap;
        f('bsUuid',        bs.uuid);
        f('bsAddress',     bs.address);
        f('bsPort',        bs.port);
        f('bsPubkey',      bs.publicKey);
        f('bsShortid',     bs.shortId);
        f('bsSni',         bs.sni);
        f('bsFlow',        bs.flow);
        f('bsFp',          bs.fingerprint);
        f('bsEdgeAddress', bs.edgeAddress || 'edge.setalink.no');
        f('bsEdgePort',    bs.edgePort    || 443);
        f('bsWsPath',      bs.wsPath      || '/ws');
        f('bsXhttpPath',   bs.xhttpPath   || '/xhttp');
        f('bsHttpupPath',  bs.httpupPath  || '/httpup');
      }
    } catch(e) { el.innerHTML = '<div class="diag-loading">Error loading remote config.</div>'; }
  }

  const parseList = v => v.split(',').map(s => s.trim()).filter(Boolean);

  document.getElementById('rcSaveBtn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('rcSaveBtn');
    const status = document.getElementById('rcSaveStatus');
    const lastUpdatedEl = document.getElementById('rcLastUpdated');
    if (!btn) return;

    btn.disabled = true;
    const origText = btn.innerHTML;
    btn.innerHTML = '<span style="opacity:.7">Saving…</span>';
    if (status) status.textContent = '';

    try {
      const payload = {
        _csrf:             CSRF,
        action:            'save-remote-config',
        rc_sni_priorities: parseList(document.getElementById('rcSniPriorities')?.value || ''),
        rc_iran_sni_order: parseList(document.getElementById('rcIranSniOrder')?.value || ''),
        rc_kill_switches:  parseList(document.getElementById('rcKillSwitches')?.value || ''),
        rc_emergency_sni:  document.getElementById('rcEmergencySni')?.value?.trim() || '',
        // Bootstrap server fields
        bootstrap_uuid:         document.getElementById('bsUuid')?.value?.trim()        || '',
        bootstrap_address:      document.getElementById('bsAddress')?.value?.trim()     || '',
        bootstrap_port:         parseInt(document.getElementById('bsPort')?.value || '8443'),
        bootstrap_pubkey:       document.getElementById('bsPubkey')?.value?.trim()      || '',
        bootstrap_shortid:      document.getElementById('bsShortid')?.value?.trim()     || '',
        bootstrap_sni:          document.getElementById('bsSni')?.value?.trim()         || 'www.microsoft.com',
        bootstrap_flow:         document.getElementById('bsFlow')?.value?.trim()        || 'xtls-rprx-vision',
        bootstrap_fp:           document.getElementById('bsFp')?.value?.trim()          || 'chrome',
        bootstrap_edge_address: document.getElementById('bsEdgeAddress')?.value?.trim() || 'edge.setalink.no',
        bootstrap_edge_port:    parseInt(document.getElementById('bsEdgePort')?.value || '443'),
        bootstrap_ws_path:      document.getElementById('bsWsPath')?.value?.trim()      || '/ws',
        bootstrap_xhttp_path:   document.getElementById('bsXhttpPath')?.value?.trim()   || '/xhttp',
        bootstrap_httpup_path:  document.getElementById('bsHttpupPath')?.value?.trim()  || '/httpup',
      };
      const r = await fetch(API_URL, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.ok) {
        showToast('Remote config saved', 'ok', 3000);
        const now = new Date().toLocaleTimeString();
        if (lastUpdatedEl) lastUpdatedEl.textContent = 'Last saved: ' + now;
        if (status) { status.style.color = 'var(--ok)'; status.textContent = '✓ Saved at ' + now; }
        loadRemoteConfigEditor();
      } else {
        showToast('Save failed: ' + (j.error || 'unknown error'), 'error', 4000);
        if (status) { status.style.color = 'var(--danger)'; status.textContent = 'Error: ' + (j.error || 'unknown'); }
      }
    } catch(e) {
      showToast('Network error: ' + e.message, 'error', 4000);
      if (status) { status.style.color = 'var(--danger)'; status.textContent = 'Save failed'; }
    }

    btn.disabled = false;
    btn.innerHTML = origText;
  });

  // Refresh all panels on button click
  document.getElementById('diagRefreshBtn')?.addEventListener('click', () => {
    loadConnectionAnalytics();
    loadErrorLog();
    loadDbTestResults();
    loadIranScore();
    loadActiveSessions();
    loadProfileStats();
    loadNoInternetAnalysis();
    loadSniLeaderboard();
    loadLearningStats();
    loadDeviceBreakdown();
    loadRemoteConfigEditor();
  });

  // Auto-refresh active sessions every 30 seconds
  setInterval(loadActiveSessions, 30000);

  // Auto-load diagnostics data on page load
  loadConnectionAnalytics();
  loadErrorLog();
  loadDbTestResults();
  loadIranScore();
  loadActiveSessions();
  loadProfileStats();
  loadNoInternetAnalysis();
  loadSniLeaderboard();
  loadLearningStats();
  loadDeviceBreakdown();
  loadRemoteConfigEditor();
}
</script>
</body>
</html>
