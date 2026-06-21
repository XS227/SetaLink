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
if (!in_array($page, ['dashboard','analytics','ads','payments','iran','installs','devices','logs','release','config','referrals'], true)) $page = 'dashboard';

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
        'gift'    => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
        'person'  => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        'chart'   => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        'dollar'  => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
        'card'    => '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
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
    <div class="nav-item<?= $page==='analytics'?' active':'' ?>" data-page="analytics">
      <?= icon('chart') ?> Analytics
    </div>
    <div class="nav-item<?= $page==='ads'?' active':'' ?>" data-page="ads">
      <?= icon('dollar') ?> Ads &amp; Revenue
    </div>
    <div class="nav-item<?= $page==='payments'?' active':'' ?>" data-page="payments">
      <?= icon('card') ?> Payments
    </div>
    <div class="nav-item<?= $page==='iran'?' active':'' ?>" data-page="iran">
      <?= icon('globe') ?> Iran Debug
    </div>
    <div class="nav-item<?= $page==='installs'?' active':'' ?>" data-page="installs">
      <?= icon('devices') ?> Install Diag
    </div>
    <div class="nav-section">Manage</div>
    <div class="nav-item<?= $page==='devices'?' active':'' ?>" data-page="devices">
      <?= icon('devices') ?> Devices
    </div>
    <div class="nav-item<?= $page==='referrals'?' active':'' ?>" data-page="referrals">
      <?= icon('gift') ?> Referrals
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
      <div id="alertStrip"></div>
      <div class="stat-grid" id="dashStats">
        <div class="stat-card"><div class="stat-label">Online Now</div><div class="stat-value" id="statOnline">—</div><div class="stat-sub">seen &lt; 3 hours</div></div>
        <div class="stat-card"><div class="stat-label">Total Devices</div><div class="stat-value" id="statTotal">—</div><div class="stat-sub" id="statNew">—</div></div>
        <div class="stat-card"><div class="stat-label">Active 7d</div><div class="stat-value" id="statActive7d">—</div><div class="stat-sub" id="statActiveToday">—</div></div>
        <div class="stat-card"><div class="stat-label">Failures 24h</div><div class="stat-value" id="statFailed">—</div><div class="stat-sub">test reports</div></div>
        <div class="stat-card"><div class="stat-label">Pending Payments</div><div class="stat-value" id="statPayments">—</div><div class="stat-sub">awaiting review</div></div>
      </div>

      <div class="panel" id="dmPanel">
        <div class="panel-header">
          <span class="panel-title">💬 Messaging (DM)</span>
          <button class="btn btn-ghost btn-sm" id="dmRefreshBtn">Refresh</button>
        </div>
        <div class="panel-body" id="dmStatsBody"><div class="loading"><div class="spinner"></div></div></div>
      </div>

      <div class="panel" id="nodesPanel">
        <div class="panel-header">
          <span class="panel-title">🛰️ VPN Nodes</span>
          <button class="btn btn-ghost btn-sm" id="nodesRefreshBtn">Refresh</button>
        </div>
        <div class="panel-body" id="nodesBody"><div class="loading"><div class="spinner"></div></div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title"><?= icon('globe') ?> Protocol Health</span>
            <button class="btn btn-ghost btn-sm" id="probeBtn">Run Probe</button>
          </div>
          <div class="panel-body" id="protocolHealth"><div class="panel-empty">Click "Run Probe" to test WS / XHTTP / HTTPUpgrade via the edge and the production Reality server</div></div>
        </div>
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title"><?= icon('alert') ?> Service Health</span>
            <button class="btn btn-ghost btn-sm" id="svcCheckBtn">Re-check</button>
          </div>
          <div class="panel-body" id="svcHealth"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> Live Usage</span></div>
          <div class="panel-body" id="activeSessions"><div class="loading"><div class="spinner"></div></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> Transport Adoption <span class="panel-sub">active devices, 7d</span></span></div>
          <div class="panel-body" id="adoptionPanel"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Protocol Success by Country <span class="panel-sub">telemetry, 30d</span></span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Country</th><th>Protocol</th><th>Success Rate</th><th>Tests</th></tr></thead>
            <tbody id="protoCountryTbl"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> Referrals</span></div>
          <div class="panel-body" id="referralPanel"><div class="loading"><div class="spinner"></div></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> Payments &amp; Quota</span></div>
          <div class="panel-body" id="payQuotaPanel"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title"><?= icon('log') ?> Inbound Traffic <span class="panel-sub">accepted connections today (root log export, 2-min lag)</span></span>
          <span class="panel-sub" id="inboundTs"></span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Transport</th><th>Port</th><th>Listening</th><th>Accepted Today</th></tr></thead>
            <tbody id="inboundTbl"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
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
    <!-- VIEW: ANALYTICS                                              -->
    <!-- ============================================================ -->
    <div data-view="analytics" hidden>
      <div class="stat-grid" id="anaStats">
        <div class="stat-card"><div class="stat-label">Installs (30d)</div><div class="stat-value" id="anaInstalls">—</div><div class="stat-sub">new devices</div></div>
        <div class="stat-card"><div class="stat-label">VPN Sessions (30d)</div><div class="stat-value" id="anaSessions">—</div><div class="stat-sub">connections</div></div>
        <div class="stat-card"><div class="stat-label">Data Volume (30d)</div><div class="stat-value" id="anaGb">—</div><div class="stat-sub">sent + received</div></div>
        <div class="stat-card"><div class="stat-label">Avg GB / Session</div><div class="stat-value" id="anaAvg">—</div><div class="stat-sub">last 30 days</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('chart') ?> New Installs <span class="panel-sub">per day, 30d</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chInstalls"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> VPN Sessions <span class="panel-sub">per day, 30d</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chSessions"></canvas></div></div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('download') ?> Data Volume <span class="panel-sub">GB per day, 30d</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chGb"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Protocol Mix <span class="panel-sub">sessions, 30d</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chProto"></canvas></div></div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('package') ?> Package Distribution <span class="panel-sub">all devices</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chPkg"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> App Versions <span class="panel-sub">top 10</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chVer"></canvas></div></div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: ADS & REVENUE                                          -->
    <!-- ============================================================ -->
    <div data-view="ads" hidden>
      <div id="adsConfigBanner" class="panel" style="margin-bottom:1rem;display:none">
        <div class="panel-body" style="color:#f59e0b;font-size:.85rem" id="adsConfigBannerText"></div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Ads Watched (today)</div><div class="stat-value" id="adsToday">—</div><div class="stat-sub" id="adsWeek">— this week</div></div>
        <div class="stat-card"><div class="stat-label">Est. Revenue (30d)</div><div class="stat-value" id="adsRev30">—</div><div class="stat-sub" id="adsRevAll">— all time</div></div>
        <div class="stat-card"><div class="stat-label">GB Granted from Ads</div><div class="stat-value" id="adsGbGranted">—</div><div class="stat-sub">ledger credited</div></div>
        <div class="stat-card"><div class="stat-label">Users Saved</div><div class="stat-value" id="adsSaved">—</div><div class="stat-sub">from zero-data deadlock</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('dollar') ?> Rewarded Ads <span class="panel-sub">per day, 30d</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chAds"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('download') ?> Recovery Quota <span class="panel-sub">hidden-reserve usage</span></span></div>
          <div class="panel-body">
            <div class="stat-grid" style="grid-template-columns:1fr 1fr">
              <div class="stat-card"><div class="stat-label">Recovery GB Used</div><div class="stat-value" id="adsRecGb">—</div><div class="stat-sub">metered to reserve</div></div>
              <div class="stat-card"><div class="stat-label">Revenue / GB</div><div class="stat-value" id="adsRevGb">—</div><div class="stat-sub">est., from ads</div></div>
              <div class="stat-card"><div class="stat-label">Cost / GB</div><div class="stat-value" id="adsCostGb">—</div><div class="stat-sub">egress estimate</div></div>
              <div class="stat-card"><div class="stat-label">Margin / GB</div><div class="stat-value" id="adsMarginGb">—</div><div class="stat-sub">revenue − cost</div></div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title"><?= icon('person') ?> Suspicious Reward Events <span class="panel-sub" id="adsReviewCount">review queue</span></span></div>
        <div class="panel-body">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Device</th><th>Risk</th><th>Flags</th><th>Source</th><th>When</th></tr></thead>
            <tbody id="adsReviewBody"><tr><td colspan="5" style="opacity:.6">No events under review.</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Config <span class="panel-sub">remote-tunable · no APK update needed</span></span>
          <button class="btn btn-small" id="adsCfgSave" type="button">Save config</button></div>
        <div class="panel-body">
          <div id="adsConfigForm" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.6rem .9rem"></div>
          <div id="adsCfgMsg" style="margin-top:.6rem;font-size:.8rem;opacity:.7"></div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: PAYMENTS                                               -->
    <!-- ============================================================ -->
    <div data-view="payments" hidden>
      <div id="payConfigBanner" class="panel" style="margin-bottom:1rem;display:none">
        <div class="panel-body" style="color:#f59e0b;font-size:.85rem" id="payConfigBannerText"></div>
      </div>

      <div class="stat-grid">
        <div class="stat-card" style="border:1px solid #caa53a55"><div class="stat-label">REAL Revenue</div><div class="stat-value" id="payRealRev" style="color:#e8c45a">—</div><div class="stat-sub" id="payRealGb">— GB sold</div></div>
        <div class="stat-card"><div class="stat-label">USDT Revenue</div><div class="stat-value" id="payUsdtRev">—</div><div class="stat-sub" id="payUsdtGb">— GB sold</div></div>
        <div class="stat-card"><div class="stat-label">REAL Discount Cost</div><div class="stat-value" id="payDiscCost">—</div><div class="stat-sub">USDT-equiv. foregone</div></div>
        <div class="stat-card"><div class="stat-label">Confirmed / Pending</div><div class="stat-value" id="payCounts">—</div><div class="stat-sub" id="payFailed">— failed/expired</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('card') ?> Revenue by Method <span class="panel-sub">USD-equivalent</span></span></div>
          <div class="panel-body"><div style="position:relative;height:260px"><canvas id="chPayMethod"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('download') ?> GB Sold by Method</span></div>
          <div class="panel-body"><div style="position:relative;height:260px"><canvas id="chPayGb"></canvas></div></div>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Premium Packages <span class="panel-sub">remote-editable · prices never hardcoded in app</span></span></div>
        <div class="panel-body" style="overflow-x:auto">
          <table class="data-table" style="width:100%;min-width:720px">
            <thead><tr><th>package_id</th><th>GB</th><th>USDT $</th><th>REAL $</th><th>Disc %</th><th>Rec</th><th>Active</th><th>Order</th><th></th></tr></thead>
            <tbody id="payPkgBody"></tbody>
          </table>
          <div id="payPkgMsg" style="margin-top:.5rem;font-size:.8rem;opacity:.7"></div>
        </div>
      </div>

      <div class="two-col" style="margin-top:1rem">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Pending Intents</span></div>
          <div class="panel-body" style="overflow-x:auto"><table class="data-table" style="width:100%"><thead><tr><th>#</th><th>Device</th><th>Pkg</th><th>Method</th><th>$</th><th>Created</th></tr></thead><tbody id="payPendingBody"><tr><td colspan="6" style="opacity:.6">none</td></tr></tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Confirmed Payments</span></div>
          <div class="panel-body" style="overflow-x:auto"><table class="data-table" style="width:100%"><thead><tr><th>#</th><th>Device</th><th>Pkg</th><th>Method</th><th>GB</th><th>tx</th></tr></thead><tbody id="payConfirmedBody"><tr><td colspan="6" style="opacity:.6">none</td></tr></tbody></table></div>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Token / Wallet Config <span class="panel-sub">REAL + USDT · remote</span></span>
          <button class="btn btn-small" id="payCfgSave" type="button">Save config</button></div>
        <div class="panel-body">
          <div id="payConfigForm" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.6rem .9rem"></div>
          <div id="payCfgMsg" style="margin-top:.6rem;font-size:.8rem;opacity:.7"></div>
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

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Transport Mismatch Warnings</span>
          <span class="panel-sub">bad probes vs. real transport failures — last 48 h</span>
        </div>
        <div id="transportMismatchWarn" style="padding:12px 16px;font-size:13px;color:#8a9bbf;">Loading…</div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Category</th><th>Protocol</th><th>SNI</th><th>Count</th><th>Last Error</th><th>Notes</th></tr></thead>
            <tbody id="transportMismatchTbl"><tr><td colspan="6" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Transport Success Rate — Iran</span><span class="panel-sub">Reality · XHTTP · WS · HTTPUpgrade</span></div>
          <div id="iranTransportStats"><div class="loading"><div class="spinner"></div></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Live Device Transport — Iran</span><span class="panel-sub">currently active protocols on Iranian devices</span></div>
          <div id="iranLiveTransport"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Per-Device Failure Tracker — Iran</span>
          <span class="panel-sub">last_failure_category from devices table · source IP ≠ VPN exit IP</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Device</th><th>Source IP (client)</th><th>Country</th><th>Transport</th><th>SNI</th><th>RX/TX</th><th>Failure Category</th><th>Last Failure</th><th>Last Seen</th></tr></thead>
            <tbody id="iranDevFailTbl"><tr><td colspan="9" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
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
        <input class="input" id="devSearch" placeholder="Search User ID, device ID, country, model, version…" type="search">
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
        <button class="btn btn-secondary btn-sm" id="devGeoBackfillBtn" title="Re-resolve country/flag for devices with an IP but no country">🌍 Fix flags</button>
      </div>
      <div class="panel">
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>User ID</th><th>Plan</th><th>Quota</th><th>Status</th><th>Protocol</th><th class="mobile-hide">RX/TX</th><th class="mobile-hide">Connectivity</th><th class="mobile-hide">Last Failure</th><th class="mobile-hide">Country</th><th class="mobile-hide">Last IP</th><th class="mobile-hide">Last Seen</th><th>Actions</th></tr></thead>
            <tbody id="devTbl"><tr><td colspan="12" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Messages <span class="panel-sub">in-app — delivered at launch / heartbeat (app ≥ next release)</span></span>
          <button class="btn btn-secondary btn-sm" onclick="devMessage('','all devices')">+ Broadcast</button>
        </div>
        <div class="panel-body" id="msgListPanel" style="padding:.6rem 1rem">
          <div class="spinner"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Traffic by App <span class="panel-sub">all users combined · last 48h · from xray access log</span></span>
        </div>
        <div class="panel-body" id="devTrafficPanel" style="padding:.6rem 1rem">
          <div class="spinner"></div>
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
    <!-- VIEW: INSTALL DIAGNOSTICS                                    -->
    <!-- ============================================================ -->
    <div data-view="installs" hidden>
      <div class="dev-stat-grid">
        <div class="stat-card"><div class="stat-label">Total Devices</div><div class="stat-value" id="instTotal">—</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">32-bit Only</div><div class="stat-value" id="instArm32">—</div><div class="stat-sub">no arm64 — needs compat APK</div></div>
        <div class="stat-card"><div class="stat-label">Android ≤ 9</div><div class="stat-value" id="instOldAndroid">—</div><div class="stat-sub">SDK ≤ 28</div></div>
        <div class="stat-card"><div class="stat-label">ABI Unknown</div><div class="stat-value" id="instAbiUnknown">—</div><div class="stat-sub">pre-0.9.28 registrations</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">Install Failures 7d</div><div class="stat-value" id="instFailures">—</div><div class="stat-sub">OTA reports</div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">App Versions</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Version</th><th>Devices</th></tr></thead>
              <tbody id="instAppVerTbl"><tr><td colspan="2" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Android Versions</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Android</th><th>SDK</th><th>Devices</th></tr></thead>
              <tbody id="instAndroidTbl"><tr><td colspan="3" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Architecture (ABI) Distribution</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Supported ABIs</th><th>Devices</th><th>Compatible APK</th></tr></thead>
            <tbody id="instAbiTbl"><tr><td colspan="3" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Device Models</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Model</th><th>Android</th><th>SDK</th><th>ABI</th><th>App Ver</th><th>Count</th><th class="mobile-hide">Last Seen</th></tr></thead>
            <tbody id="instModelTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Install Events (OTA reports)</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>When</th><th>Event</th><th>From → To</th><th>Model</th><th>Android</th><th>ABI</th><th class="mobile-hide">Error</th></tr></thead>
            <tbody id="instEventTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
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
        <div class="panel-header">
          <span class="panel-title">Download Symlink</span>
          <button class="btn btn-ghost btn-sm" id="apkCleanupBtn" title="Keep 3 newest APKs per channel, repair symlinks"><?= icon('trash') ?> Cleanup Old APKs</button>
        </div>
        <div class="panel-body" id="dlSymlinkInfo"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="panel" style="margin-bottom:1.25rem">
        <div class="panel-header"><span class="panel-title">OTA version.json</span></div>
        <div class="panel-body" id="versionJsonInfo"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div id="releaseChannels"></div>

      <!-- Force Update / Rollout card -->
      <div class="panel" style="margin-bottom:1.25rem" id="forceUpdateCard">
        <div class="panel-header"><span class="panel-title"><?= icon('alert') ?> Force Update &amp; Rollout</span></div>
        <div class="panel-body">
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start">
            <div class="form-group" style="min-width:180px">
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
                <input type="checkbox" id="vjForceUpdate" style="accent-color:var(--accent)">
                Force Update (block old clients)
              </label>
            </div>
            <div class="form-group" style="min-width:160px">
              <label>Min Supported Version</label>
              <input class="input" id="vjMinSupported" placeholder="0.9.7" style="max-width:160px">
            </div>
            <div class="form-group" style="min-width:200px">
              <label>Rollout Strategy</label>
              <select class="input" id="vjRolloutStrategy" style="max-width:220px">
                <option value="all">All users</option>
                <option value="iran_first">Iran first</option>
                <option value="custom">Custom countries</option>
              </select>
            </div>
            <div class="form-group" style="min-width:140px">
              <label>Rollout %</label>
              <input class="input" id="vjRolloutPercent" type="number" min="1" max="100" value="100" style="max-width:100px">
            </div>
          </div>
          <button class="btn btn-primary" id="vjSaveBtn" style="margin-top:.25rem"><?= icon('save') ?> Save Settings</button>
          <span id="vjSaveStatus" style="margin-left:.75rem;font-size:.75rem;color:var(--muted)"></span>
        </div>
      </div>

      <!-- Emergency Profiles card -->
      <div class="panel" style="margin-bottom:1.25rem" id="emergencyProfilesCard">
        <div class="panel-header"><span class="panel-title"><?= icon('alert') ?> Emergency Profiles</span><span class="panel-sub">pushed to mobile clients via remote-config</span></div>
        <div class="panel-body">
          <div class="form-group">
            <label>Emergency Profiles JSON (array of profile objects)</label>
            <textarea class="input" id="emergencyProfilesJson" rows="6" style="font-family:monospace;font-size:.72rem;resize:vertical" placeholder="[]"></textarea>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center">
            <button class="btn btn-primary" id="pushEmergencyProfilesBtn"><?= icon('save') ?> Push Profiles</button>
            <span id="emergencyPushStatus" style="font-size:.75rem;color:var(--muted)"></span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">System Health</span></div>
        <div class="panel-body" id="debugStatus"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: REFERRALS                                             -->
    <!-- ============================================================ -->
    <div data-view="referrals" hidden>
      <div class="stat-grid" id="refStatGrid">
        <div class="stat-card"><div class="stat-label">Total Referrals</div><div class="stat-value" id="refTotal">—</div><div class="stat-sub" id="refFlagged">all-time conversions</div></div>
        <div class="stat-card"><div class="stat-label">Unique Inviters</div><div class="stat-value" id="refInviters">—</div><div class="stat-sub" id="refIran">devices that referred</div></div>
        <div class="stat-card"><div class="stat-label">Conversion Rate</div><div class="stat-value" id="refConversion">—</div><div class="stat-sub" id="refConvSub">referred / total</div></div>
        <div class="stat-card"><div class="stat-label">Bonus Awarded</div><div class="stat-value" id="refBonus">—</div><div class="stat-sub">total rewarded</div></div>
        <div class="stat-card"><div class="stat-label">Stealth Unlocked</div><div class="stat-value" id="refStealth">—</div><div class="stat-sub">3 active invites</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">Pending Review</div><div class="stat-value" id="refPending">—</div><div class="stat-sub" id="refRejected">held rewards</div></div>
      </div>

      <!-- Pending Review queue — held rewards awaiting an admin decision -->
      <div class="panel" style="margin-bottom:1.25rem" id="refPendingPanel" hidden>
        <div class="panel-header">
          <span class="panel-title"><?= icon('alert') ?> Pending Review</span>
          <span class="panel-sub">risk ≥ 75 — reward is HELD until approved · reject = never rewarded</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>When</th><th>Inviter</th><th>Code</th><th>New User</th><th>Device</th><th>IPs</th><th>Risk</th><th>Bonus</th><th>Action</th></tr></thead>
            <tbody id="refPendingQueue"></tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title"><?= icon('gift') ?> Top Inviters</span>
            <span class="panel-sub">ranked by invite count</span>
          </div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>#</th><th>User ID</th><th>Code</th><th>CC</th><th>Invites</th><th>Active</th><th>Bonus</th><th>Stealth</th></tr></thead>
              <tbody id="refLeaderboard"><tr><td colspan="8" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title"><?= icon('globe') ?> By Country</span>
            <span class="panel-sub">new referred users</span>
          </div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Country</th><th>Referrals</th><th>Users</th></tr></thead>
              <tbody id="refByCountry"><tr><td colspan="3" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title"><?= icon('log') ?> Recent Referrals</span>
          <span class="panel-sub">last 50 · risk ≥ 75 is held as Pending Review</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>When</th><th>Inviter</th><th>Code</th><th>New User</th><th>CC</th><th>Bonus</th><th>Status</th><th>Risk</th></tr></thead>
            <tbody id="refRecent"><tr><td colspan="8" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Review decisions audit trail -->
      <div class="panel" style="margin-top:1.25rem">
        <div class="panel-header">
          <span class="panel-title"><?= icon('log') ?> Review Audit Log</span>
          <span class="panel-sub">every approve / reject decision</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>When</th><th>Referral</th><th>Action</th><th>By</th><th>Detail</th></tr></thead>
            <tbody id="refAuditLog"><tr><td colspan="5" class="tbl-empty">No review decisions yet</td></tr></tbody>
          </table>
        </div>
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

<div class="modal-dialog" id="modalMessage">
  <div class="modal-header">
    <span class="modal-title" id="msgModalTitle">Send Message</span>
    <button class="btn-close btn btn-icon" onclick="closeModal()"><?= icon('x') ?></button>
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label>To: <strong id="msgTarget">all devices</strong></label>
    </div>
    <div class="form-group">
      <label>Title (optional)</label>
      <input class="input" id="msgTitle" maxlength="120" placeholder="e.g. New version available">
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea class="input" id="msgBody" rows="4" maxlength="1000" style="resize:vertical"></textarea>
    </div>
    <p style="font-size:.68rem;color:var(--muted-2)">Delivered when the app next checks in (launch or 10-min heartbeat).
    Requires app ≥ the next release — current installs cannot receive messages.</p>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="msgSend">Send</button>
  </div>
</div>

<div class="modal-dialog" id="modalDevice" style="max-width:680px;width:92vw">
  <div class="modal-header">
    <span class="modal-title" id="devDetailTitle">Device</span>
    <button class="btn-close btn btn-icon" onclick="closeModal()"><?= icon('x') ?></button>
  </div>
  <div class="modal-body" id="devDetailBody" style="max-height:70vh;overflow-y:auto">
    <p style="font-size:.8rem;color:var(--muted-2)">Loading…</p>
  </div>
  <div class="modal-footer">
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    <button class="btn btn-primary" id="devMsgBtn" style="display:none">Send message</button>
  </div>
</div>

<!-- ── Toast container ───────────────────────────────────────────────── -->
<div id="toast-container"></div>

<!-- ── Script ────────────────────────────────────────────────────────── -->
<script src="vendor/chart.umd.min.js"></script>
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

function countryFlag(code) {
  if (!code) return '';
  let c = String(code).trim().toUpperCase();
  // Some rows store full names (app-supplied) instead of ISO codes — map the
  // common ones so flags (especially 🇮🇷) always render.
  if (c.length !== 2) {
    const NAMES = { 'IRAN':'IR', 'ISLAMIC REPUBLIC OF IRAN':'IR', 'IRAN, ISLAMIC REPUBLIC OF':'IR',
                    'TURKEY':'TR', 'TÜRKIYE':'TR', 'TURKIYE':'TR', 'GERMANY':'DE', 'NORWAY':'NO',
                    'NETHERLANDS':'NL', 'THE NETHERLANDS':'NL', 'UNITED STATES':'US', 'IRAQ':'IQ',
                    'AFGHANISTAN':'AF', 'AZERBAIJAN':'AZ', 'ARMENIA':'AM', 'UNITED KINGDOM':'GB' };
    c = NAMES[c] || '';
    if (!c) return '';
  }
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

function protoBadge(p) {
  const proto = (p||'').toLowerCase();
  if (proto.includes('reality')) return `<span class="badge proto-reality">Reality</span>`;
  if (proto.includes('xhttp'))   return `<span class="badge proto-xhttp">XHTTP</span>`;
  if (proto.includes('httpupgrade')||proto.includes('httpup')) return `<span class="badge proto-httpupgrade">HTTPUp</span>`;
  if (proto.includes('ws')||proto.includes('websocket')) return `<span class="badge proto-ws">WS</span>`;
  return proto ? `<span class="badge badge-muted">${esc(p)}</span>` : '—';
}

function catBadge(cat) {
  const m = {
    reality_clienthello_failed: ['badge-danger','Reality ClientHello'],
    ws_upgrade_failed:          ['badge-warn','WS Upgrade'],
    xhttp_path_mismatch:        ['badge-danger','XHTTP Path'],
    socks_probe_timeout:        ['badge-warn','SOCKS Timeout'],
    dns_failed:                 ['badge-warn','DNS Failed'],
    no_internet_routed:         ['badge-muted','No Internet'],
  };
  const [cls, label] = m[cat] || ['badge-muted', cat||'unknown'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
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
  analytics: ['Analytics', 'growth & usage trends · 30-day charts'],
  ads:       ['Ads & Revenue', 'rewarded ads · recovery quota · revenue vs cost'],
  payments:  ['Payments', 'premium packages · REAL vs USDT · intents'],
  iran:      ['Iran Debug', 'censorship diagnostics · Iranian ISP analysis'],
  installs:  ['Install Diagnostics', 'app versions · Android versions · ABI · install failures'],
  devices:   ['Devices', 'device management · quota · payments'],
  logs:      ['Logs', 'structured log viewer'],
  release:   ['Release', 'APK channels · version.json · health'],
  config:    ['Config', 'remote config · bootstrap server · settings'],
  referrals: ['Referrals', 'invite analytics · leaderboard · conversion'],
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
$('dmRefreshBtn')?.addEventListener('click', ()=>views.dashboard.loadMessaging(false));
$('nodesRefreshBtn')?.addEventListener('click', ()=>views.dashboard.loadNodes());

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

// ── VIEW: ANALYTICS ──────────────────────────────────────────────────
// Chart.js (vendored, /vendor/chart.umd.min.js) over existing analytics-db
// timestamps. No extra logging: series come from dash-timeseries + the
// app-analytics / dash-metrics snapshots. Charts are destroyed and rebuilt
// on every load() so re-navigating / Refresh never double-binds a canvas.
views.analytics = {
  charts: {},
  PALETTE: ['#5b8cff','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16'],
  init() { this.load(); },
  _destroy() {
    Object.values(this.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
    this.charts = {};
  },
  _baseOpts(extra) {
    const grid = 'rgba(138,155,191,.12)', tick = '#8a9bbf';
    return Object.assign({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: tick, maxRotation: 0, autoSkip: true, font: { size: 10 } } },
        y: { grid: { color: grid }, ticks: { color: tick, font: { size: 10 } }, beginAtZero: true },
      },
    }, extra || {});
  },
  async load() {
    if (typeof Chart === 'undefined') return; // vendor script failed to load
    this._destroy();
    const [tsR, anaR, dmR] = await Promise.allSettled([
      api.get('dash-timeseries'),
      api.get('app-analytics'),
      api.get('dash-metrics'),
    ]);
    if (tsR.status === 'fulfilled') { this.renderSummary(tsR.value); this.renderTrends(tsR.value); }
    this.renderDistributions(
      anaR.status === 'fulfilled' ? anaR.value : {},
      dmR.status  === 'fulfilled' ? dmR.value  : {},
    );
  },
  renderSummary(ts) {
    const sum = a => (a || []).reduce((x, y) => x + (+y || 0), 0);
    const inst = sum(ts.installs), sess = sum(ts.sessions), gb = sum(ts.gb);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('anaInstalls', inst);
    set('anaSessions', sess);
    set('anaGb', gb.toFixed(1) + ' GB');
    set('anaAvg', (sess ? (gb / sess) : 0).toFixed(2) + ' GB');
  },
  renderTrends(ts) {
    const labels = (ts.days || []).map(d => (d || '').slice(5)); // MM-DD
    const blue = this.PALETTE[0], green = this.PALETTE[1], amber = this.PALETTE[2];
    this.charts.installs = new Chart($('chInstalls'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Installs', data: ts.installs || [], borderColor: blue,
        backgroundColor: 'rgba(91,140,255,.15)', fill: true, tension: .3, pointRadius: 2 }] },
      options: this._baseOpts({ plugins: { legend: { display: false } } }),
    });
    this.charts.sessions = new Chart($('chSessions'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Sessions', data: ts.sessions || [], backgroundColor: green, borderRadius: 3 }] },
      options: this._baseOpts({ plugins: { legend: { display: false } } }),
    });
    this.charts.gb = new Chart($('chGb'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'GB', data: ts.gb || [], borderColor: amber,
        backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: .3, pointRadius: 2 }] },
      options: this._baseOpts({ plugins: { legend: { display: false } } }),
    });
    const proto = ts.protocol_mix || {};
    this.charts.proto = this._doughnut('chProto', Object.keys(proto), Object.values(proto));
  },
  renderDistributions(ana, dm) {
    const pkg = ana.package_distribution || {};
    this.charts.pkg = this._doughnut('chPkg', Object.keys(pkg), Object.values(pkg));
    const vers = (ana.version_distribution || []).slice(0, 10);
    this.charts.ver = new Chart($('chVer'), {
      type: 'bar',
      data: { labels: vers.map(v => v.version || '?'), datasets: [{ label: 'Devices',
        data: vers.map(v => +v.cnt || 0), backgroundColor: this.PALETTE[5], borderRadius: 3 }] },
      options: this._baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });
  },
  _doughnut(canvasId, labels, data) {
    const el = $(canvasId); if (!el) return null;
    if (!labels.length) {
      return new Chart(el, { type: 'doughnut',
        data: { labels: ['No data'], datasets: [{ data: [1], backgroundColor: ['#2a3550'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }
    return new Chart(el, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: this.PALETTE, borderColor: '#0f1626', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: { legend: { position: 'right', labels: { color: '#8a9bbf', boxWidth: 12, font: { size: 11 } } } } },
    });
  },
};

// ── VIEW: ADS & REVENUE ──────────────────────────────────────────────
// Rewarded-ads revenue + recovery-quota overview. Reuses the Chart.js infra.
views.ads = {
  chart: null,
  init() {
    const btn = $('adsCfgSave');
    if (btn) btn.onclick = () => this.save();   // onclick = idempotent across re-inits
    this.load();
  },
  async save() {
    const body = { action: 'save-ads-config' };
    document.querySelectorAll('#adsConfigForm input[data-cfg]').forEach(i => { body[i.dataset.cfg] = i.value; });
    const msg = $('adsCfgMsg');
    try {
      const r = await api.post(body);
      if (msg) msg.textContent = '✓ saved ' + (r.saved || []).length + ' keys';
      if (typeof toast === 'function') toast('Ads config saved', 'ok');
      this.load();
    } catch (e) {
      if (msg) msg.textContent = '✗ ' + e.message;
    }
  },
  fmtUsd(n) { return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  async load() {
    let d;
    try { d = await api.get('ads-metrics'); } catch (e) { return; }
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const aw = d.ads_watched || {}, rev = d.est_revenue_usd || {};
    set('adsToday', aw.today ?? 0);
    set('adsWeek', (aw.week ?? 0) + ' this week · ' + (aw.month ?? 0) + ' this month');
    set('adsRev30', this.fmtUsd(rev.month));
    set('adsRevAll', this.fmtUsd(rev.all) + ' all time');
    set('adsGbGranted', (d.ad_gb_granted ?? 0) + ' GB');
    set('adsSaved', d.users_saved ?? 0);
    set('adsRecGb', (d.recovery_gb_used ?? 0) + ' GB');
    set('adsRevGb', this.fmtUsd(d.revenue_per_gb));
    set('adsCostGb', this.fmtUsd(d.cost_per_gb));
    set('adsMarginGb', this.fmtUsd((+d.revenue_per_gb || 0) - (+d.cost_per_gb || 0)));

    // Config banner: warn if AdMob / recovery node not yet configured.
    const c = d.config || {}, warn = [];
    if (!c.admob_configured)         warn.push('AdMob ad-unit not configured — rewards inert until set.');
    if (!c.admob_ssv_enabled)        warn.push('AdMob SSV disabled — no trusted server-side verification yet.');
    if (!c.recovery_node_configured) warn.push('Recovery exit node not configured — recovery/enter will refuse.');
    const banner = $('adsConfigBanner');
    if (banner) { banner.style.display = warn.length ? '' : 'none'; $('adsConfigBannerText').textContent = '⚠ ' + warn.join('  '); }

    // Editable config form (remote-tunable settings).
    const ed = d.editable || {};
    const form = $('adsConfigForm');
    if (form) {
      const secret = k => /uuid|pbk|sid|app_id|unit_id/.test(k);
      form.innerHTML = Object.keys(ed).sort().map(k => {
        const v = ed[k] ?? '';
        return `<label style="font-size:.78rem;display:flex;flex-direction:column;gap:.2rem">
          <span style="opacity:.6;font-family:monospace">${k}</span>
          <input data-cfg="${k}" type="${secret(k)?'text':(typeof v==='number'?'number':'text')}" value="${String(v).replace(/"/g,'&quot;')}" style="padding:.4rem;border-radius:6px;border:1px solid #2a3550;background:#0f1626;color:#e6ecff">
        </label>`;
      }).join('');
    }

    // Review queue.
    const rows = d.review || [];
    const tb = $('adsReviewBody');
    $('adsReviewCount').textContent = (d.review_count ?? 0) + ' under review';
    if (tb) {
      tb.innerHTML = rows.length
        ? rows.map(r => `<tr><td>${(r.device_id||'').slice(0,16)}</td><td>${r.risk_score}</td><td>${r.risk_flags||'—'}</td><td>${r.source||'—'}</td><td>${r.created_at||''}</td></tr>`).join('')
        : '<tr><td colspan="5" style="opacity:.6">No events under review.</td></tr>';
    }

    // Ads/day trend.
    if (typeof Chart !== 'undefined') {
      if (this.chart) { try { this.chart.destroy(); } catch (e) {} }
      const labels = (d.days || []).map(x => (x || '').slice(5));
      this.chart = new Chart($('chAds'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ads', data: d.ads_series || [], backgroundColor: '#22c55e', borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { color: 'rgba(138,155,191,.12)' }, ticks: { color: '#8a9bbf', maxRotation: 0, autoSkip: true, font: { size: 10 } } },
                    y: { grid: { color: 'rgba(138,155,191,.12)' }, ticks: { color: '#8a9bbf', font: { size: 10 } }, beginAtZero: true } } },
      });
    }
  },
};

// ── VIEW: PAYMENTS ───────────────────────────────────────────────────
views.payments = {
  charts: {},
  init() {
    const b = $('payCfgSave'); if (b) b.onclick = () => this.saveConfig();
    this.load();
  },
  fmtUsd(n) { return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  async load() {
    let d;
    try { d = await api.get('payments-metrics'); } catch (e) { return; }
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const bm = d.by_method || {}, real = bm.REAL || {}, usdt = bm.USDT || {};
    set('payRealRev', this.fmtUsd(real.revenue)); set('payRealGb', (real.gb || 0) + ' GB sold');
    set('payUsdtRev', this.fmtUsd(usdt.revenue)); set('payUsdtGb', (usdt.gb || 0) + ' GB sold');
    set('payDiscCost', this.fmtUsd(d.discount_cost));
    const c = d.counts || {};
    set('payCounts', (c.confirmed || 0) + ' / ' + (c.pending || 0));
    set('payFailed', ((c.expired || 0) + (c.rejected || 0)) + ' failed/expired');

    // Config banner — clear status of each activation gate.
    const cf = d.config || {}, warn = [];
    warn.push(cf.real_ready ? '✓ REAL enabled' : '✗ REAL not ready (enable + token + wallet)');
    warn.push(cf.usdt_ready ? '✓ USDT enabled' : '✗ USDT disabled (safe default until chain/wallet/token set)');
    warn.push(cf.auto_verify ? '✓ on-chain auto-verify ON' : '✗ auto-verify OFF (set ton_indexer_key; manual approve still works)');
    const allReady = cf.real_ready && cf.auto_verify;
    const banner = $('payConfigBanner');
    if (banner) {
      banner.style.display = '';
      $('payConfigBannerText').style.color = allReady ? '#22c55e' : '#f59e0b';
      $('payConfigBannerText').textContent = (allReady ? '● ' : '⚠ ') + warn.join('   ·   ');
    }

    this.renderPackages(d.packages || []);
    this.renderConfig(d.editable || {});
    this.renderIntents(d.pending || [], d.confirmed || []);
    this.renderCharts(real, usdt);
  },
  renderPackages(pkgs) {
    const tb = $('payPkgBody'); if (!tb) return;
    const cell = (pid, f, v, t) => `<input data-pid="${pid}" data-f="${f}" type="${t}" value="${String(v).replace(/"/g,'&quot;')}" style="width:${t==='number'?'70px':'90px'};padding:.3rem;border-radius:5px;border:1px solid #2a3550;background:#0f1626;color:#e6ecff">`;
    tb.innerHTML = pkgs.map(p => `<tr>
      <td>${p.package_id}</td>
      <td>${cell(p.package_id,'gb_amount',p.gb_amount,'number')}</td>
      <td>${cell(p.package_id,'usdt_price',p.usdt_price,'number')}</td>
      <td>${cell(p.package_id,'real_price',p.real_price,'number')}</td>
      <td>${(+p.real_discount_percent).toFixed(0)}%</td>
      <td><input data-pid="${p.package_id}" data-f="is_recommended" type="checkbox" ${p.is_recommended?'checked':''}></td>
      <td><input data-pid="${p.package_id}" data-f="is_active" type="checkbox" ${p.is_active?'checked':''}></td>
      <td>${cell(p.package_id,'display_order',p.display_order,'number')}</td>
      <td><button class="btn btn-small" onclick="views.payments.savePackage('${p.package_id}')">Save</button></td>
    </tr>`).join('');
  },
  async savePackage(pid) {
    const body = { action: 'save-package', package_id: pid };
    document.querySelectorAll(`[data-pid="${pid}"]`).forEach(i => {
      body[i.dataset.f] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value;
    });
    try { await api.post(body); $('payPkgMsg').textContent = '✓ saved ' + pid; if (typeof toast==='function') toast('Package saved','ok'); this.load(); }
    catch (e) { $('payPkgMsg').textContent = '✗ ' + e.message; }
  },
  renderConfig(ed) {
    const form = $('payConfigForm'); if (!form) return;
    form.innerHTML = Object.keys(ed).sort().map(k => `<label style="font-size:.78rem;display:flex;flex-direction:column;gap:.2rem">
      <span style="opacity:.6;font-family:monospace">${k}</span>
      <input data-cfg="${k}" type="text" value="${String(ed[k]).replace(/"/g,'&quot;')}" style="padding:.4rem;border-radius:6px;border:1px solid #2a3550;background:#0f1626;color:#e6ecff"></label>`).join('');
  },
  async saveConfig() {
    const body = { action: 'save-payments-config' };
    document.querySelectorAll('#payConfigForm input[data-cfg]').forEach(i => { body[i.dataset.cfg] = i.value; });
    try { const r = await api.post(body); $('payCfgMsg').textContent = '✓ saved ' + (r.saved||[]).length + ' keys'; if (typeof toast==='function') toast('Payments config saved','ok'); this.load(); }
    catch (e) { $('payCfgMsg').textContent = '✗ ' + e.message; }
  },
  renderIntents(pending, confirmed) {
    const pb = $('payPendingBody');
    if (pb) pb.innerHTML = pending.length ? pending.map(i => `<tr><td>${i.payment_id}</td><td>${(i.device_id||'').slice(0,12)}</td><td>${i.package_id}</td><td>${i.method}</td><td>${(+i.amount).toFixed(2)}</td><td>${i.created_at||''}</td></tr>`).join('') : '<tr><td colspan="6" style="opacity:.6">none</td></tr>';
    const cb = $('payConfirmedBody');
    if (cb) cb.innerHTML = confirmed.length ? confirmed.map(i => `<tr><td>${i.payment_id}</td><td>${(i.device_id||'').slice(0,12)}</td><td>${i.package_id}</td><td>${i.method}</td><td>${i.gb_amount}</td><td>${(i.tx_hash||'').slice(0,12)}</td></tr>`).join('') : '<tr><td colspan="6" style="opacity:.6">none</td></tr>';
  },
  renderCharts(real, usdt) {
    if (typeof Chart === 'undefined') return;
    Object.values(this.charts).forEach(c => { try { c.destroy(); } catch (e) {} });
    this.charts = {};
    const gold = '#e8c45a', blue = '#5b8cff';
    const dough = (id, vals) => new Chart($(id), {
      type: 'doughnut',
      data: { labels: ['REAL', 'USDT'], datasets: [{ data: vals, backgroundColor: [gold, blue], borderColor: '#0f1626', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: { legend: { position: 'right', labels: { color: '#8a9bbf', boxWidth: 12, font: { size: 11 } } } } },
    });
    this.charts.method = dough('chPayMethod', [real.revenue || 0, usdt.revenue || 0]);
    this.charts.gb     = dough('chPayGb', [real.gb || 0, usdt.gb || 0]);
  },
};

views.dashboard = {
  init() {
    this.loadAll();
    this.loadHealth();
    this.loadMessaging(false);
    this.loadNodes();
    refreshTimer = setInterval(()=>{ this.loadAll(); this.loadNodes(); }, 10000);
  },
  // VPN node health — written by scripts/check-node-health.sh (cron, 2 min).
  async loadNodes() {
    const el = $('nodesBody');
    if (!el) return;
    try {
      const d = await api.get('node-health');
      const nodes = d.nodes || {};
      const ids = Object.keys(nodes);
      if (!ids.length) { el.innerHTML = '<div class="panel-empty">No node-health data yet (cron may not have run).</div>'; return; }
      const dot = s => s==='up' ? '<span style="color:var(--ok)">●</span>'
                     : s==='degraded' ? '<span style="color:var(--warn)">●</span>'
                     : '<span style="color:var(--danger)">●</span>';
      const rows = ids.map(id => {
        const n = nodes[id];
        const rtt = (n.rtt_ms===null||n.rtt_ms===undefined) ? '—' : n.rtt_ms+' ms';
        const badge = n.status==='up' ? 'badge-success' : n.status==='degraded' ? 'badge-warn' : 'badge-danger';
        return `<tr>
          <td>${dot(n.status)} <strong>${esc(id)}</strong></td>
          <td><span class="badge ${badge}">${esc((n.status||'').toUpperCase())}</span></td>
          <td class="mono">${rtt}</td>
          <td class="mono" style="font-size:.72rem">${esc(n.address||'')}</td>
          <td class="mono" style="font-size:.72rem">TLS ${n.tls?'✓':'✗'} · ${esc(n.edge||'')}</td>
          <td style="font-size:.7rem;color:var(--muted-2)">${esc((n.checked_at||'').replace('T',' ').replace('Z',''))}</td>
        </tr>`;
      }).join('');
      const staleWarn = d.stale ? '<div style="color:var(--warn);font-size:.72rem;margin-bottom:.5rem">⚠ Health data is stale — the cron may have stopped.</div>' : '';
      el.innerHTML = staleWarn + `<table class="data-table"><thead><tr>
        <th>Node</th><th>Status</th><th>RTT</th><th>Address</th><th>Edge / TLS</th><th>Checked</th>
        </tr></thead><tbody>${rows}</tbody></table>`;
    } catch (e) {
      el.innerHTML = `<div class="panel-empty">Failed to load node health: ${esc(e.message||e)}</div>`;
    }
  },
  async loadAll() {
    const [analytics, sessions, inbounds, sniLb, metrics] = await Promise.allSettled([
      api.get('app-analytics'),
      api.get('active-sessions'),
      api.get('inbound-stats'),
      api.get('sni-leaderboard'),
      api.get('dash-metrics'),
    ]);
    if (analytics.status==='fulfilled') this.renderStats(analytics.value);
    if (sessions.status==='fulfilled')  this.renderSessions(sessions.value);
    if (inbounds.status==='fulfilled')  this.renderInbounds(inbounds.value);
    if (sniLb.status==='fulfilled')     this.renderSniLb(sniLb.value);
    if (metrics.status==='fulfilled')   this.renderMetrics(metrics.value);
    this.loadMessaging(true);   // live-refresh without flashing the spinner
  },
  // User-to-user messaging — metadata only, never message content (bodies are
  // encrypted at rest; the endpoint never selects them).
  async loadMessaging(silent) {
    const el = $('dmStatsBody');
    if (!el) return;
    if (!silent) el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const d = await api.post({action:'user-messages-stats'});
      const card = (label, val, sub) =>
        `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${fmtNum(val)}</div>${sub?`<div class="stat-sub">${esc(sub)}</div>`:''}</div>`;
      el.innerHTML =
        `<div class="stat-grid">
          ${card('Total', d.total, 'all messages')}
          ${card('Unread', d.delivered_unread, 'delivered · not read')}
          ${card('Read', d.read, 'opened')}
          ${card('Sent 24h', d.last_24h, 'last 24 hours')}
          ${card('Senders', d.senders, 'distinct devices')}
          ${card('Recipients', d.recipients, 'distinct devices')}
        </div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:.55rem">🔒 Metadata only — message content is encrypted at rest and never shown here. No IP / email / phone / device data.</div>`;
    } catch(e) {
      el.innerHTML = `<div class="panel-empty" style="color:var(--danger)">Failed to load messaging stats: ${esc(e.message)}</div>`;
    }
  },
  async loadHealth() {
    const el = $('svcHealth');
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Checking services…</div>';
    try {
      const d = await api.get('service-health');
      el.innerHTML = renderHealthChecks(d);
      this.renderAlerts(d);
    } catch(e) { el.innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`; }
  },
  renderAlerts(d) {
    const fails = (d.checks||[]).filter(c=>!c.ok);
    $('alertStrip').innerHTML = fails.length ? fails.map(c=>
      `<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .8rem;margin-bottom:.6rem;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.3);border-radius:6px">
        <span style="color:var(--danger);font-weight:700">⚠</span>
        <span style="font-size:.78rem;font-weight:600">${esc(c.label)}</span>
        <span style="font-size:.72rem;color:var(--muted);flex:1">${esc(c.detail||'')}</span>
        ${c.fix?`<span class="mono" style="font-size:.65rem;color:var(--warn)">${esc(c.fix)}</span>`:''}
      </div>`).join('') : '';
  },
  renderStats(d) {
    $('statOnline').textContent   = fmtNum(d.online_now);
    $('statTotal').textContent    = fmtNum(d.total_installs);
    $('statActive7d').textContent = fmtNum(d.active_7d);
    $('statActiveToday').textContent = fmtNum(d.active_today)+' today';
    $('statNew').textContent      = fmtNum(d.new_this_month)+' this month';
    $('statFailed').textContent   = fmtNum(d.failed_24h);
  },
  renderSessions(d) {
    const el = $('activeSessions');
    let html = `<div style="margin-bottom:.5rem;font-size:.83rem">
      <span style="font-weight:700;font-size:1.2rem">${esc(d.online_devices)}</span>
      <span style="color:var(--muted);margin-left:.35rem">devices online (heartbeat &lt; 5 min)</span>
    </div>`;
    html += `<div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">${fmtNum(d.sessions_24h)} sessions · ${fmtBytes(d.bytes_24h)} in last 24h</div>`;
    const chips = (obj,prefix)=>Object.entries(obj||{}).map(([k,c])=>
      `<div style="font-size:.7rem;padding:.15rem .4rem;border-radius:4px;background:var(--bg-2);border:1px solid var(--border)">${prefix}${esc(k)}: <strong>${c}</strong></div>`).join('');
    if (Object.keys(d.protocols||{}).length || Object.keys(d.countries||{}).length) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:.3rem">${chips(d.protocols,'')}${chips(d.countries,'🌍 ')}</div>`;
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
        <td>${d.stats_available?fmtNum(p.accepted):'—'}</td>
      </tr>`;
    }
    $('inboundTbl').innerHTML = rows || '<tr><td colspan="4" class="tbl-empty">No data</td></tr>';
    $('inboundTs').textContent = d.stats_available
      ? `${fmtNum(d.accepted_total)} total · ${fmtNum(d.uuid_rejections)} UUID rejections · exported ${d.stats_exported_at||''}`
      : 'log export missing — run scripts/export-xray-stats.sh from root cron';
    if (d.last_errors&&d.last_errors.length) {
      const errDiv = $('inboundErrors');
      errDiv.style.display = 'block';
      errDiv.innerHTML = '<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem;font-weight:600">RECENT XRAY ERRORS</div>' +
        d.last_errors.map(e=>`<div class="mono" style="font-size:.68rem;color:var(--danger);padding:.1rem 0">${esc(e)}</div>`).join('');
    }
  },
  renderMetrics(d) {
    $('statPayments').textContent = fmtNum((d.payments||{}).pending||0);
    // Protocol success by country
    const psc = d.protocol_by_country||[];
    $('protoCountryTbl').innerHTML = psc.length ? psc.map(r=>{
      const cls = r.rate===null?'badge-muted':r.rate>=80?'badge-ok':r.rate>=50?'badge-warn':'badge-danger';
      return `<tr>
        <td>${esc(r.country)}</td>
        <td>${protoBadge(r.protocol)}</td>
        <td><span class="badge ${cls}">${r.rate!=null?r.rate+'%':'—'}</span></td>
        <td>${fmtNum(r.total)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="4" class="tbl-empty">No telemetry yet</td></tr>';
    // Transport adoption
    const ad = d.adoption||{};
    const adTotal = Object.values(ad).reduce((a,b)=>a+b,0);
    $('adoptionPanel').innerHTML = adTotal ? Object.entries(ad).map(([p,c])=>{
      const pct = Math.round(c/adTotal*100);
      return `<div style="display:flex;align-items:center;gap:.6rem;padding:.25rem 0">
        <span style="font-size:.75rem;font-weight:600;width:110px">${esc(p)}</span>
        <div class="progress" style="flex:1"><div class="progress-bar ok" style="width:${pct}%"></div></div>
        <span style="font-size:.72rem;color:var(--muted);width:70px;text-align:right">${c} · ${pct}%</span>
      </div>`;
    }).join('') : '<div class="panel-empty">No active devices in last 7 days</div>';
    // Referrals
    const rf = d.referrals||{};
    $('referralPanel').innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);gap:.5rem">
        <div><div class="stat-label">Total referrals</div><div style="font-size:1.1rem;font-weight:700">${fmtNum(rf.total)}</div></div>
        <div><div class="stat-label">Last 30 days</div><div style="font-size:1.1rem;font-weight:700">${fmtNum(rf.last_30d)}</div></div>
        <div><div class="stat-label">Unique referrers</div><div style="font-size:1.1rem;font-weight:700">${fmtNum(rf.referrers)}</div></div>
        <div><div class="stat-label">Bonus granted</div><div style="font-size:1.1rem;font-weight:700">${fmtBytes(rf.bonus_bytes)}</div></div>
      </div>
      ${rf.flagged?`<div style="margin-top:.5rem;font-size:.72rem;color:var(--warn)">⚠ ${rf.flagged} flagged for fraud review</div>`:''}`;
    // Payments + quota
    const pay = d.payments||{}, q = d.quota||{};
    const qPct = q.total_bytes ? Math.round(q.used_bytes/q.total_bytes*100) : 0;
    $('payQuotaPanel').innerHTML = `
      <div style="font-size:.78rem;margin-bottom:.6rem">
        Payments: <strong>${fmtNum(pay.pending)}</strong> pending · ${fmtNum(pay.approved)} approved · ${fmtNum(pay.rejected)} rejected
        <span style="color:var(--muted)"> · ${pay.amount_usdt_approved||0} USDT received</span>
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:.25rem">Quota across ${fmtNum(q.devices)} devices</div>
      <div class="progress" style="margin-bottom:.35rem"><div class="progress-bar ${qPct>=80?'warn':'ok'}" style="width:${qPct}%"></div></div>
      <div style="font-size:.72rem;color:var(--muted)">${fmtBytes(q.used_bytes)} / ${fmtBytes(q.total_bytes)} (${qPct}%)
        ${q.exhausted?` · <span style="color:var(--danger)">${q.exhausted} exhausted</span>`:''}
        ${q.near_limit?` · <span style="color:var(--warn)">${q.near_limit} near limit</span>`:''}
      </div>`;
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

function renderHealthChecks(d) {
  return `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.75rem">
      <span style="font-size:1.5rem;font-weight:700;color:${d.ok?'var(--ok)':'var(--danger)'}">${d.score}/100</span>
      <div style="font-size:.75rem;color:${d.ok?'var(--ok)':'var(--danger)'}">
        ${d.ok?'✓ All services healthy':`✗ ${d.failing} check${d.failing>1?'s':''} failing`}
      </div>
    </div>
    ${(d.checks||[]).map(c=>`<div style="display:flex;align-items:flex-start;gap:.6rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
      <span class="dot ${c.ok?'dot-ok':'dot-bad'}" style="margin-top:2px"></span>
      <div style="flex:1">
        <span style="font-weight:600;font-size:.8rem">${esc(c.label)}</span>
        <div style="font-size:.68rem;color:${c.ok?'var(--muted)':'var(--danger)'};margin-top:1px">${esc(c.detail||'')}</div>
        ${!c.ok&&c.fix?`<div style="font-size:.65rem;font-family:var(--mono);background:var(--bg-elevated);padding:.2rem .4rem;margin-top:.25rem;border-radius:3px;color:var(--warn)">${esc(c.fix)}</div>`:''}
      </div>
    </div>`).join('')}
    <div style="font-size:.65rem;color:var(--muted-2);margin-top:.5rem">checked ${esc(d.checked_at||'')}</div>
  `;
}

$('svcCheckBtn').addEventListener('click', ()=>views.dashboard.loadHealth());

// ── VIEW: IRAN DEBUG ─────────────────────────────────────────────────
views.iran = {
  async init() {
    this.loadScore();
    this.loadDebug();
    this.loadNoInternet();
    this.loadTransportMismatch();
    this.loadTransportStats();
    this.loadDeviceFailures();
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
  async loadTransportMismatch() {
    try {
      const data = await api.get('transport-mismatch');
      const rows = data.rows || [];
      const warns = data.warnings || [];

      $('transportMismatchWarn').innerHTML = warns.length
        ? warns.map(w=>`<div style="margin-bottom:6px;padding:6px 10px;border-left:3px solid ${w.level==='error'?'#e74c3c':w.level==='warn'?'#f39c12':'#3498db'};background:rgba(255,255,255,.03);border-radius:2px;font-size:.78rem">
            <strong>${esc(w.label)}</strong>: ${esc(w.detail)}
          </div>`).join('')
        : '<span style="color:#2ecc71;font-size:.8rem">✓ No transport mismatches detected in last 48 h</span>';

      $('transportMismatchTbl').innerHTML = !rows.length
        ? '<tr><td colspan="6" class="tbl-empty">No transport failures recorded — good!</td></tr>'
        : rows.map(r=>{
            const notes = r.failure_category === 'xhttp_path_mismatch'
              ? `Client sent <code>${esc(r.sni||'?')}</code> — ensure path ends with <strong>/</strong>`
              : r.failure_category === 'reality_clienthello_failed'
              ? 'Check if source IP is a server probe (127.x / server IP) — not a real Iran failure'
              : r.failure_category === 'ws_upgrade_failed'
              ? 'Verify nginx not using http2 on edge vhost; WS needs HTTP/1.1 Upgrade'
              : '—';
            return `<tr>
              <td>${catBadge(r.failure_category)}</td>
              <td>${protoBadge(r.protocol)}</td>
              <td class="mono" style="font-size:.7rem">${esc(r.sni||'—')}</td>
              <td><strong>${fmtNum(r.cnt)}</strong></td>
              <td style="max-width:220px;font-size:.68rem;color:var(--muted);word-break:break-all">${esc((r.last_error||'').substring(0,100))}</td>
              <td style="font-size:.7rem;color:var(--muted-2)">${notes}</td>
            </tr>`;
          }).join('');
    } catch(e) {
      $('transportMismatchTbl').innerHTML=`<tr><td colspan="6" class="tbl-empty">${esc(e.message)}</td></tr>`;
      $('transportMismatchWarn').textContent = e.message;
    }
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
  },
  async loadTransportStats() {
    try {
      const d = await api.get('iran-transport-stats');
      const rows = d.telemetry || [];
      $('iranTransportStats').innerHTML = !rows.length
        ? '<div class="panel-empty">No Iran transport telemetry yet</div>'
        : `<div class="tbl-wrap"><table>
            <thead><tr><th>Transport</th><th>Total</th><th>Success %</th><th>Probe OK</th><th>No Internet</th><th>Avg Latency</th></tr></thead>
            <tbody>${rows.map(r=>{
              const cls = r.success_rate>=70?'badge-ok':r.success_rate>=35?'badge-warn':'badge-danger';
              return `<tr>
                <td style="font-weight:600">${esc(r.transport)}</td>
                <td>${fmtNum(r.total)}</td>
                <td><span class="badge ${cls}">${r.success_rate!=null?r.success_rate+'%':'—'}</span></td>
                <td>${fmtNum(r.probe_ok)}</td>
                <td><span class="${+r.no_internet>0?'badge badge-warn':''}">${fmtNum(r.no_internet)}</span></td>
                <td>${fmtMs(r.avg_latency)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`;
      const live = d.live_devices || [];
      $('iranLiveTransport').innerHTML = !live.length
        ? '<div class="panel-empty">No Iranian devices currently active</div>'
        : `<div class="tbl-wrap"><table>
            <thead><tr><th>Transport</th><th>Devices</th><th>Routed OK</th><th>Had Failures</th></tr></thead>
            <tbody>${live.map(r=>`<tr>
              <td style="font-weight:600">${esc(r.transport)}</td>
              <td>${fmtNum(r.devices)}</td>
              <td><span class="${+r.routed_ok>0?'badge badge-ok':''}">${fmtNum(r.routed_ok)}</span></td>
              <td><span class="${+r.with_failures>0?'badge badge-warn':''}">${fmtNum(r.with_failures)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>`;
    } catch(e) {
      $('iranTransportStats').innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`;
      $('iranLiveTransport').innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`;
    }
  },
  async loadDeviceFailures() {
    try {
      const d = await api.get('iran-device-failures');
      const rows = d.devices || [];
      // Category summary badges
      const cats = d.category_summary || {};
      $('iranDevFailTbl').innerHTML = !rows.length
        ? '<tr><td colspan="9" class="tbl-empty">No Iranian devices in database yet</td></tr>'
        : rows.map(r=>{
            const uid = r.user_id || (r.device_id||'').slice(-8).toUpperCase() || '—';
            const failBadge = r.last_failure_category
              ? `<span class="badge ${r.last_failure_category.includes('no')||r.last_failure_category.includes('fail')?'badge-danger':'badge-warn'}">${esc(r.last_failure_category)}</span>`
              : '<span style="color:var(--muted-2);font-size:.7rem">—</span>';
            const rxtx = (r.rx_bytes||0)+(r.tx_bytes||0)>0
              ? `<div style="font-size:.65rem;font-family:var(--mono)">↓${fmtBytes(r.rx_bytes)} ↑${fmtBytes(r.tx_bytes)}</div>` : '—';
            // SOURCE IP is client IP (r.last_ip), NOT VPN exit IP
            return `<tr>
              <td style="font-family:var(--mono);font-size:.7rem;font-weight:600">${esc(uid)}</td>
              <td style="font-family:var(--mono);font-size:.65rem;color:var(--muted-2)" title="Source / client IP">${esc(r.last_ip||'—')}</td>
              <td style="font-size:.75rem">${esc(r.country_name||r.country||'—')}</td>
              <td>${protoBadge(r.active_protocol)}</td>
              <td style="font-family:var(--mono);font-size:.65rem;color:var(--muted-2)">${esc(r.active_sni||'—')}</td>
              <td>${rxtx}</td>
              <td>${failBadge}</td>
              <td style="font-size:.68rem;color:var(--muted-2)">${fmtRelative(r.last_failure_at)}</td>
              <td style="font-size:.68rem;color:var(--muted-2)">${fmtRelative(r.last_seen)}</td>
            </tr>`;
          }).join('');
    } catch(e) {
      $('iranDevFailTbl').innerHTML = `<tr><td colspan="9" class="tbl-empty">${esc(e.message)}</td></tr>`;
    }
  },
};

// ── VIEW: DEVICES ────────────────────────────────────────────────────
// ── VIEW: INSTALL DIAGNOSTICS ────────────────────────────────────────
views.installs = {
  init() { this.load(); },
  async load() {
    try {
      const d = await api.get('install-diagnostics');
      const s = d.summary || {};
      $('instTotal').textContent      = s.total_devices ?? '—';
      $('instArm32').textContent      = s.arm32_only ?? '—';
      $('instOldAndroid').textContent = s.android9_or_older ?? '—';
      $('instAbiUnknown').textContent = s.abi_unknown ?? '—';
      $('instFailures').textContent   = s.install_failures_7d ?? '—';

      $('instAppVerTbl').innerHTML = (d.app_versions||[]).length
        ? d.app_versions.map(r=>`<tr><td>${esc(r.version)}</td><td>${r.cnt}</td></tr>`).join('')
        : '<tr><td colspan="2" class="tbl-empty">No data</td></tr>';

      // Android versions: prefer device registrations, fall back to probe telemetry
      const av = (d.android_versions||[]).length ? d.android_versions : (d.android_versions_tests||[]);
      $('instAndroidTbl').innerHTML = av.length
        ? av.map(r=>`<tr><td>Android ${esc(r.android_version||'?')}</td><td>${r.sdk_version||'—'}</td><td>${r.cnt}</td></tr>`).join('')
        : '<tr><td colspan="3" class="tbl-empty">No data — devices report this from v0.9.28</td></tr>';

      $('instAbiTbl').innerHTML = (d.abis||[]).length
        ? d.abis.map(r=>{
            const has64 = (r.abi||'').includes('arm64-v8a');
            const has32 = (r.abi||'').includes('armeabi');
            const apk = has64 ? '<span class="badge badge-ok">default (arm64)</span>'
                      : has32 ? '<span class="badge badge-warn">arm32 compat APK only</span>'
                      : '<span class="badge badge-danger">unsupported</span>';
            return `<tr><td style="font-family:var(--mono);font-size:.75rem">${esc(r.abi)}</td><td>${r.cnt}</td><td>${apk}</td></tr>`;
          }).join('')
        : '<tr><td colspan="3" class="tbl-empty">No ABI data yet — devices report this from v0.9.28</td></tr>';

      $('instModelTbl').innerHTML = (d.models||[]).length
        ? d.models.map(r=>{
            const abi32 = r.abi && !r.abi.includes('arm64-v8a');
            return `<tr>
              <td>${esc((r.manufacturer||'')+' '+(r.model||''))}</td>
              <td>${esc(r.android_version||'—')}</td>
              <td>${r.sdk_version||'—'}</td>
              <td>${r.abi ? `<span class="badge ${abi32?'badge-warn':'badge-ok'}">${esc(r.abi.split(',')[0])}${abi32?' (32-bit)':''}</span>` : '—'}</td>
              <td>${esc(r.app_version||'—')}</td>
              <td>${r.cnt}</td>
              <td class="mobile-hide">${esc(r.last_seen||'')}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="7" class="tbl-empty">No model data</td></tr>';

      $('instEventTbl').innerHTML = (d.install_events||[]).length
        ? d.install_events.map(r=>{
            const cls = r.event==='install_success' ? 'badge-ok' : r.event==='install_failure' ? 'badge-danger' : 'badge-info';
            return `<tr>
              <td style="white-space:nowrap">${esc(r.created_at||'')}</td>
              <td><span class="badge ${cls}">${esc(r.event)}</span></td>
              <td>${esc(r.current_version||'?')} → ${esc(r.target_version||'?')}</td>
              <td>${esc(r.device_model||'—')}</td>
              <td>${esc(r.android_version||'—')}${r.android_sdk?` (SDK ${r.android_sdk})`:''}</td>
              <td style="font-family:var(--mono);font-size:.72rem">${esc((r.abi||'').split(',')[0]||'—')}</td>
              <td class="mobile-hide" style="font-size:.72rem;color:var(--muted)">${esc(r.error||'')}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="7" class="tbl-empty">No install events reported yet</td></tr>';
    } catch(e) { toast('Install diagnostics: '+e.message,'error'); }
  },
};

views.devices = {
  devData: [],
  quotaDevId: '',
  blockDevId: '',
  blockAction: '',
  async init() {
    this.loadDevices();
    this.loadPayments();
    this.loadTraffic();
    this.loadMessages();
    // Wire controls
    $('devSearch').oninput = debounce(()=>this.renderDevices(), 250);
    $('devPlan').onchange = ()=>this.renderDevices();
    $('devStatus').onchange = ()=>this.renderDevices();
    $('devRefreshBtn').onclick = ()=>{ this.loadDevices(); this.loadPayments(); this.loadTraffic(); };
    $('devGeoBackfillBtn').onclick = async()=>{
      const btn = $('devGeoBackfillBtn'); btn.disabled = true;
      try {
        const r = await api.post({action:'geo-backfill'});
        toast(`Geo backfill: ${r.fixed}/${r.checked} devices fixed`, 'ok');
        this.loadDevices();
      } catch(e) { toast('Geo backfill failed: '+e.message,'error'); }
      finally { btn.disabled = false; }
    };
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
    if (q)              rows = rows.filter(r=>((r.user_id||'')+(r.device_id_short||'')+(r.country||'')+(r.app_version||'')+(r.device_id||'')+(r.model||'')).toLowerCase().includes(q));
    if (plan)           rows = rows.filter(r=>r.plan===plan);
    if (status==='online')  rows = rows.filter(r=>r.status==='online');
    if (status==='offline') rows = rows.filter(r=>r.status!=='online');
    if (status==='blocked') rows = rows.filter(r=>r.blocked);
    $('devTbl').innerHTML = !rows.length
      ? '<tr><td colspan="12" class="tbl-empty">No devices match filter</td></tr>'
      : rows.map(r=>{
          const usedPct = r.quota_bytes_total>0?Math.min(100,Math.round(r.quota_bytes_used/r.quota_bytes_total*100)):0;
          const uid     = r.user_id || r.device_id_short || '—';
          const flag    = countryFlag(r.country_code||'');
          // RX/TX traffic
          const rxBytes = r.rx_bytes || 0;
          const txBytes = r.tx_bytes || 0;
          const hasTraffic = rxBytes > 0 || txBytes > 0;
          const rxtxHtml = hasTraffic
            ? `<div style="font-size:.65rem;font-family:var(--mono)">↓ ${fmtBytes(rxBytes)}</div><div style="font-size:.65rem;font-family:var(--mono);color:var(--muted-2)">↑ ${fmtBytes(txBytes)}</div>`
            : `<span style="color:var(--muted-2);font-size:.7rem">—</span>`;
          // Three-state connectivity column: CONNECTED / ROUTED / DNS OK
          const isOnline = r.status === 'online';
          const rtOk     = r.internet_ok;
          const dnsOk    = r.dns_ok;
          const connColor= isOnline ? 'var(--ok)' : 'var(--muted-2)';
          const rtColor  = isOnline ? (rtOk ? 'var(--ok)' : 'var(--danger)') : 'var(--muted-2)';
          const dnsColor = isOnline ? (dnsOk ? 'var(--ok)' : (dnsOk===null||dnsOk===undefined ? 'var(--muted-2)' : 'var(--danger)')) : 'var(--muted-2)';
          const connLabel= isOnline ? '● CONNECTED' : '○ OFFLINE';
          const rtLabel  = isOnline ? (rtOk ? '✓ ROUTED' : '✗ ROUTED') : '— ROUTED';
          const dnsLabel = isOnline ? (dnsOk===null||dnsOk===undefined ? '? DNS OK' : (dnsOk ? '✓ DNS OK' : '✗ DNS OK')) : '— DNS OK';
          const connHtml = `<div style="font-size:.62rem;line-height:1.8;font-family:var(--mono)"><span style="color:${connColor}">${connLabel}</span><br><span style="color:${rtColor}">${rtLabel}</span><br><span style="color:${dnsColor}">${dnsLabel}</span></div>`;
          // Failure category badge
          const failCat = r.last_failure_category || '';
          const failBadge = failCat
            ? catBadge(failCat) + (r.last_failure_at ? `<div style="font-size:.6rem;color:var(--muted-2);margin-top:1px">${fmtRelative(r.last_failure_at)}</div>` : '')
            : '<span style="color:var(--muted-2);font-size:.7rem">—</span>';
          // Source country vs VPN exit — show latest known country, or Unknown.
          const srcIp  = esc(r.last_ip||'—');
          const ctryName = r.country_name || r.country || '';
          const srcCtry = ctryName ? (flag + ' ' + esc(ctryName)) : '<span style="color:var(--muted-2)">Unknown</span>';
          // Active SNI
          const sniHtml = r.active_sni ? `<div style="font-size:.6rem;color:var(--muted-2);font-family:var(--mono)">${esc(r.active_sni)}</div>` : '';
          return `<tr style="cursor:pointer" onclick="devDetail('${esc(r.device_id)}')" title="Click for device details">
            <td>
              <div style="font-family:var(--mono);font-size:.72rem;color:var(--text);font-weight:600">${esc(uid)}</div>
              <div style="font-size:.6rem;color:var(--muted-2);font-family:var(--mono)" title="Device fingerprint (sha256 of device_id)">FP: ${esc(r.device_id_short||'')}</div>
              ${r.referral_code?`<div style="font-size:.6rem;color:var(--emerald);font-family:var(--mono)" title="Invite/referral code">INV: ${esc(r.referral_code)}</div>`:''}
              ${r.blocked?'<span class="badge badge-danger" style="margin-left:0">blocked</span>':''}
            </td>
            <td><span class="badge ${r.plan==='premium'?'badge-accent':'badge-muted'}">${esc(r.plan)}</span></td>
            <td>
              <div style="font-size:.7rem;margin-bottom:.2rem">${fmtBytes(Math.min(r.quota_bytes_used,r.quota_bytes_total))} / ${fmtBytes(r.quota_bytes_total)}</div>
              <div class="progress" style="width:80px"><div class="progress-bar ${usedPct>=100?'danger':usedPct>70?'warn':'ok'}" style="width:${usedPct}%"></div></div>
            </td>
            <td><span class="dot ${r.status==='online'?'dot-ok':'dot-unk'}" style="display:inline-block"></span> ${esc(r.status)}</td>
            <td>${protoBadge(r.active_protocol)}${sniHtml}</td>
            <td class="mobile-hide">${rxtxHtml}</td>
            <td class="mobile-hide">${connHtml}</td>
            <td class="mobile-hide" style="font-size:.7rem">${failBadge}</td>
            <td class="mobile-hide" style="font-size:.75rem">${srcCtry}<div style="font-size:.6rem;color:var(--muted-2);font-family:var(--mono)">${srcIp}</div></td>
            <td class="mobile-hide" style="font-size:.72rem;color:var(--muted-2)">${fmtRelative(r.last_seen)}</td>
            <td>
              <div style="display:flex;gap:.25rem">
                <button class="btn btn-ghost btn-sm" title="${r.blocked?'Unblock':'Block'}"
                  onclick="event.stopPropagation();devBlock('${esc(r.device_id)}','${r.blocked?'unblock':'block'}')"
                  style="color:${r.blocked?'var(--ok)':'var(--warn)'}">
                  ${r.blocked?'Unblock':'Block'}
                </button>
                <button class="btn btn-ghost btn-sm" title="Set Quota"
                  onclick="event.stopPropagation();devSetQuota('${esc(r.device_id)}','${esc(uid)}')">Quota</button>
              </div>
            </td>
          </tr>`;
        }).join('');
  },
  async loadMessages() {
    try {
      const d = await api.get('messages-list');
      const rows = d.messages||[];
      $('msgListPanel').innerHTML = rows.length ? rows.map(m=>`
        <div style="display:flex;gap:.6rem;align-items:baseline;font-size:.74rem;padding:.25rem 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted-2);font-family:var(--mono);font-size:.66rem">${fmtRelative(m.created_at)}</span>
          <span class="badge ${m.target_device_id?'badge-accent':'badge-muted'}">${m.target_device_id?esc(m.target_user_id||m.target_device_id.substring(0,14)):'all'}</span>
          <span style="flex:1">${m.title?`<strong>${esc(m.title)}</strong> — `:''}${esc(m.body)}</span>
          <span style="color:var(--muted-2);font-size:.66rem" title="devices that have seen it">✓ ${m.ack_count}</span>
        </div>`).join('')
        : '<p style="font-size:.74rem;color:var(--muted-2)">No messages sent yet</p>';
    } catch(e) {
      $('msgListPanel').innerHTML = `<p style="font-size:.74rem;color:var(--muted-2)">${esc(e.message)}</p>`;
    }
  },
  async loadTraffic() {
    try {
      const t = await api.get('traffic-categories');
      const cats = Object.entries(t.categories||{});
      const max  = Math.max(1, ...cats.map(c=>c[1]));
      $('devTrafficPanel').innerHTML = cats.length ? cats.map(([k,v])=>`
        <div style="display:flex;align-items:center;gap:.6rem;font-size:.74rem;padding:.18rem 0">
          <span style="width:90px">${esc(k)}</span>
          <div class="progress" style="flex:1"><div class="progress-bar ok" style="width:${Math.round(v/max*100)}%"></div></div>
          <span style="width:60px;text-align:right;font-family:var(--mono)">${fmtNum(v)}</span>
        </div>`).join('')
        : '<p style="font-size:.74rem;color:var(--muted-2)">No traffic data in the current logs</p>';
    } catch(e) {
      $('devTrafficPanel').innerHTML = `<p style="font-size:.74rem;color:var(--muted-2)">${esc(e.message)}</p>`;
    }
  },
  async loadPayments() {
    const sf = $('payFilter').value;
    try {
      const d = await api.get('payment-queue', {status:sf});
      const rows = d.payments||[];
      $('payTbl').innerHTML = !rows.length
        ? '<tr><td colspan="9" class="tbl-empty">No payments</td></tr>'
        : rows.map(r=>`<tr>
            <td>${r.id}</td>
            <td class="mono" style="font-size:.7rem;color:var(--emerald)">${esc(r.matched_user_id||r.user_id||'—')}</td>
            <td class="mono mobile-hide" style="font-size:.65rem;color:var(--muted-2)">${esc((r.device_id||'').substring(0,14)+'…')}</td>
            <td><span class="badge badge-info">${esc(r.package)}</span></td>
            <td>${r.amount_usdt||'—'} USDT</td>
            <td class="mono mobile-hide" style="font-size:.68rem">${esc((r.tx_hash||'—').substring(0,14)+'…')}</td>
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
window.devDetail = async function(did) {
  $('devDetailTitle').textContent = 'Device';
  $('devDetailBody').innerHTML = '<p style="font-size:.8rem;color:var(--muted-2)">Loading…</p>';
  openModal('modalDevice');
  try {
    const d = await api.get('device-detail', {device_id: did});
    const dev = d.device || {};
    const uid = dev.user_id || did.substring(0,16);
    $('devDetailTitle').textContent = `${countryFlag(dev.country||'')} ${uid}`.trim();
    $('devMsgBtn').style.display = '';
    $('devMsgBtn').onclick = ()=>devMessage(did, uid);
    const kv = (k,v) => `<div style="display:flex;justify-content:space-between;gap:1rem;padding:.28rem 0;border-bottom:1px solid var(--border);font-size:.76rem"><span style="color:var(--muted-2)">${k}</span><span style="text-align:right;font-family:var(--mono)">${v||'—'}</span></div>`;
    const gb = n => fmtBytes(n||0);
    const devRows = [
      kv('Model', esc((dev.manufacturer?dev.manufacturer+' ':'')+(dev.model||''))),
      kv('Android', esc(dev.android_version ? `${dev.android_version} (SDK ${dev.sdk_version||'?'})` : (dev.sdk_version?`SDK ${dev.sdk_version}`:''))),
      kv('ABI', esc(dev.abi||'') || '<span style="color:var(--muted-2)">unknown — fills on next app launch</span>'),
      kv('App version', esc(dev.app_version)),
      kv('Language', esc(dev.language)),
      kv('Country', (dev.country_name||dev.country)
            ? `${countryFlag(dev.country||'')} ${esc(dev.country_name||dev.country||'')}`
              + (dev.country_updated_at ? `<span style="color:var(--muted-2);font-size:.7rem"> · updated ${fmtRelative(dev.country_updated_at)}</span>` : '')
              + (dev.first_country && dev.first_country!==dev.country ? `<div style="font-size:.7rem;color:var(--muted-2)">first seen: ${countryFlag(dev.first_country)} ${esc(dev.first_country)}</div>` : '')
            : '<span style="color:var(--muted-2)">Unknown</span>'),
      kv('Real IP', esc(dev.last_ip) || '<span style="color:var(--muted-2)">unknown — all requests came via VPN tunnel</span>'),
      kv('Status', dev.is_online ? '<span style="color:var(--ok)">● online</span>' : '○ offline'),
      kv('Protocol / SNI', `${esc(dev.active_protocol||'')} ${esc(dev.active_sni||'')}`),
      kv('Quota', `${dev.quota_bytes_used>0?gb(dev.quota_bytes_used):'0 B'} / ${gb(dev.quota_bytes_total)} (${esc(dev.plan)})`),
      kv('Referral code', esc(dev.referral_code)),
      kv('First seen', esc(dev.created_at)),
      kv('Last seen', `${esc(dev.last_seen)} (${fmtRelative(dev.last_seen)})`),
    ].join('');
    const sess = (d.sessions||[]).slice(0,10).map(s=>`<tr>
        <td style="font-size:.68rem">${fmtRelative(s.ended_at)}</td>
        <td style="font-size:.68rem">${protoBadge(s.protocol)}</td>
        <td style="font-size:.68rem;font-family:var(--mono)">↓${fmtBytes(s.bytes_recv)} ↑${fmtBytes(s.bytes_sent)}</td>
        <td style="font-size:.68rem">${Math.round((s.duration_secs||0)/60)}m</td>
        <td style="font-size:.68rem">${s.via_vpn?'<span title="report sent through the tunnel — exits xray locally">via VPN</span>':esc(s.client_ip||'—')}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="tbl-empty">No sessions reported</td></tr>';
    $('devDetailBody').innerHTML = `
      ${devRows}
      <div style="margin-top:.9rem;font-size:.72rem;font-weight:600;color:var(--muted)">RECENT SESSIONS <span style="font-weight:400;color:var(--muted-2)">— this device only</span></div>
      <table class="tbl" style="margin-top:.3rem"><thead><tr>
        <th>When</th><th>Protocol</th><th>Traffic</th><th>Duration</th><th>Reported from</th>
      </tr></thead><tbody>${sess}</tbody></table>
      <p style="margin-top:.7rem;font-size:.68rem;color:var(--muted-2)">Per-device app breakdown (Instagram/Telegram…) is not collected yet —
      all clients share one xray identity. The combined view for all users is on the Devices page.</p>`;
  } catch(e) {
    $('devDetailBody').innerHTML = `<p style="font-size:.8rem;color:var(--danger)">${esc(e.message)}</p>`;
  }
};
window.devMessage = function(did, label) {
  views.devices.msgTargetId = did || '';
  $('msgTarget').textContent = label || (did ? did.substring(0,20) : 'all devices');
  $('msgTitle').value = '';
  $('msgBody').value  = '';
  closeModal();
  openModal('modalMessage');
};
$('msgSend').onclick = async()=>{
  const body = $('msgBody').value.trim();
  if (!body) { toast('Message body required','error'); return; }
  try {
    const r = await api.post({action:'send-message', device_id: views.devices.msgTargetId||'',
                              title: $('msgTitle').value.trim(), body_text: body});
    closeModal();
    toast(`Message queued for ${r.target}`,'ok');
    views.devices.loadMessages();
  } catch(e) { toast(e.message,'error'); }
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
    // Download symlinks — one per APK variant users can choose on the site
    const links = d.download_symlinks || [{...(d.download_symlink||{}), name:'setalink-latest.apk', label:'arm64 (default)'}];
    $('dlSymlinkInfo').innerHTML = links.map(dl => `
      <div style="display:flex;align-items:center;gap:.75rem;font-size:.8rem;margin-bottom:.25rem">
        <span class="dot ${dl.valid?'dot-ok':'dot-bad'}"></span>
        <span class="badge badge-muted" style="min-width:9.5rem;text-align:center">${esc(dl.label||'')}</span>
        <span class="mono">/download/${esc(dl.name)}</span>
        <span style="color:var(--muted)">→</span>
        <span class="mono">${esc(dl.target||'(not set)')}</span>
        <span class="badge ${dl.valid?'badge-ok':'badge-danger'}">${dl.valid?'valid':'BROKEN'}</span>
      </div>`).join('');

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

    // Force Update / Rollout form — populate from version_json
    if (vj) {
      $('vjForceUpdate').checked   = !!vj.forceUpdate;
      $('vjMinSupported').value    = vj.minSupported || '0.9.7';
      const strategy = (vj.rollout && vj.rollout.strategy) ? vj.rollout.strategy : 'all';
      $('vjRolloutStrategy').value = strategy;
      $('vjRolloutPercent').value  = (vj.rollout && vj.rollout.percent) ? vj.rollout.percent : 100;
    }

    // Emergency profiles — populate from remote-config if present
    api.get('get-remote-config').then(rc => {
      const ep = rc.emergency_profiles || [];
      $('emergencyProfilesJson').value = JSON.stringify(ep, null, 2);
    }).catch(()=>{});

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
            ${a.variant?`<span class="badge ${a.variant==='arm64'?'badge-ok':a.variant==='arm32'?'badge-warn':'badge-info'}">${esc(a.variant)}</span>`:''}
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

$('apkCleanupBtn').addEventListener('click', async () => {
  $('confirmTitle').textContent = 'Cleanup Old APKs';
  $('confirmMsg').textContent   = 'Keep only the 3 newest APKs per channel and repair all symlinks. Old APKs will be deleted permanently.';
  $('confirmOk').className      = 'btn btn-danger';
  openModal('modalConfirm');
  $('confirmOk').onclick = async () => {
    closeModal();
    const btn = $('apkCleanupBtn');
    btn.disabled = true; btn.textContent = 'Cleaning…';
    try {
      const d = await api.post({action:'apk-cleanup'});
      const lines = Object.entries(d.results||{}).map(([ch,r])=>{
        if (r.skipped) return `${ch}: skipped`;
        return `${ch}: kept ${r.kept}, deleted ${r.deleted}${r.newest?` → ${r.newest}`:''}`;
      });
      toast(`Cleanup done — ${lines.join(' | ')}`, 'ok');
      views.release.init();
    } catch(e) { toast(`Cleanup failed: ${e.message}`, 'error'); }
    finally { btn.disabled=false; btn.innerHTML = `${icon_str('trash')} Cleanup Old APKs`; }
  };
});

// Force Update / Rollout save
$('vjSaveBtn').addEventListener('click', async()=>{
  const strategy = $('vjRolloutStrategy').value;
  const percent  = Math.min(100, Math.max(1, parseInt($('vjRolloutPercent').value, 10) || 100));
  const rollout = {
    strategy,
    countries: strategy === 'iran_first' ? ['IR'] : (strategy === 'all' ? [] : ['IR']),
    percent,
    exclude_countries: [],
  };
  try {
    $('vjSaveStatus').textContent = 'Saving…';
    await api.post({
      action:       'update-version-json',
      forceUpdate:  $('vjForceUpdate').checked,
      minSupported: $('vjMinSupported').value.trim() || '0.9.7',
      rollout,
    });
    $('vjSaveStatus').textContent = 'Saved!';
    toast('Version settings saved','ok');
    setTimeout(()=>{ $('vjSaveStatus').textContent=''; }, 3000);
  } catch(e) {
    $('vjSaveStatus').textContent = 'Error: ' + e.message;
    toast('Save failed: '+e.message,'error');
  }
});

// Push Emergency Profiles
$('pushEmergencyProfilesBtn').addEventListener('click', async()=>{
  let profiles;
  try {
    profiles = JSON.parse($('emergencyProfilesJson').value || '[]');
  } catch(e) {
    toast('Invalid JSON: '+e.message,'error');
    return;
  }
  if (!Array.isArray(profiles)) { toast('Must be a JSON array','error'); return; }
  try {
    $('emergencyPushStatus').textContent = 'Pushing…';
    const r = await api.post({action:'push-emergency-profiles', profiles});
    $('emergencyPushStatus').textContent = `Pushed ${r.saved} profile(s)`;
    toast(`Emergency profiles pushed (${r.saved})`, 'ok');
    setTimeout(()=>{ $('emergencyPushStatus').textContent=''; }, 4000);
  } catch(e) {
    $('emergencyPushStatus').textContent = 'Error: '+e.message;
    toast('Push failed: '+e.message,'error');
  }
});
// Inline icon string helper (for JS-rendered HTML)
function icon_str(name) {
  const map={
    download:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    trash:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    person:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
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

// ── VIEW: REFERRALS ──────────────────────────────────────────────────
views.referrals = {
  init() { this.load(); refreshTimer = setInterval(()=>this.load(), 30000); },
  async load() {
    try {
      const d = await api.get('referral-stats');
      $('refTotal').textContent      = fmtNum(d.total_referrals);
      $('refFlagged').textContent    = d.flagged_referrals > 0 ? `⚠ ${d.flagged_referrals} flagged` : 'all-time conversions';
      $('refInviters').textContent   = fmtNum(d.unique_referrers);
      $('refIran').textContent       = d.iran_referrals > 0 ? `${d.iran_referrals} from Iran 🇮🇷` : 'devices that referred';
      $('refConversion').textContent = d.conversion_rate + '%';
      $('refConvSub').textContent    = `${fmtNum(d.referred_devices)} / ${fmtNum(d.total_devices)} devices`;
      const gb = d.total_bonus_gb;
      $('refBonus').textContent = gb >= 1 ? gb.toFixed(1)+' GB' : Math.round(d.total_bonus_bytes/1048576)+' MB';
      $('refStealth').textContent = fmtNum(d.stealth_unlocked);
      $('refPending').textContent  = fmtNum(d.pending_referrals || 0);
      $('refRejected').textContent = (d.rejected_referrals||0) > 0
        ? `${d.rejected_referrals} rejected all-time` : 'held rewards';
      this.renderPendingQueue(d.pending_queue || []);
      this.renderAuditLog(d.audit_log || []);
      this.renderLeaderboard(d.top_inviters || []);
      this.renderByCountry(d.by_country || []);
      this.renderRecent(d.recent_referrals || []);
    } catch(e) { toast(e.message,'error'); }
  },
  renderPendingQueue(rows) {
    const panel = $('refPendingPanel');
    panel.hidden = !rows.length;
    if (!rows.length) return;
    $('refPendingQueue').innerHTML = rows.map(r => {
      const flags = (r.risk_flags||[]).join(', ');
      const sameIp = r.referrer_ip && r.referrer_ip === r.new_user_ip;
      return `<tr style="background:rgba(255,184,0,.05)">
        <td style="font-size:.72rem;color:var(--muted)">${esc((r.ts||'').slice(0,16).replace('T',' '))}</td>
        <td class="mono" style="font-size:.72rem">${esc(r.referrer_user_id||'—')}<div style="font-size:.62rem;color:var(--muted-2)">${countryFlag(r.referrer_country||'')} ${esc(r.referrer_country||'')}</div></td>
        <td><span class="badge badge-info">${esc(r.referral_code||'—')}</span></td>
        <td class="mono" style="font-size:.72rem">${esc(r.new_user_id||'—')}<div style="font-size:.62rem;color:var(--muted-2)">${countryFlag(r.new_country||'')} ${esc(r.new_country||'')}</div></td>
        <td style="font-size:.68rem;color:var(--muted)">${esc(r.new_model||'—')}</td>
        <td class="mono" style="font-size:.62rem;color:${sameIp?'var(--danger)':'var(--muted)'}">${esc(r.referrer_ip||'—')}<br>${esc(r.new_user_ip||'—')}${sameIp?' ⚠':''}</td>
        <td style="font-weight:700;color:var(--danger)">${r.risk_score}<div style="font-size:.6rem;font-weight:400;color:var(--warn)">${esc(flags)}</div></td>
        <td style="font-size:.72rem;color:var(--muted)">${r.bonus_gb.toFixed(0)} GB held</td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-sm" onclick="views.referrals.review(${r.id},'approve',this)">✓ Approve</button>
          <button class="btn btn-secondary btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="views.referrals.review(${r.id},'reject',this)">✗ Reject</button>
        </td>
      </tr>`;
    }).join('');
  },
  async review(id, decision, btn) {
    if (decision === 'reject' && !confirm('Reject this referral? The reward is permanently denied.')) return;
    btn.disabled = true;
    try {
      const r = await api.post({action: decision === 'approve' ? 'referral-approve' : 'referral-reject', id});
      toast(decision === 'approve'
        ? `Approved — ${(r.bonus_bytes/1073741824).toFixed(0)} GB granted to both devices`
        : 'Rejected — reward denied', 'ok');
      this.init();   // reload queue, stats, audit log
    } catch(e) { toast(`${decision} failed: ${e.message}`,'error'); btn.disabled = false; }
  },
  renderAuditLog(rows) {
    const el = $('refAuditLog');
    if (!rows.length) { el.innerHTML = '<tr><td colspan="5" class="tbl-empty">No review decisions yet</td></tr>'; return; }
    el.innerHTML = rows.map(r => `<tr>
      <td style="font-size:.72rem;color:var(--muted)">${esc((r.acted_at||'').slice(0,16).replace('T',' '))}</td>
      <td class="mono" style="font-size:.72rem">#${r.referral_id}</td>
      <td>${r.action==='approve'?'<span class="badge badge-ok">approved</span>':'<span class="badge badge-danger">rejected</span>'}</td>
      <td style="font-size:.75rem">${esc(r.acted_by||'admin')}</td>
      <td style="font-size:.68rem;color:var(--muted)">${esc(r.detail||'')}</td>
    </tr>`).join('');
  },
  renderLeaderboard(rows) {
    const el = $('refLeaderboard');
    if (!rows.length) { el.innerHTML = '<tr><td colspan="8" class="tbl-empty">No referrals yet</td></tr>'; return; }
    el.innerHTML = rows.map((r,i) => `<tr${r.flagged_count>0?' style="opacity:.7"':''}>
      <td style="color:var(--muted);font-size:.75rem">${i+1}</td>
      <td class="mono" style="font-size:.72rem">${esc(r.user_id||'—')}</td>
      <td><span class="badge badge-info">${esc(r.referral_code||'—')}</span></td>
      <td style="font-size:.75rem">${esc(r.country||'—')}</td>
      <td style="font-weight:700;color:var(--ok)">${r.invite_count}</td>
      <td style="color:${r.active_invites>=3?'var(--ok)':'var(--muted)'};font-weight:${r.active_invites>=3?'700':'400'}">${r.active_invites}</td>
      <td style="color:var(--muted);font-size:.75rem">${r.total_bonus_gb>=1?r.total_bonus_gb.toFixed(1)+' GB':Math.round(r.total_bonus_bytes/1048576)+' MB'}</td>
      <td>${r.stealth_unlocked?'<span class="badge badge-ok">🔓 ON</span>':'<span style="color:var(--muted-2);font-size:.7rem">—</span>'}</td>
    </tr>`).join('');
  },
  renderByCountry(rows) {
    const el = $('refByCountry');
    if (!rows.length) { el.innerHTML = '<tr><td colspan="3" class="tbl-empty">No data</td></tr>'; return; }
    el.innerHTML = rows.map(r => `<tr>
      <td style="font-weight:600">${esc(r.country||'Unknown')}</td>
      <td style="color:var(--ok);font-weight:700">${r.referral_count}</td>
      <td style="color:var(--muted)">${r.unique_new_users}</td>
    </tr>`).join('');
  },
  renderRecent(rows) {
    const el = $('refRecent');
    if (!rows.length) { el.innerHTML = '<tr><td colspan="8" class="tbl-empty">No referrals yet</td></tr>'; return; }
    el.innerHTML = rows.map(r => {
      const flags = (r.risk_flags||[]).join(', ');
      // Status semantics: credited/approved = granted; pending = HELD (no
      // reward yet); rejected = denied forever; flagged = legacy auto-credit.
      const statusBadge =
        r.status==='pending'  ? '<span class="badge badge-warn">Pending Review</span>' :
        r.status==='rejected' ? '<span class="badge badge-danger">Rejected</span>'     :
        r.status==='approved' ? '<span class="badge badge-ok">Approved ✓</span>'       :
        r.status==='flagged'  ? '<span class="badge badge-danger">flagged (legacy)</span>' :
                                '<span class="badge badge-ok">Approved</span>';
      const rowTint =
        r.status==='pending'  ? ' style="background:rgba(255,184,0,.05)"' :
        r.status==='rejected' ? ' style="background:rgba(200,16,46,.06);opacity:.65"' :
        r.status==='flagged'  ? ' style="background:rgba(200,16,46,.06)"' : '';
      // Pending/rejected rows never granted anything — show held/denied, not GB
      const bonusCell =
        r.status==='pending'  ? `<span style="color:var(--warn)">${r.bonus_gb.toFixed(0)} GB held</span>` :
        r.status==='rejected' ? '<span style="color:var(--muted-2)">denied</span>' :
        `<span style="color:var(--ok)">${r.bonus_gb>=1?r.bonus_gb.toFixed(0)+' GB':Math.round(r.bonus_bytes/1048576)+' MB'}</span>`;
      return `<tr${rowTint}>
        <td style="font-size:.72rem;color:var(--muted)">${esc((r.ts||'').slice(0,16).replace('T',' '))}</td>
        <td class="mono" style="font-size:.72rem">${esc(r.referrer_user_id||'—')}</td>
        <td><span class="badge badge-info">${esc(r.ref_code||'—')}</span></td>
        <td class="mono" style="font-size:.72rem">${esc(r.new_user_id||'—')}</td>
        <td style="font-size:.75rem">${esc(r.new_country||'—')}</td>
        <td style="font-size:.75rem">${bonusCell}</td>
        <td>${statusBadge}</td>
        <td style="font-size:.72rem;color:${r.risk_score>50?'var(--danger)':r.risk_score>0?'var(--warn)':'var(--muted)'}">
          ${r.risk_score>0?r.risk_score+(flags?' · '+esc(flags):''):'—'}
        </td>
      </tr>`;
    }).join('');
  },
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
