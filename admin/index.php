<?php
declare(strict_types=1);

// ── Auth / CSRF ───────────────────────────────────────────────────────
function csrf_secret(): string {
    $path = '/etc/setalink/admin/csrf.secret';
    if (is_readable($path)) {
        $s = trim((string)file_get_contents($path));
        if ($s !== '') return $s;
    }
    return hash('sha256', 'setalink-csrf:' . gethostname() . ':' . __DIR__);
}
$csrf_secret = csrf_secret();
$auth_user   = (string)($_SERVER['PHP_AUTH_USER'] ?? $_SERVER['REMOTE_USER'] ?? 'admin');
$csrf_token  = hash_hmac('sha256', $auth_user, $csrf_secret);
$admin_path  = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/admin/index.php'), '/') . '/';

setcookie('_csrf', $csrf_token, ['path'=>$admin_path,'secure'=>true,'httponly'=>true,'samesite'=>'Lax']);
setcookie('_sl_session', hash_hmac('sha256','sl-session:'.$auth_user,$csrf_secret),
    ['path'=>$admin_path,'secure'=>true,'httponly'=>true,'samesite'=>'Strict','expires'=>time()+28800]);

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }

$page = (string)($_GET['page'] ?? 'dashboard');
if (!in_array($page, ['dashboard','iran','devices','logs','release','config'], true)) $page = 'dashboard';

// Inline SVG icon helper
function icon(string $name): string {
    static $icons = [
        'grid'    => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
        'globe'   => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
        'devices' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        'log'     => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        'package' => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        'settings'=> '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        'menu'    => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
        'refresh' => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        'x'       => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        'download'=> '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        'check'   => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        'alert'   => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        'trash'   => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
        'copy'    => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        'save'    => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
        'plus'    => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    ];
    return $icons[$name] ?? '';
}
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>SetaLink Admin</title>
  <link rel="icon" href="/assets/logo/shirokhorshid/favicon.ico">
  <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="layout">

<!-- ── Sidebar overlay (mobile backdrop) ───────────────────────────── -->
<div class="sidebar-overlay" id="sidebarOverlay"></div>

<!-- ── Sidebar ──────────────────────────────────────────────────────── -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-logo">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" alt="SL">
    <div>
      <div class="sidebar-logo-text">SetaLink</div>
      <div class="sidebar-logo-sub">Admin Panel</div>
    </div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section">Monitor</div>
    <div class="nav-item<?= $page==='dashboard'?' active':'' ?>" data-page="dashboard">
      <?= icon('grid') ?> Dashboard
    </div>
    <div class="nav-item<?= $page==='iran'?' active':'' ?>" data-page="iran">
      <?= icon('globe') ?> Iran Debug
    </div>
    <div class="nav-section">Manage</div>
    <div class="nav-item<?= $page==='devices'?' active':'' ?>" data-page="devices">
      <?= icon('devices') ?> Devices
    </div>
    <div class="nav-item<?= $page==='logs'?' active':'' ?>" data-page="logs">
      <?= icon('log') ?> Logs
    </div>
    <div class="nav-section">System</div>
    <div class="nav-item<?= $page==='release'?' active':'' ?>" data-page="release">
      <?= icon('package') ?> Release
    </div>
    <div class="nav-item<?= $page==='config'?' active':'' ?>" data-page="config">
      <?= icon('settings') ?> Config
    </div>
  </nav>
  <div class="sidebar-footer">SetaLink v0.9.12 &middot; <?= h($auth_user) ?></div>
</aside>

<!-- ── Main ─────────────────────────────────────────────────────────── -->
<main class="main">
  <div class="topbar">
    <button class="menu-toggle btn btn-icon btn-ghost" id="menuToggle"><?= icon('menu') ?></button>
    <span class="topbar-title" id="pageTitle">Dashboard</span>
    <span class="topbar-sub" id="pageSub"></span>
    <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
      <span class="refresh-ts" id="globalTs"></span>
      <button class="btn btn-ghost btn-sm" id="refreshBtn" title="Refresh"><?= icon('refresh') ?> Refresh</button>
    </div>
  </div>

  <div class="page-content">

    <!-- ── HEARTBEAT BAR (all pages) ─────────────────────────────── -->
    <div class="hb-bar" id="hbBar">
      <div class="hb-item"><span class="dot dot-unk" id="hbXray"></span> Xray</div>
      <div class="hb-item"><span class="dot dot-unk" id="hbNginx"></span> Nginx</div>
      <div class="hb-item"><span class="dot dot-unk" id="hbSqlite"></span> DB</div>
      <div class="hb-item"><span class="dot dot-unk" id="hbApi"></span> API</div>
      <div class="hb-item"><span class="dot dot-unk" id="hbBootstrap"></span> Bootstrap</div>
      <div class="hb-item"><span class="dot dot-unk" id="hbPort"></span> :8443</div>
      <span class="hb-ts" id="hbTs">—</span>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: DASHBOARD                                              -->
    <!-- ============================================================ -->
    <div data-view="dashboard">
      <div class="stat-grid" id="dashStats">
        <div class="stat-card"><div class="stat-label">Online Now</div><div class="stat-value" id="statOnline">—</div><div class="stat-sub">last 5 minutes</div></div>
        <div class="stat-card"><div class="stat-label">Total Devices</div><div class="stat-value" id="statTotal">—</div><div class="stat-sub" id="statNew">—</div></div>
        <div class="stat-card"><div class="stat-label">Active 7d</div><div class="stat-value" id="statActive7d">—</div><div class="stat-sub" id="statActiveToday">—</div></div>
        <div class="stat-card"><div class="stat-label">Failures 24h</div><div class="stat-value" id="statFailed">—</div><div class="stat-sub">test reports</div></div>
        <div class="stat-card"><div class="stat-label">Live Events</div><div class="stat-value" id="statEvents">—</div><div class="stat-sub">5-min window</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title"><?= icon('globe') ?> Protocol Health</span>
            <button class="btn btn-ghost btn-sm" id="probeBtn">Run Probe</button>
          </div>
          <div class="panel-body" id="protocolHealth"><div class="panel-empty">Click "Run Probe" to test all protocol endpoints</div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> Active Connections</span></div>
          <div class="panel-body" id="activeSessions"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title"><?= icon('log') ?> Inbound Ports</span>
          <span class="panel-sub" id="inboundTs"></span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Protocol</th><th>Port</th><th>Status</th><th>Accepted</th><th>UUID Rejections</th><th>Last IP</th><th>Last Accept</th></tr></thead>
            <tbody id="inboundTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
        <div id="inboundErrors" style="padding:.5rem 1rem;display:none"></div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> Top SNI Performance</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Protocol / SNI</th><th>Success Rate</th><th>Total</th><th>Avg Latency</th><th>Devices</th></tr></thead>
            <tbody id="sniLeaderboard"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: IRAN DEBUG                                             -->
    <!-- ============================================================ -->
    <div data-view="iran" hidden>
      <div class="two-col" style="margin-bottom:1.25rem">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Iran Compatibility Score</span></div>
          <div class="panel-body">
            <div style="display:flex;align-items:flex-start;gap:1rem">
              <div class="iran-grade grade-A" id="iranGrade">?</div>
              <div style="flex:1">
                <div style="font-size:.85rem;font-weight:700;margin-bottom:.5rem">Score: <span id="iranScore">—</span>/100</div>
                <ul class="checklist" id="iranChecklist"></ul>
              </div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Iran Traffic Summary</span></div>
          <div class="panel-body" id="iranStatsSummary"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">SNI Analysis — Iran</span>
          <span class="panel-sub">grouped by protocol + SNI, Iran/Iranian ISP traffic only</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Protocol</th><th>SNI</th><th>Success Rate</th><th>Total</th><th>TCP Only</th><th>No Internet</th><th>IPv6</th><th>Emergency</th><th>Avg Latency</th><th>Last Seen</th></tr></thead>
            <tbody id="iranSniTbl"><tr><td colspan="10" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">ISP Breakdown</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>ISP / Network</th><th>Total</th><th>Success</th><th>No Internet</th><th>Avg Latency</th></tr></thead>
              <tbody id="iranIspTbl"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">No-Internet Analysis</span><span class="panel-sub">TCP connected but no routing</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Protocol / SNI</th><th>Android</th><th>Total</th><th>No-Internet</th><th>Probe OK</th></tr></thead>
              <tbody id="noInternetTbl"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Error Classification — Recent Iran Failures</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Category</th><th>Protocol</th><th>SNI</th><th>Device</th><th>Network</th><th>Time</th><th>Error</th></tr></thead>
            <tbody id="iranErrorTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Error Pattern Frequency</span><span class="panel-sub">most common failure messages</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Count</th><th>Category</th><th>Protocol / SNI</th><th>Error Message</th><th>Last Seen</th></tr></thead>
            <tbody id="iranPatternTbl"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: DEVICES                                                -->
    <!-- ============================================================ -->
    <div data-view="devices" hidden>
      <div class="dev-stat-grid" id="devStats">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value" id="devTotal">—</div></div>
        <div class="stat-card stat-ok"><div class="stat-label">Online</div><div class="stat-value" id="devOnline">—</div></div>
        <div class="stat-card"><div class="stat-label">Free</div><div class="stat-value" id="devFree">—</div></div>
        <div class="stat-card stat-accent"><div class="stat-label">Premium</div><div class="stat-value" id="devPremium">—</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">Blocked</div><div class="stat-value" id="devBlocked">—</div></div>
      </div>
      <div class="search-row">
        <input class="input" id="devSearch" placeholder="Search device ID, country, version…" type="search">
        <select class="select" id="devPlan" style="width:130px">
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
        </select>
        <select class="select" id="devStatus" style="width:130px">
          <option value="">All status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="blocked">Blocked</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="devRefreshBtn"><?= icon('refresh') ?></button>
      </div>
      <div class="panel">
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Device</th><th>Plan</th><th>Quota</th><th>Status</th><th>Protocol</th><th class="mobile-hide">App Ver</th><th class="mobile-hide">Country</th><th class="mobile-hide">Last Seen</th><th>Actions</th></tr></thead>
            <tbody id="devTbl"><tr><td colspan="9" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Payment Queue</span>
          <select class="select btn-sm" id="payFilter" style="width:120px">
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>ID</th><th>Device</th><th>Package</th><th>USDT</th><th>Tx Hash</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
            <tbody id="payTbl"><tr><td colspan="8" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: LOGS                                                   -->
    <!-- ============================================================ -->
    <div data-view="logs" hidden>
      <div class="filter-row">
        <select class="select" id="logType" style="width:140px">
          <option value="access">Xray Access</option>
          <option value="error">Xray Error</option>
          <option value="nginx">Nginx Access</option>
          <option value="watchdog">Watchdog</option>
        </select>
        <select class="select" id="logLines" style="width:100px">
          <option value="50">50 lines</option>
          <option value="100" selected>100 lines</option>
          <option value="200">200 lines</option>
          <option value="500">500 lines</option>
        </select>
        <input class="input" id="logSearch" placeholder="Filter lines…" type="search" style="flex:1">
        <button class="btn btn-secondary btn-sm" id="logRefreshBtn"><?= icon('refresh') ?> Refresh</button>
        <button class="btn btn-ghost btn-sm" id="logExportBtn"><?= icon('download') ?> Export</button>
      </div>
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Log Output</span>
          <span class="panel-sub" id="logCount"></span>
          <label style="margin-left:auto;display:flex;align-items:center;gap:.35rem;font-size:.72rem;color:var(--muted);cursor:pointer">
            <input type="checkbox" id="logRawToggle" style="accent-color:var(--accent)"> Raw
          </label>
        </div>
        <div id="logViewer" style="padding:.25rem .5rem;max-height:70vh;overflow-y:auto;font-size:.72rem">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: RELEASE                                                -->
    <!-- ============================================================ -->
    <div data-view="release" hidden>
      <div class="panel" style="margin-bottom:1.25rem">
        <div class="panel-header"><span class="panel-title">Download Symlink</span></div>
        <div class="panel-body" id="dlSymlinkInfo"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="panel" style="margin-bottom:1.25rem">
        <div class="panel-header"><span class="panel-title">OTA version.json</span></div>
        <div class="panel-body" id="versionJsonInfo"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div id="releaseChannels"></div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">System Health</span></div>
        <div class="panel-body" id="debugStatus"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: CONFIG                                                 -->
    <!-- ============================================================ -->
    <div data-view="config" hidden>
      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Server Settings</span></div>
          <div class="panel-body">
            <div class="form-group">
              <label>Server Label</label>
              <input class="input" id="cfgLabel" placeholder="SetaLink VPN">
            </div>
            <div class="form-group">
              <label>Telegram Support URL</label>
              <input class="input" id="cfgTelegram" placeholder="https://t.me/…">
            </div>
            <button class="btn btn-primary" id="cfgSaveSettings"><?= icon('save') ?> Save Settings</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Remote Config</span><span class="panel-sub">pushed to mobile clients</span></div>
          <div class="panel-body">
            <div class="form-group">
              <label>Protocol Order</label>
              <div class="tag-list" id="rcProtocolOrder"></div>
            </div>
            <div class="form-group">
              <label>SNI Priorities (Iran)</label>
              <div class="tag-list" id="rcSniPriorities"></div>
              <div style="display:flex;gap:.35rem;margin-top:.4rem">
                <input class="input input-sm" id="rcSniInput" placeholder="Add SNI…" style="flex:1;padding:.3rem .5rem;font-size:.75rem">
                <button class="btn btn-ghost btn-sm" id="rcSniAdd"><?= icon('plus') ?></button>
              </div>
            </div>
            <div class="form-group">
              <label>Emergency SNI</label>
              <input class="input" id="rcEmergencySni" placeholder="www.microsoft.com">
            </div>
            <div class="form-group">
              <label>Kill Switches (blocked SNIs)</label>
              <div class="tag-list" id="rcKillSwitches"></div>
              <div style="display:flex;gap:.35rem;margin-top:.4rem">
                <input class="input input-sm" id="rcKsInput" placeholder="Add kill switch…" style="flex:1;padding:.3rem .5rem;font-size:.75rem">
                <button class="btn btn-ghost btn-sm" id="rcKsAdd"><?= icon('plus') ?></button>
              </div>
            </div>
            <button class="btn btn-primary" id="cfgSaveRc"><?= icon('save') ?> Save Remote Config</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Bootstrap Server</span><span class="panel-sub">emergency profile used by app on first launch</span></div>
        <div class="panel-body">
          <div class="bootstrap-grid">
            <div class="form-group"><label>UUID</label><input class="input" id="bsUuid"></div>
            <div class="form-group"><label>Address</label><input class="input" id="bsAddress"></div>
            <div class="form-group"><label>Port</label><input class="input" id="bsPort" type="number" min="1" max="65535"></div>
            <div class="form-group"><label>Public Key</label><input class="input" id="bsPubkey"></div>
            <div class="form-group"><label>Short ID</label><input class="input" id="bsShortid"></div>
            <div class="form-group"><label>SNI</label><input class="input" id="bsSni"></div>
            <div class="form-group"><label>Flow</label><input class="input" id="bsFlow" placeholder="xtls-rprx-vision"></div>
            <div class="form-group"><label>Fingerprint</label><input class="input" id="bsFp" placeholder="chrome"></div>
            <div class="form-group"><label>Edge Address</label><input class="input" id="bsEdgeAddr"></div>
            <div class="form-group"><label>Edge Port</label><input class="input" id="bsEdgePort" type="number"></div>
            <div class="form-group"><label>/ws path</label><input class="input" id="bsWsPath" value="/ws"></div>
            <div class="form-group"><label>/xhttp path</label><input class="input" id="bsXhttpPath" value="/xhttp"></div>
          </div>
          <div style="display:flex;gap:.5rem;margin-top:.25rem">
            <button class="btn btn-primary" id="cfgSaveBootstrap"><?= icon('save') ?> Save Bootstrap</button>
            <button class="btn btn-ghost btn-sm" id="cfgTestBootstrap"><?= icon('check') ?> Test Endpoint</button>
          </div>
          <div id="bsTestResult" style="margin-top:.5rem;font-size:.75rem;color:var(--muted)"></div>
        </div>
      </div>
    </div>

  </div><!-- /page-content -->
</main>
</div><!-- /layout -->

<!-- ── Modals ────────────────────────────────────────────────────────── -->
<div class="modal-backdrop" id="backdrop"></div>

<div class="modal-dialog" id="modalQuota">
  <div class="modal-header">
    <span class="modal-title">Set Quota</span>
    <button class="btn-close btn btn-icon" onclick="closeModal()"><?= icon('x') ?></button>
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label>Device: <strong id="quotaDevLabel"></strong></label>
    </div>
    <div class="form-group">
      <label>Quota (GB)</label>
      <input class="input" id="quotaGb" type="number" min="0" step="0.5" value="1">
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="quotaConfirm"><?= icon('save') ?> Set Quota</button>
  </div>
</div>

<div class="modal-dialog" id="modalConfirm">
  <div class="modal-header">
    <span class="modal-title" id="confirmTitle">Confirm</span>
    <button class="btn-close btn btn-icon" onclick="closeModal()"><?= icon('x') ?></button>
  </div>
  <div class="modal-body"><p id="confirmMsg" style="font-size:.83rem"></p></div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" id="confirmOk">Confirm</button>
  </div>
</div>

<!-- ── Toast container ───────────────────────────────────────────────── -->
<div id="toast-container"></div>

<!-- ── Script ────────────────────────────────────────────────────────── -->
<script>
'use strict';
const CSRF     = <?= json_encode($csrf_token) ?>;
const API      = '/_setalink-admin/api.php';
const INIT_PAGE = <?= json_encode($page) ?>;

// ── Utils ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtBytes = n => {
  if (!n) return '—';
  const u=['B','KB','MB','GB','TB'], i=Math.min(Math.floor(Math.log2(n)/10),4);
  return (n/Math.pow(1024,i)).toFixed(i>1?1:0)+' '+u[i];
};
const fmtNum = n => n==null?'—':Number(n).toLocaleString();
const fmtRelative = s => {
  if (!s) return '—';
  const d = (Date.now()/1000) - new Date(s.replace(' ','T')+'Z').getTime()/1000;
  if (isNaN(d)||d<0) return 'just now';
  if (d<60) return d.toFixed(0)+'s ago';
  if (d<3600) return (d/60).toFixed(0)+'m ago';
  if (d<86400) return (d/3600).toFixed(0)+'h ago';
  return (d/86400).toFixed(0)+'d ago';
};
const fmtMs = ms => ms ? ms+'ms' : '—';
const pct   = (s,t) => t>0 ? Math.round(s/t*100)+'%' : '—';

// Error classifier
function classifyError(row) {
  const msg = ((row.error_msg||row.error||'')).toLowerCase();
  const tcp = +row.tcp_ok, http = +row.http_ok, ipv6 = +row.ipv6_enabled;
  if (msg.includes('eperm')||msg.includes('operation not permitted')||msg.includes('bindsocket'))
    return {type:'android',  label:'Android VPN',       css:'err-android'};
  if (msg.includes('connection reset')||msg.includes('forcibly closed')||msg.includes('connection refused by the proxy')||msg.includes('dpi'))
    return {type:'dpi',      label:'DPI Blocked',        css:'err-dpi'};
  if (msg.includes('nxdomain')||msg.includes('no such host')||(msg.includes('dns')&&msg.includes('fail')))
    return {type:'dns',      label:'DNS Poisoned',       css:'err-dns'};
  if (msg.includes('tls')||msg.includes('certificate')||msg.includes('handshake'))
    return {type:'tls',      label:'TLS Failed',         css:'err-tls'};
  if (msg.includes('alpn'))
    return {type:'alpn',     label:'ALPN Mismatch',      css:'err-alpn'};
  if (msg.includes('mtu')||msg.includes('too large')||msg.includes('emsgsize'))
    return {type:'mtu',      label:'MTU Issue',          css:'err-mtu'};
  if (msg.includes('captive')||msg.includes('portal'))
    return {type:'captive',  label:'Captive Portal',     css:'err-captive'};
  if (tcp&&!http&&!msg)
    return {type:'tcponly',  label:'TCP Only',           css:'err-tcponly'};
  if (ipv6&&!http&&(msg.includes('route')||msg.includes('unreachable')))
    return {type:'ipv6',     label:'IPv6 Routing',       css:'err-ipv6'};
  if (msg.includes('timeout')||msg.includes('deadline')||msg.includes('i/o timeout'))
    return {type:'timeout',  label:'Timeout',            css:'err-timeout'};
  if (!msg&&!tcp)
    return {type:'unknown',  label:'Unknown',            css:'err-unknown'};
  return      {type:'unknown',  label:'Unknown',            css:'err-unknown'};
}
function classHint(cat) {
  const hints = {
    dpi:     'Deep Packet Inspection — ISP is fingerprinting TLS handshakes. Try a different SNI or fingerprint.',
    dns:     'DNS response is being poisoned. Switch to DoH or a trusted DNS resolver.',
    tls:     'TLS handshake failure. Check certificate validity, SNI mismatch, or fingerprint.',
    alpn:    'ALPN negotiation failed. Ensure xray config uses alpn:[http/1.1] for WS/HTTPUpgrade.',
    tcponly: 'TCP connects but no HTTP routing. Check tun2socks, TUN interface, and Xray outbounds.',
    ipv6:    'IPv6 routing issue. Xray blackhole rule for ::/0 may be missing.',
    mtu:     'Packet size exceeds path MTU. Try reducing MTU to 1280 on device.',
    captive: 'Captive portal intercept. Must dismiss portal before VPN can connect.',
    android: 'Android VPN permission issue (EPERM). bindSocket excluded — this is expected behaviour, not fatal.',
    timeout: 'Connection timed out. Server unreachable or filtered.',
    unknown: 'Cause unclear. Check Xray error log for more detail.',
  };
  return hints[cat] || hints.unknown;
}

function protoBadge(p) {
  const proto = (p||'').toLowerCase();
  if (proto.includes('reality')) return `<span class="badge proto-reality">Reality</span>`;
  if (proto.includes('xhttp'))   return `<span class="badge proto-xhttp">XHTTP</span>`;
  if (proto.includes('httpupgrade')||proto.includes('httpup')) return `<span class="badge proto-httpupgrade">HTTPUp</span>`;
  if (proto.includes('ws')||proto.includes('websocket')) return `<span class="badge proto-ws">WS</span>`;
  return proto ? `<span class="badge badge-muted">${esc(p)}</span>` : '—';
}

// ── API client ───────────────────────────────────────────────────────
const api = {
  get: async (action, params={}) => {
    const qs = new URLSearchParams({action, ...params});
    const r  = await fetch(`${API}?${qs}`, {credentials:'include'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'API error');
    return d.data;
  },
  post: async body => {
    const r = await fetch(API, {method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({_csrf:CSRF, ...body})
    });
    if (!r.ok) throw new Error('HTTP '+r.status);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error||'API error');
    return d.data;
  }
};

// ── Toast ────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(()=>el.remove(), 4200);
}

// ── Modal ────────────────────────────────────────────────────────────
function openModal(id) { $('backdrop').classList.add('open'); $(id).classList.add('open'); }
function closeModal()  {
  $('backdrop').classList.remove('open');
  document.querySelectorAll('.modal-dialog.open').forEach(m=>m.classList.remove('open'));
}
$('backdrop').addEventListener('click', closeModal);

// ── Sidebar mobile toggle ────────────────────────────────────────────
function openSidebar()  {
  $('sidebar').classList.add('open');
  $('sidebarOverlay').classList.add('open');
  document.body.style.overflow = 'hidden'; // prevent scroll behind drawer
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
$('menuToggle').addEventListener('click', ()=>
  $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar()
);
$('sidebarOverlay').addEventListener('click', closeSidebar);

// ── Router ───────────────────────────────────────────────────────────
let activeView='', refreshTimer=null;
const pageTitles = {
  dashboard: ['Dashboard', 'live monitoring · auto-refresh 10s'],
  iran:      ['Iran Debug', 'censorship diagnostics · Iranian ISP analysis'],
  devices:   ['Devices', 'device management · quota · payments'],
  logs:      ['Logs', 'structured log viewer'],
  release:   ['Release', 'APK channels · version.json · health'],
  config:    ['Config', 'remote config · bootstrap server · settings'],
};

function navigate(page) {
  if (!pageTitles[page]) page = 'dashboard';
  closeSidebar(); // close mobile drawer on every navigation
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.page===page));
  document.querySelectorAll('[data-view]').forEach(el=>{ el.hidden = el.dataset.view!==page; });
  const [title, sub] = pageTitles[page];
  $('pageTitle').textContent = title;
  $('pageSub').textContent = sub;
  document.title = `SetaLink Admin — ${title}`;
  const url = new URL(location.href);
  url.searchParams.set('page', page);
  history.pushState({page}, '', url);
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer=null; }
  activeView = page;
  views[page]?.init();
}
window.addEventListener('popstate', e => navigate(e.state?.page||'dashboard'));
document.querySelectorAll('.nav-item[data-page]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));
$('refreshBtn').addEventListener('click', ()=>views[activeView]?.init?.());

// ── Heartbeat (all pages) ────────────────────────────────────────────
async function runHeartbeat() {
  const setDot = (id, ok) => {
    const el = $(id); if (!el) return;
    el.className = 'dot '+(ok===true?'dot-ok':ok===false?'dot-bad':'dot-unk');
  };
  try {
    const d = await api.get('heartbeat');
    setDot('hbXray',  d.xray);
    setDot('hbNginx', d.nginx);
    setDot('hbSqlite',d.sqlite);
    setDot('hbApi',   d.api);
    setDot('hbPort',  d.port_8443);
    const bsEl = $('hbBootstrap');
    if (bsEl && d.bootstrap && typeof d.bootstrap === 'object') {
      const bs = d.bootstrap;
      bsEl.className = 'dot ' + (bs.ok && bs.configured ? 'dot-ok' : bs.ok ? 'dot-unk' : 'dot-bad');
      bsEl.title = bs.ok
        ? (bs.configured ? 'Bootstrap: configured · ' : 'Bootstrap: hardcoded fallback · ') + bs.address + ' · ' + d.checked_at
        : 'Bootstrap: DB read failed · ' + d.checked_at;
    }
    $('hbTs').textContent = 'updated ' + new Date().toLocaleTimeString();
    $('globalTs').textContent = new Date().toLocaleTimeString();
  } catch(e) {
    $('hbTs').textContent = 'heartbeat failed: ' + e.message;
  }
}
runHeartbeat();
setInterval(runHeartbeat, 30000);

// ── VIEW: DASHBOARD ──────────────────────────────────────────────────
const views = {};
views.dashboard = {
  init() {
    this.loadAll();
    refreshTimer = setInterval(()=>this.loadAll(), 10000);
  },
  async loadAll() {
    const [analytics, sessions, inbounds, sniLb] = await Promise.allSettled([
      api.get('app-analytics'),
      api.get('active-sessions'),
      api.get('inbound-stats'),
      api.get('sni-leaderboard'),
    ]);
    if (analytics.status==='fulfilled') this.renderStats(analytics.value);
    if (sessions.status==='fulfilled')  this.renderSessions(sessions.value);
    if (inbounds.status==='fulfilled')  this.renderInbounds(inbounds.value);
    if (sniLb.status==='fulfilled')     this.renderSniLb(sniLb.value);
  },
  renderStats(d) {
    $('statOnline').textContent   = fmtNum(d.online_now);
    $('statTotal').textContent    = fmtNum(d.total_installs);
    $('statActive7d').textContent = fmtNum(d.active_7d);
    $('statActiveToday').textContent = fmtNum(d.active_today)+' today';
    $('statNew').textContent      = fmtNum(d.new_this_month)+' this month';
    $('statFailed').textContent   = fmtNum(d.failed_24h);
    $('statEvents').textContent   = fmtNum(d.online_now);
  },
  renderSessions(d) {
    const el = $('activeSessions');
    const protos = d.protocols||{};
    let html = `<div style="margin-bottom:.5rem;font-size:.83rem">
      <span style="font-weight:700;font-size:1.2rem">${esc(d.active_ips)}</span>
      <span style="color:var(--muted);margin-left:.35rem">unique IPs (5-min window)</span>
    </div>`;
    html += `<div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">${esc(d.recent_events)} events total</div>`;
    if (Object.keys(protos).length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:.3rem">';
      for (const [p,c] of Object.entries(protos)) {
        html += `<div style="font-size:.7rem;padding:.15rem .4rem;border-radius:4px;background:var(--bg-2);border:1px solid var(--border)">${esc(p)}: <strong>${c}</strong></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  },
  renderInbounds(d) {
    const ports = d.ports||{};
    let rows = '';
    for (const [k,p] of Object.entries(ports)) {
      const ok = p.listening;
      rows += `<tr>
        <td>${esc(p.label)}</td>
        <td class="mono">${p.port}</td>
        <td><span class="badge ${ok?'badge-ok':'badge-danger'}">${ok?'listening':'closed'}</span></td>
        <td>${k==='reality'?esc(d.accepted_external):'—'}</td>
        <td>${k==='reality'?esc(d.uuid_rejections):'—'}</td>
        <td class="mono">${k==='reality'?esc(d.last_accepted_ip||'—'):'—'}</td>
        <td>${k==='reality'?esc(d.last_accepted_at||'—'):'—'}</td>
      </tr>`;
    }
    $('inboundTbl').innerHTML = rows || '<tr><td colspan="7" class="tbl-empty">No data</td></tr>';
    $('inboundTs').textContent = d.checked_at||'';
    if (d.last_errors&&d.last_errors.length) {
      const errDiv = $('inboundErrors');
      errDiv.style.display = 'block';
      errDiv.innerHTML = '<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem;font-weight:600">RECENT XRAY ERRORS</div>' +
        d.last_errors.map(e=>`<div class="mono" style="font-size:.68rem;color:var(--danger);padding:.1rem 0">${esc(e)}</div>`).join('');
    }
  },
  renderSniLb(rows) {
    if (!rows||!rows.length) { $('sniLeaderboard').innerHTML='<tr><td colspan="5" class="tbl-empty">No telemetry data yet</td></tr>'; return; }
    $('sniLeaderboard').innerHTML = rows.slice(0,10).map(r=>{
      const rate = r.connect_rate!=null?r.connect_rate:null;
      const cls  = rate===null?'badge-muted':rate>=80?'badge-ok':rate>=50?'badge-warn':'badge-danger';
      return `<tr>
        <td>${protoBadge(r.protocol)}&nbsp;<span class="mono" style="font-size:.72rem">${esc(r.sni||'—')}</span></td>
        <td>
          <span class="badge ${cls}">${rate!=null?rate+'%':'—'}</span>
          <div class="progress" style="width:80px;margin-top:.3rem;display:inline-block;vertical-align:middle">
            <div class="progress-bar ${rate>=80?'ok':rate>=50?'warn':'danger'}" style="width:${rate||0}%"></div>
          </div>
        </td>
        <td>${fmtNum(r.total)}</td>
        <td>${fmtMs(r.avg_latency)}</td>
        <td>${fmtNum(r.devices)}</td>
      </tr>`;
    }).join('');
  }
};
// Protocol health probe button
$('probeBtn').addEventListener('click', async()=>{
  const el = $('protocolHealth');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Probing…</div>';
  try {
    const d = await api.get('protocol-health');
    el.innerHTML = Object.entries(d)
      .filter(([k])=>k!=='checked_at')
      .map(([k,v])=>`<div style="display:flex;align-items:center;gap:.6rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <span class="dot ${v.ok?'dot-ok':'dot-bad'}"></span>
        <span style="font-weight:600;font-size:.8rem;flex:1">${esc(v.name)}</span>
        <span class="badge ${v.ok?'badge-ok':'badge-danger'}">${v.ok?'OK':'FAIL'}</span>
        <span style="font-size:.7rem;color:var(--muted)">${esc(v.detail||'')}</span>
      </div>`).join('');
  } catch(e) { el.innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`; toast(e.message,'error'); }
});

// ── VIEW: IRAN DEBUG ─────────────────────────────────────────────────
views.iran = {
  async init() {
    this.loadScore();
    this.loadDebug();
    this.loadNoInternet();
  },
  async loadScore() {
    try {
      const d = await api.get('iran-score');
      const gc = d.grade==='A'?'A':d.grade==='B'?'B':d.grade==='C'?'C':'F';
      $('iranGrade').textContent = d.grade;
      $('iranGrade').className   = `iran-grade grade-${gc}`;
      $('iranScore').textContent = d.score;
      $('iranChecklist').innerHTML = (d.checks||[]).map(c=>`
        <li>
          <span class="${c.ok?'ci-ok':'ci-fail'}">${c.ok?'✓':'✗'}</span>
          <span style="flex:1">${esc(c.label)}</span>
          <span class="checklist-detail">${esc(c.detail)}</span>
        </li>`).join('');
    } catch(e) { toast('Iran score: '+e.message,'error'); }
  },
  async loadDebug() {
    try {
      const d = await api.get('iran-debug');
      this.renderStatsSummary(d.stats);
      this.renderSniTbl(d.sni_analysis||[]);
      this.renderIspTbl(d.isp_breakdown||[]);
      this.renderErrorTbl(d.errors||[]);
      this.renderPatternTbl(d.error_patterns||[]);
    } catch(e) {
      $('iranSniTbl').innerHTML = `<tr><td colspan="10" class="tbl-empty">${esc(e.message)}</td></tr>`;
      toast('Iran debug: '+e.message,'error');
    }
  },
  async loadNoInternet() {
    try {
      const rows = await api.get('no-internet-analysis');
      $('noInternetTbl').innerHTML = !rows.length
        ? '<tr><td colspan="5" class="tbl-empty">No data</td></tr>'
        : rows.map(r=>`<tr>
            <td>${protoBadge(r.protocol)}&nbsp;<span class="mono" style="font-size:.72rem">${esc(r.sni||'—')}</span></td>
            <td><span class="mono">${esc(r.android_version||'—')}</span></td>
            <td>${fmtNum(r.total)}</td>
            <td><span class="badge ${r.no_internet_cnt>0?'badge-warn':'badge-ok'}">${fmtNum(r.no_internet_cnt)}</span></td>
            <td>${fmtNum(r.probe_ok_cnt)}</td>
          </tr>`).join('');
    } catch(e) { $('noInternetTbl').innerHTML=`<tr><td colspan="5" class="tbl-empty">${esc(e.message)}</td></tr>`; }
  },
  renderStatsSummary(s) {
    if (!s) { $('iranStatsSummary').innerHTML='<div class="panel-empty">No Iran data yet. Stats appear once devices report from Iranian ISPs.</div>'; return; }
    const t=+s.total, succ=+s.success;
    const rate = t>0?Math.round(succ/t*100):0;
    $('iranStatsSummary').innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:.5rem">
        <div class="stat-card"><div class="stat-label">Total Reports</div><div class="stat-value">${fmtNum(t)}</div></div>
        <div class="stat-card ${rate>=60?'stat-ok':rate>=30?'stat-warn':'stat-danger'}">
          <div class="stat-label">Success Rate</div><div class="stat-value">${rate}%</div></div>
        <div class="stat-card"><div class="stat-label">No Internet</div><div class="stat-value">${fmtNum(s.no_internet)}</div></div>
        <div class="stat-card"><div class="stat-label">TCP Only</div><div class="stat-value">${fmtNum(s.tcp_only)}</div></div>
        <div class="stat-card"><div class="stat-label">Emergency Used</div><div class="stat-value">${fmtNum(s.emergency_used)}</div></div>
        <div class="stat-card"><div class="stat-label">Devices</div><div class="stat-value">${fmtNum(s.device_count)}</div></div>
      </div>
      <div style="font-size:.7rem;color:var(--muted-2);margin-top:.5rem">Last report: ${esc(s.last_seen||'—')}</div>`;
  },
  renderSniTbl(rows) {
    $('iranSniTbl').innerHTML = !rows.length
      ? '<tr><td colspan="10" class="tbl-empty">No Iran traffic recorded yet.</td></tr>'
      : rows.map(r=>{
          const rate = r.success_rate;
          const cls  = rate===null?'badge-muted':rate>=80?'badge-ok':rate>=40?'badge-warn':'badge-danger';
          return `<tr>
            <td>${protoBadge(r.protocol)}</td>
            <td class="mono" style="font-size:.72rem">${esc(r.sni||'—')}</td>
            <td><span class="badge ${cls}">${rate!=null?rate+'%':'—'}</span></td>
            <td>${fmtNum(r.total)}</td>
            <td>${fmtNum(r.tcp_only)}</td>
            <td><span class="${+r.no_internet>0?'badge badge-warn':''}">${fmtNum(r.no_internet)}</span></td>
            <td>${fmtNum(r.ipv6_attempts)}</td>
            <td>${fmtNum(r.emergency_used)}</td>
            <td>${fmtMs(r.avg_latency)}</td>
            <td style="color:var(--muted-2);font-size:.7rem">${fmtRelative(r.last_seen)}</td>
          </tr>`;
        }).join('');
  },
  renderIspTbl(rows) {
    $('iranIspTbl').innerHTML = !rows.length
      ? '<tr><td colspan="5" class="tbl-empty">No ISP data yet</td></tr>'
      : rows.map(r=>{
          const rate = +r.total>0?Math.round(+r.success/+r.total*100):null;
          return `<tr>
            <td style="font-weight:600">${esc(r.isp)}</td>
            <td>${fmtNum(r.total)}</td>
            <td><span class="badge ${rate>=60?'badge-ok':rate>=30?'badge-warn':'badge-danger'}">${rate!=null?rate+'%':'—'}</span></td>
            <td>${fmtNum(r.no_internet)}</td>
            <td>${fmtMs(r.avg_latency)}</td>
          </tr>`;
        }).join('');
  },
  renderErrorTbl(rows) {
    $('iranErrorTbl').innerHTML = !rows.length
      ? '<tr><td colspan="7" class="tbl-empty">No errors recorded for Iran traffic</td></tr>'
      : rows.map(r=>{
          const cat = classifyError(r);
          return `<tr>
            <td><span class="badge ${cat.css}" title="${esc(classHint(cat.type))}">${esc(cat.label)}</span></td>
            <td>${protoBadge(r.protocol)}</td>
            <td class="mono" style="font-size:.7rem">${esc(r.sni||'—')}</td>
            <td class="mono mobile-hide" style="font-size:.68rem">${esc(r.device_model||'—')}</td>
            <td class="mobile-hide">${esc(r.network||'—')}</td>
            <td style="color:var(--muted-2);font-size:.7rem">${fmtRelative(r.recorded_at)}</td>
            <td style="max-width:200px">
              <span style="font-size:.68rem;color:var(--muted);word-break:break-all">${esc((r.error_msg||'').substring(0,80))}</span>
              ${r.error_msg&&r.error_msg.length>80?`<button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('shown');this.textContent=this.textContent==='…'?'↑':'…'">…</button><pre class="raw-detail">${esc(r.error_msg)}</pre>`:'' }
            </td>
          </tr>`;
        }).join('');
  },
  renderPatternTbl(rows) {
    $('iranPatternTbl').innerHTML = !rows.length
      ? '<tr><td colspan="5" class="tbl-empty">No pattern data yet</td></tr>'
      : rows.map(r=>{
          const cat = classifyError({error_msg:r.error_msg});
          return `<tr>
            <td><strong>${fmtNum(r.cnt)}</strong></td>
            <td><span class="badge ${cat.css}" title="${esc(classHint(cat.type))}">${esc(cat.label)}</span></td>
            <td>${protoBadge(r.protocol)}&nbsp;<span class="mono" style="font-size:.7rem">${esc(r.sni||'—')}</span></td>
            <td style="max-width:300px;font-size:.7rem;word-break:break-all;color:var(--muted)">${esc((r.error_msg||'').substring(0,120))}</td>
            <td style="color:var(--muted-2);font-size:.7rem;white-space:nowrap">${fmtRelative(r.last_seen)}</td>
          </tr>`;
        }).join('');
  }
};

// ── VIEW: DEVICES ────────────────────────────────────────────────────
views.devices = {
  devData: [],
  quotaDevId: '',
  blockDevId: '',
  blockAction: '',
  async init() {
    this.loadDevices();
    this.loadPayments();
    // Wire controls
    $('devSearch').oninput = debounce(()=>this.renderDevices(), 250);
    $('devPlan').onchange = ()=>this.renderDevices();
    $('devStatus').onchange = ()=>this.renderDevices();
    $('devRefreshBtn').onclick = ()=>{ this.loadDevices(); this.loadPayments(); };
    $('payFilter').onchange = ()=>this.loadPayments();
  },
  async loadDevices() {
    try {
      const rows = await api.get('devices-list');
      this.devData = rows;
      const online  = rows.filter(r=>r.status==='online').length;
      const free    = rows.filter(r=>r.plan==='free').length;
      const premium = rows.filter(r=>r.plan==='premium').length;
      const blocked = rows.filter(r=>r.blocked).length;
      $('devTotal').textContent   = rows.length;
      $('devOnline').textContent  = online;
      $('devFree').textContent    = free;
      $('devPremium').textContent = premium;
      $('devBlocked').textContent = blocked;
      this.renderDevices();
    } catch(e) { toast('Devices: '+e.message,'error'); }
  },
  renderDevices() {
    const q     = ($('devSearch').value||'').toLowerCase();
    const plan  = $('devPlan').value;
    const status= $('devStatus').value;
    let rows = this.devData;
    if (q)              rows = rows.filter(r=>(r.device_id_short+r.country+r.app_version+r.device_id).toLowerCase().includes(q));
    if (plan)           rows = rows.filter(r=>r.plan===plan);
    if (status==='online')  rows = rows.filter(r=>r.status==='online');
    if (status==='offline') rows = rows.filter(r=>r.status!=='online');
    if (status==='blocked') rows = rows.filter(r=>r.blocked);
    $('devTbl').innerHTML = !rows.length
      ? '<tr><td colspan="9" class="tbl-empty">No devices match filter</td></tr>'
      : rows.map(r=>{
          const usedPct = r.quota_bytes_total>0?Math.round(r.quota_bytes_used/r.quota_bytes_total*100):0;
          return `<tr>
            <td>
              <span class="mono" style="font-size:.72rem;color:var(--text)">${esc(r.device_id_short)}</span>
              ${r.blocked?'<span class="badge badge-danger" style="margin-left:.3rem">blocked</span>':''}
            </td>
            <td><span class="badge ${r.plan==='premium'?'badge-accent':'badge-muted'}">${esc(r.plan)}</span></td>
            <td>
              <div style="font-size:.7rem;margin-bottom:.2rem">${fmtBytes(r.quota_bytes_used)} / ${fmtBytes(r.quota_bytes_total)}</div>
              <div class="progress" style="width:80px"><div class="progress-bar ${usedPct>90?'danger':usedPct>70?'warn':'ok'}" style="width:${usedPct}%"></div></div>
            </td>
            <td><span class="dot ${r.status==='online'?'dot-ok':'dot-unk'}" style="display:inline-block"></span> ${esc(r.status)}</td>
            <td>${protoBadge(r.active_protocol)}</td>
            <td class="mobile-hide mono" style="font-size:.7rem">${esc(r.app_version||'—')}</td>
            <td class="mobile-hide" style="font-size:.75rem">${esc(r.country||'—')}</td>
            <td class="mobile-hide" style="font-size:.72rem;color:var(--muted-2)">${fmtRelative(r.last_seen)}</td>
            <td>
              <div style="display:flex;gap:.25rem">
                <button class="btn btn-ghost btn-sm" title="${r.blocked?'Unblock':'Block'}"
                  onclick="devBlock('${esc(r.device_id)}','${r.blocked?'unblock':'block'}')"
                  style="color:${r.blocked?'var(--ok)':'var(--warn)'}">
                  ${r.blocked?'Unblock':'Block'}
                </button>
                <button class="btn btn-ghost btn-sm" title="Set Quota"
                  onclick="devSetQuota('${esc(r.device_id)}','${esc(r.device_id_short)}')">Quota</button>
              </div>
            </td>
          </tr>`;
        }).join('');
  },
  async loadPayments() {
    const sf = $('payFilter').value;
    try {
      const d = await api.get('payment-queue', {status:sf});
      const rows = d.payments||[];
      $('payTbl').innerHTML = !rows.length
        ? '<tr><td colspan="8" class="tbl-empty">No payments</td></tr>'
        : rows.map(r=>`<tr>
            <td>${r.id}</td>
            <td class="mono" style="font-size:.7rem">${esc((r.device_id||'').substring(0,16)+'…')}</td>
            <td><span class="badge badge-info">${esc(r.package)}</span></td>
            <td>${r.amount_usdt||'—'} USDT</td>
            <td class="mono mobile-hide" style="font-size:.68rem">${esc((r.tx_hash||'—').substring(0,16)+'…')}</td>
            <td><span class="badge ${r.status==='approved'?'badge-ok':r.status==='rejected'?'badge-danger':'badge-warn'}">${esc(r.status)}</span></td>
            <td class="mobile-hide" style="font-size:.72rem;color:var(--muted-2)">${fmtRelative(r.submitted_at)}</td>
            <td>
              ${r.status==='pending'?`
                <button class="btn btn-sm btn-primary" onclick="payReview(${r.id},'approve')">Approve</button>
                <button class="btn btn-sm btn-danger"  onclick="payReview(${r.id},'reject')">Reject</button>`
              : '—'}
            </td>
          </tr>`).join('');
    } catch(e) { toast('Payments: '+e.message,'error'); }
  }
};
// Expose device actions globally
window.devBlock = async function(did, action) {
  $('confirmTitle').textContent = action==='block'?'Block Device':'Unblock Device';
  $('confirmMsg').textContent   = `${action==='block'?'Block':'Unblock'} device ${did.substring(0,16)}…? This immediately ${action==='block'?'cuts':'restores'} VPN access.`;
  openModal('modalConfirm');
  $('confirmOk').onclick = async()=>{
    closeModal();
    try {
      await api.post({action:'device-'+action, device_id:did});
      toast(`Device ${action}ed`,'ok');
      views.devices.loadDevices();
    } catch(e) { toast(e.message,'error'); }
  };
};
window.devSetQuota = function(did, short) {
  views.devices.quotaDevId = did;
  $('quotaDevLabel').textContent = short;
  const dev = views.devices.devData.find(d=>d.device_id===did);
  $('quotaGb').value = dev ? (dev.quota_bytes_total/1073741824).toFixed(1) : 1;
  openModal('modalQuota');
};
$('quotaConfirm').onclick = async()=>{
  const did   = views.devices.quotaDevId;
  const bytes = Math.round(parseFloat($('quotaGb').value)*1073741824);
  closeModal();
  try {
    await api.post({action:'device-set-quota', device_id:did, quota_bytes:bytes});
    toast('Quota updated','ok');
    views.devices.loadDevices();
  } catch(e) { toast(e.message,'error'); }
};
window.payReview = async function(pid, action) {
  try {
    await api.post({action:'payment-'+action, payment_id:pid});
    toast(`Payment ${action}d`,'ok');
    views.devices.loadPayments();
  } catch(e) { toast(e.message,'error'); }
};

// ── VIEW: LOGS ───────────────────────────────────────────────────────
views.logs = {
  rawLines: [],
  async init() {
    this.load();
    $('logRefreshBtn').onclick = ()=>this.load();
    $('logSearch').oninput = debounce(()=>this.render(), 250);
    $('logRawToggle').onchange = ()=>this.render();
    $('logExportBtn').onclick = ()=>this.export();
  },
  async load() {
    const type  = $('logType').value;
    const lines = $('logLines').value;
    $('logViewer').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
    try {
      const rows = await api.get('logs', {type, n:lines});
      this.rawLines = Array.isArray(rows) ? rows : [];
      this.render();
    } catch(e) {
      $('logViewer').innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`;
      toast('Logs: '+e.message,'error');
    }
  },
  render() {
    const q    = ($('logSearch').value||'').toLowerCase();
    const raw  = $('logRawToggle').checked;
    let rows = this.rawLines;
    if (q) rows = rows.filter(l=>(typeof l==='string'?l:JSON.stringify(l)).toLowerCase().includes(q));
    $('logCount').textContent = rows.length + ' lines';
    if (!rows.length) { $('logViewer').innerHTML='<div class="panel-empty">No matching log lines.</div>'; return; }
    $('logViewer').innerHTML = rows.map(l=>{
      const line = typeof l==='string'?l:JSON.stringify(l);
      const sev  = /\[Error\]|\berror\b/i.test(line)?'err':/\[Warning\]|\bwarn(ing)?\b/i.test(line)?'warn':'info';
      const ts   = (line.match(/^\d{4}[\/\-]\d{2}[\/\-]\d{2} \d{2}:\d{2}:\d{2}/) || [])[0] || '';
      const body = ts ? line.substring(ts.length).trim() : line;
      return `<div class="log-line">
        ${ts?`<span class="log-ts">${esc(ts)}</span>`:''}
        ${sev!=='info'?`<span class="log-sev sev-${sev}">${sev.toUpperCase()}</span>`:''}
        <span class="log-body">${esc(body.substring(0,400))}</span>
        ${body.length>400?`<button class="expand-btn" onclick="this.nextSibling.classList.toggle('shown');this.textContent=this.textContent==='…'?'↑':'…'">…</button><pre class="raw-detail">${esc(body)}</pre>`:''}
      </div>`;
    }).join('');
  },
  export() {
    const type = $('logType').value;
    const blob = new Blob([this.rawLines.map(l=>typeof l==='string'?l:JSON.stringify(l)).join('\n')], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setalink-${type}-${new Date().toISOString().slice(0,10)}.log`;
    a.click(); URL.revokeObjectURL(a.href);
  }
};
$('logType').onchange   = ()=>views.logs.load?.();
$('logLines').onchange  = ()=>views.logs.load?.();

// ── VIEW: RELEASE ────────────────────────────────────────────────────
views.release = {
  async init() {
    const [rel, ds] = await Promise.allSettled([api.get('release-status'), api.get('debug-status')]);
    if (rel.status==='fulfilled') this.renderRelease(rel.value);
    else $('releaseChannels').innerHTML = `<div class="panel-empty">${esc(rel.reason?.message)}</div>`;
    if (ds.status==='fulfilled')  this.renderDebugStatus(ds.value);
    else $('debugStatus').innerHTML = `<div class="panel-empty">${esc(ds.reason?.message)}</div>`;
  },
  renderRelease(d) {
    // Download symlink
    const dl  = d.download_symlink||{};
    $('dlSymlinkInfo').innerHTML = `
      <div style="display:flex;align-items:center;gap:.75rem;font-size:.8rem">
        <span class="dot ${dl.valid?'dot-ok':'dot-bad'}"></span>
        <span class="mono">/public/download/setalink-latest.apk</span>
        <span style="color:var(--muted)">→</span>
        <span class="mono">${esc(dl.target||'(not set)')}</span>
        <span class="badge ${dl.valid?'badge-ok':'badge-danger'}">${dl.valid?'valid':'BROKEN'}</span>
      </div>`;

    // version.json
    const vj = d.version_json;
    $('versionJsonInfo').innerHTML = vj ? `
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:.8rem">
        <div><span style="color:var(--muted)">version</span> <strong>${esc(vj.version||'—')}</strong></div>
        <div><span style="color:var(--muted)">build</span> <strong>${esc(String(vj.versionCode||'—'))}</strong></div>
        <div><span style="color:var(--muted)">channel</span> <strong>${esc(vj.rolloutChannel||'—')}</strong></div>
        <div><span style="color:var(--muted)">date</span> <strong>${esc(vj.releaseDate||'—')}</strong></div>
        <div><span style="color:var(--muted)">force update</span> <strong>${vj.forceUpdate?'yes':'no'}</strong></div>
      </div>
      ${vj.apkSha256?`<div class="mono" style="font-size:.68rem;color:var(--muted-2);margin-top:.4rem">sha256: ${esc(vj.apkSha256)}</div>`:''}
      ${vj.changelog?`<ul style="margin-top:.5rem;font-size:.75rem;color:var(--muted);padding-left:1.25rem">${(vj.changelog||[]).map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:''}
    ` : '<div class="panel-empty">version.json not found</div>';

    // Channels
    const html = ['stable','beta','hotfix'].map(ch=>{
      const info = (d.channels||{})[ch]||{};
      const apks = info.apks||[];
      const sym  = info.latest_symlink;
      const symOk= info.symlink_valid;
      return `<div class="release-channel">
        <div class="channel-header">
          <span class="badge ${ch==='stable'?'badge-ok':ch==='beta'?'badge-warn':'badge-info'}">${ch}</span>
          <span class="channel-name" style="margin-left:.25rem">${apks.length} APK${apks.length!==1?'s':''}</span>
          ${sym?`<span class="badge ${symOk?'badge-ok':'badge-danger'}" style="margin-left:auto">latest → ${esc(sym)}</span>`:'<span class="badge badge-muted" style="margin-left:auto">no symlink</span>'}
        </div>
        ${!apks.length?'<div style="font-size:.75rem;color:var(--muted)">No APKs in this channel</div>':
          apks.map(a=>`<div class="apk-row">
            <span class="apk-name">${esc(a.name)}</span>
            <span class="apk-size">${fmtBytes(a.size)}</span>
            <span class="apk-date">${esc(a.mtime)}</span>
            <span class="apk-sha256" title="${esc(a.sha256)}">${esc((a.sha256||'').substring(0,16)+'…')}</span>
            <a class="btn btn-ghost btn-sm" href="${esc(a.url)}" target="_blank" rel="noopener">${icon_str('download')} DL</a>
            <button class="btn btn-sm btn-danger" onclick="deleteApk('${esc(ch)}','${esc(a.name)}')">${icon_str('trash')}</button>
          </div>`).join('')
        }
      </div>`;
    }).join('');
    $('releaseChannels').innerHTML = html;
  },
  renderDebugStatus(d) {
    const srv = [
      {label:'Xray',  ok:d.xray_active,  detail:d.xray_version||''},
      {label:'Nginx', ok:d.nginx_active,  detail:''},
      {label:'SQLite',ok:d.db_ok,         detail:d.db_path||''},
    ];
    const logsHtml = Object.entries(d.logs||{}).map(([k,l])=>`
      <div style="display:flex;align-items:center;gap:.5rem;font-size:.72rem;padding:.2rem 0">
        <span class="dot ${l.exists&&l.readable?'dot-ok':'dot-bad'}"></span>
        <span class="mono" style="flex:1">${esc(k)}</span>
        <span style="color:var(--muted-2)">${l.size_kb!=null?l.size_kb+' KB':'missing'}</span>
      </div>`).join('');
    $('debugStatus').innerHTML = `
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.75rem">
        ${srv.map(s=>`<div style="display:flex;align-items:center;gap:.4rem;font-size:.78rem">
          <span class="dot ${s.ok?'dot-ok':'dot-bad'}"></span>
          <strong>${esc(s.label)}</strong>
          ${s.detail?`<span class="mono" style="font-size:.7rem;color:var(--muted-2)">${esc(s.detail)}</span>`:''}
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.75rem;font-size:.78rem">
        <div>Devices: <strong>${fmtNum(d.device_count)}</strong></div>
        <div>Sessions: <strong>${fmtNum(d.session_count)}</strong></div>
        <div>Tests: <strong>${fmtNum(d.test_count)}</strong></div>
        <div>Payments: <strong>${fmtNum(d.payment_count)}</strong></div>
      </div>
      <div>${logsHtml}</div>
      <div style="margin-top:.5rem;font-size:.68rem;color:var(--muted-2)">PHP ${esc(d.php_version||'?')}</div>`;
  }
};
window.deleteApk = async function(channel, filename) {
  $('confirmTitle').textContent = 'Delete APK';
  $('confirmMsg').textContent   = `Delete ${filename} from ${channel}? This cannot be undone.`;
  openModal('modalConfirm');
  $('confirmOk').onclick = async()=>{
    closeModal();
    try {
      await api.post({action:'delete-old-apk', channel, filename});
      toast(`Deleted ${filename}`,'ok');
      views.release.init();
    } catch(e) { toast(e.message,'error'); }
  };
};
// Inline icon string helper (for JS-rendered HTML)
function icon_str(name) {
  const map={
    download:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    trash:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  };
  return map[name]||'';
}

// ── VIEW: CONFIG ─────────────────────────────────────────────────────
views.config = {
  rcData: {sni_priorities:[], kill_switches:[], protocol_order:[]},
  async init() {
    await this.load();
  },
  async load() {
    try {
      const [settings, rc] = await Promise.all([
        api.get('get-settings'),
        api.get('get-remote-config'),
      ]);
      $('cfgLabel').value    = settings.server_label  || '';
      $('cfgTelegram').value = settings.telegram_url  || '';
      this.rcData = rc;
      this.renderRcTags('rcSniPriorities', rc.sni_priorities||[]);
      this.renderRcTags('rcKillSwitches',  rc.kill_switches||[]);
      this.renderProtoOrder(rc.protocol_order||[]);
      $('rcEmergencySni').value = rc.emergency_sni||'';
      const bs = rc.bootstrap||{};
      $('bsUuid').value      = bs.uuid||'';
      $('bsAddress').value   = bs.address||'';
      $('bsPort').value      = bs.port||443;
      $('bsPubkey').value    = bs.publicKey||'';
      $('bsShortid').value   = bs.shortId||'';
      $('bsSni').value       = bs.sni||'';
      $('bsFlow').value      = bs.flow||'';
      $('bsFp').value        = bs.fingerprint||'';
      $('bsEdgeAddr').value  = bs.edgeAddress||'';
      $('bsEdgePort').value  = bs.edgePort||443;
      $('bsWsPath').value    = bs.wsPath||'/ws';
      $('bsXhttpPath').value = bs.xhttpPath||'/xhttp';
    } catch(e) { toast('Config: '+e.message,'error'); }
  },
  renderRcTags(elId, arr) {
    const el = $(elId);
    el.innerHTML = arr.map((v,i)=>`
      <span class="tag">${esc(v)}
        <span class="tag-del" onclick="views.config.removeTag('${elId}',${i})">×</span>
      </span>`).join('');
  },
  renderProtoOrder(arr) {
    $('rcProtocolOrder').innerHTML = arr.map((v,i)=>`
      <span class="tag">${esc(v)}
        <span class="tag-del" onclick="views.config.removeProto(${i})">×</span>
      </span>`).join('');
  },
  removeTag(elId, idx) {
    const key = elId==='rcSniPriorities'?'sni_priorities':'kill_switches';
    this.rcData[key].splice(idx,1);
    this.renderRcTags(elId, this.rcData[key]);
  },
  removeProto(idx) {
    this.rcData.protocol_order.splice(idx,1);
    this.renderProtoOrder(this.rcData.protocol_order);
  },
  addSni() {
    const v = $('rcSniInput').value.trim();
    if (!v) return;
    this.rcData.sni_priorities.push(v);
    $('rcSniInput').value='';
    this.renderRcTags('rcSniPriorities', this.rcData.sni_priorities);
  },
  addKs() {
    const v = $('rcKsInput').value.trim();
    if (!v) return;
    this.rcData.kill_switches.push(v);
    $('rcKsInput').value='';
    this.renderRcTags('rcKillSwitches', this.rcData.kill_switches);
  }
};
$('rcSniAdd').onclick   = ()=>views.config.addSni();
$('rcKsAdd').onclick    = ()=>views.config.addKs();
$('rcSniInput').onkeydown = e=>{ if(e.key==='Enter'){e.preventDefault();views.config.addSni();} };
$('rcKsInput').onkeydown  = e=>{ if(e.key==='Enter'){e.preventDefault();views.config.addKs();} };

$('cfgSaveSettings').onclick = async()=>{
  try {
    await api.post({action:'save-settings',server_label:$('cfgLabel').value,telegram_url:$('cfgTelegram').value});
    toast('Settings saved','ok');
  } catch(e) { toast(e.message,'error'); }
};
$('cfgSaveRc').onclick = async()=>{
  const rc = views.config.rcData;
  try {
    await api.post({action:'save-remote-config',
      rc_sni_priorities: rc.sni_priorities,
      rc_kill_switches:  rc.kill_switches,
      rc_protocol_order: rc.protocol_order,
      rc_emergency_sni:  $('rcEmergencySni').value,
      rc_iran_sni_order: rc.sni_priorities,
      rc_version: (+(rc.version||1)+1),
    });
    toast('Remote config saved','ok');
    views.config.load();
  } catch(e) { toast(e.message,'error'); }
};
$('cfgSaveBootstrap').onclick = async()=>{
  try {
    await api.post({action:'save-remote-config',
      bootstrap_uuid:         $('bsUuid').value,
      bootstrap_address:      $('bsAddress').value,
      bootstrap_port:         parseInt($('bsPort').value)||443,
      bootstrap_pubkey:       $('bsPubkey').value,
      bootstrap_shortid:      $('bsShortid').value,
      bootstrap_sni:          $('bsSni').value,
      bootstrap_flow:         $('bsFlow').value,
      bootstrap_fp:           $('bsFp').value,
      bootstrap_edge_address: $('bsEdgeAddr').value,
      bootstrap_edge_port:    parseInt($('bsEdgePort').value)||443,
      bootstrap_ws_path:      $('bsWsPath').value,
      bootstrap_xhttp_path:   $('bsXhttpPath').value,
    });
    toast('Bootstrap server saved','ok');
  } catch(e) { toast(e.message,'error'); }
};
$('cfgTestBootstrap').onclick = async()=>{
  $('bsTestResult').textContent = 'Testing…';
  try {
    const d = await api.get('test-bootstrap');
    $('bsTestResult').innerHTML = `<span style="color:var(--ok)">✓ OK</span> — uuid: ${esc(d.profile?.uuid||'?')}, address: ${esc(d.profile?.address||'?')}`;
  } catch(e) {
    $('bsTestResult').innerHTML = `<span style="color:var(--danger)">✗ FAILED</span> — ${esc(e.message)}`;
  }
};

// ── Debounce util ────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}

// ── Boot ─────────────────────────────────────────────────────────────
navigate(INIT_PAGE);
</script>
</body>
</html>
