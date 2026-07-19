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
if (!in_array($page, ['dashboard','analytics','ads','payments','iran','intel','aidiag','installs','devices','logs','release','config','referrals','insights','seoranks','starlink','tunnellogs','hakim','wallet','profile'], true)) $page = 'dashboard';

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
  <title>RealGram Admin</title>
  <link rel="icon" href="/assets/logo/realgram/favicon.ico">
  <link rel="stylesheet" href="style.css">
</head>
<body>

<div class="layout">

<!-- ── Sidebar overlay (mobile backdrop) ───────────────────────────── -->
<div class="sidebar-overlay" id="sidebarOverlay"></div>

<!-- ── Sidebar ──────────────────────────────────────────────────────── -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-logo">
    <img src="/assets/logo/realgram/logo-mark-connected-32.png" alt="RealGram">
    <div>
      <div class="sidebar-logo-text">RealGram</div>
      <div class="sidebar-logo-sub">Admin Panel</div>
    </div>
  </div>
  <nav class="sidebar-nav">

    <!-- ── 📊 Dashboard ── -->
    <div class="nav-item<?= $page==='dashboard'?' active':'' ?>" data-page="dashboard">
      <?= icon('grid') ?> Dashboard
    </div>

    <!-- ── 👥 Users ── -->
    <div class="nav-section">👥 Users</div>
    <div class="nav-item<?= $page==='devices'?' active':'' ?>" data-page="devices">
      <?= icon('devices') ?> Devices
    </div>
    <div class="nav-item<?= $page==='insights'?' active':'' ?>" data-page="insights">
      <?= icon('globe') ?> User Insights
    </div>
    <div class="nav-item<?= $page==='installs'?' active':'' ?>" data-page="installs">
      <?= icon('download') ?> Install Diagnostics
    </div>
    <div class="nav-item<?= $page==='profile'?' active':'' ?>" data-page="profile">
      <?= icon('devices') ?> Profiles
    </div>

    <!-- ── 🌐 Freedom Network ── -->
    <div class="nav-section">🌐 Freedom Network</div>
    <div class="nav-item<?= $page==='iran'?' active':'' ?>" data-page="iran">
      <?= icon('globe') ?> Censorship Debug
    </div>
    <div class="nav-item<?= $page==='intel'?' active':'' ?>" data-page="intel">
      <?= icon('chart') ?> AI Routing Intel
    </div>
    <div class="nav-item<?= $page==='starlink'?' active':'' ?>" data-page="starlink">
      🛰️ Starlink Node
    </div>
    <div class="nav-item<?= $page==='aidiag'?' active':'' ?>" data-page="aidiag">
      <?= icon('chart') ?> AI Diagnostics
    </div>
    <div class="nav-item<?= $page==='tunnellogs'?' active':'' ?>" data-page="tunnellogs">
      <?= icon('log') ?> Tunnel Logs
    </div>

    <!-- ── 💰 Economy ── -->
    <div class="nav-section">💰 Economy</div>
    <div class="nav-item<?= $page==='ads'?' active':'' ?>" data-page="ads">
      <?= icon('dollar') ?> Ads (AdsGram · AdMob)
    </div>
    <div class="nav-item<?= $page==='payments'?' active':'' ?>" data-page="payments">
      <?= icon('card') ?> Payments &amp; Packages
    </div>
    <div class="nav-item<?= $page==='referrals'?' active':'' ?>" data-page="referrals">
      <?= icon('gift') ?> Referrals
    </div>
    <div class="nav-item<?= $page==='wallet'?' active':'' ?>" data-page="wallet">
      💎 REAL Wallet
    </div>

    <!-- ── 🎮 Community ── -->
    <div class="nav-section">🎮 Community</div>
    <div class="nav-item<?= $page==='hakim'?' active':'' ?>" data-page="hakim">
      📖 Shahnameh AI (Hakim)
    </div>

    <!-- ── 🛠 System ── -->
    <div class="nav-section">🛠 System</div>
    <div class="nav-item<?= $page==='release'?' active':'' ?>" data-page="release">
      <?= icon('package') ?> Release &amp; OTA
    </div>
    <div class="nav-item<?= $page==='config'?' active':'' ?>" data-page="config">
      <?= icon('settings') ?> Config
    </div>
    <div class="nav-item<?= $page==='logs'?' active':'' ?>" data-page="logs">
      <?= icon('log') ?> Logs
    </div>

    <!-- ── 📈 Analytics ── -->
    <div class="nav-section">📈 Analytics</div>
    <div class="nav-item<?= $page==='analytics'?' active':'' ?>" data-page="analytics">
      <?= icon('chart') ?> Growth &amp; Usage
    </div>
    <div class="nav-item<?= $page==='seoranks'?' active':'' ?>" data-page="seoranks">
      <?= icon('chart') ?> SEO Ranks
    </div>
    <div class="nav-item<?= $page==='tapstream'?' active':'' ?>" data-page="tapstream">
      <?= icon('chart') ?> Tap Stream
    </div>

  </nav>
  <div class="sidebar-footer">RealGram v0.9.67 &middot; <?= h($auth_user) ?></div>
</aside>

<!-- ── Main ─────────────────────────────────────────────────────────── -->
<main class="main">
  <div class="topbar">
    <button class="menu-toggle btn btn-icon btn-ghost" id="menuToggle"><?= icon('menu') ?></button>
    <span class="topbar-title" id="pageTitle">Dashboard</span>
    <span class="topbar-sub" id="pageSub"></span>
    <div class="gsearch" id="gSearchWrap">
      <input class="input gsearch-input" id="gSearch" type="search" placeholder="Find user… (part of an ID works)" autocomplete="off" spellcheck="false">
      <div class="gsearch-drop" id="gSearchDrop" hidden></div>
    </div>
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

      <!-- Platform breakdown -->
      <div class="stat-grid" style="margin-top:.5rem">
        <div class="stat-card"><div class="stat-label">🍎 iOS Devices</div><div class="stat-value" id="anaIos">—</div><div class="stat-sub">TestFlight / App Store</div></div>
        <div class="stat-card"><div class="stat-label">🤖 Android Devices</div><div class="stat-value" id="anaAndroid">—</div><div class="stat-sub">total registered</div></div>
        <div class="stat-card"><div class="stat-label">iOS Tunnel OK</div><div class="stat-value" id="anaIosOk">—</div><div class="stat-sub" id="anaIosFail">— failed</div></div>
        <div class="stat-card"><div class="stat-label">iOS Stage Failures</div><div class="stat-value" id="anaIosStages">—</div><div class="stat-sub">from tunnel logs</div></div>
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
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> App Versions <span class="panel-sub">Android top 10</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chVer"></canvas></div></div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">🍎 iOS Versions <span class="panel-sub">by app version + build</span></span></div>
          <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chIosVer"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">🍎 iOS Tunnel Stage Failures <span class="panel-sub">from uploaded logs</span></span></div>
          <div class="panel-body" id="iosStagePanel"><div class="panel-empty">No stage failures logged yet</div></div>
        </div>
      </div>

      <!-- iOS recent devices table -->
      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">🍎 iOS Recent Devices</span></div>
        <div class="panel-body" style="overflow-x:auto">
          <table class="tbl" id="iosRecentTbl">
            <thead><tr><th>Device ID</th><th>App Version</th><th>Model</th><th>Last Seen</th></tr></thead>
            <tbody id="iosRecentBody"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- Google Analytics (GA4) — real users/pages/geo from Google,   -->
      <!-- separate from SEO Ranks (search-query positions). Source:    -->
      <!-- admin/api.php?action=ga4-summary / ga4-sync (B-24 follow-up, -->
      <!-- Khabat 2026-07-19). -->
      <!-- ============================================================ -->
      <div class="panel" style="margin-top:1.5rem">
        <div class="panel-header"><span class="panel-title">📊 Google Analytics <span class="panel-sub" id="ga4Status">checking…</span></span></div>
        <div class="panel-body">
          <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
            <label style="font-size:.8rem;color:var(--muted)">GA4 Property ID
              <input type="text" id="ga4Property" class="input" style="width:160px" placeholder="123456789">
            </label>
            <button class="btn btn-ghost" id="ga4SaveBtn" type="button">Save</button>
            <button class="btn btn-primary" id="ga4SyncBtn" type="button">Sync from Google Analytics</button>
            <span id="ga4Msg" style="font-size:.8rem;color:var(--muted);align-self:center"></span>
          </div>
          <div id="ga4Setup" style="display:none;margin-top:.7rem;font-size:.78rem;color:var(--muted-2);line-height:1.7">
            <strong>Not connected yet.</strong> One-time setup: 1) Google Cloud → enable "Google Analytics Data API"
            (reuses the same service account as Search Console). 2) In Google Analytics → Admin → Property Access
            Management for the property (e.g. realgram.no) → add <code>realink-gsc@real-499116.iam.gserviceaccount.com</code>
            with <em>Viewer</em> access — this is a separate grant from Search Console, both are needed for their
            own integrations. 3) Find the numeric Property ID (Admin → Property Settings), enter it above, Save,
            then Sync.
          </div>
        </div>
      </div>

      <div class="stat-grid" style="margin-top:.7rem" id="ga4Totals">
        <div class="stat-card"><div class="stat-label">Active Users</div><div class="stat-value" id="ga4Users">—</div><div class="stat-sub" id="ga4DaysSub">last 30d</div></div>
        <div class="stat-card"><div class="stat-label">New Users</div><div class="stat-value" id="ga4NewUsers">—</div><div class="stat-sub">last 30d</div></div>
        <div class="stat-card"><div class="stat-label">Page Views</div><div class="stat-value" id="ga4Views">—</div><div class="stat-sub">last 30d</div></div>
        <div class="stat-card"><div class="stat-label">Avg Session</div><div class="stat-value" id="ga4AvgSession">—</div><div class="stat-sub">duration</div></div>
      </div>

      <div class="panel" style="margin-top:.7rem">
        <div class="panel-header"><span class="panel-title"><?= icon('chart') ?> Active Users <span class="panel-sub">per day</span></span></div>
        <div class="panel-body"><div style="position:relative;height:280px"><canvas id="chGa4Users"></canvas></div></div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">📄 Top Pages</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Page</th><th>Views</th></tr></thead>
              <tbody id="ga4PagesTbl"><tr><td colspan="2" class="tbl-empty">Not synced yet</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Geography</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Country</th><th>Users</th></tr></thead>
              <tbody id="ga4GeoTbl"><tr><td colspan="2" class="tbl-empty">Not synced yet</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:.7rem">
        <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> By Data Stream <span class="panel-sub">web / iOS / Android — all streams on this GA4 property</span></span></div>
        <div class="panel-body" style="overflow-x:auto">
          <table class="tbl"><thead><tr><th>Platform</th><th>Stream</th><th>Users</th><th>Views</th></tr></thead>
            <tbody id="ga4PlatformTbl"><tr><td colspan="4" class="tbl-empty">Not synced yet</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: USER INSIGHTS                                          -->
    <!-- Aggregate, privacy-safe. Source: admin/api.php?action=user-  -->
    <!-- insights. No per-user destination logging: carriers are      -->
    <!-- ASN-derived operator names, reachability is the app's own    -->
    <!-- connectivity probes. See public/api.php normalize_carrier(). -->
    <!-- ============================================================ -->
    <div data-view="tapstream" hidden>
      <div class="stat-grid" id="tapTotals">
        <div class="stat-card"><div class="stat-label">Total Taps</div><div class="stat-value" id="tapTotalTaps">—</div><div class="stat-sub" id="tapDaysSub">last 7d</div></div>
        <div class="stat-card"><div class="stat-label">Devices Tapping</div><div class="stat-value" id="tapDevices">—</div><div class="stat-sub">unique device_id</div></div>
      </div>
      <div class="two-col" style="margin-top:1rem">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">📱 By Screen</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Screen</th><th>Taps</th></tr></thead>
              <tbody id="tapScreenTbl"><tr><td colspan="2" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">🎯 By Element</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Screen</th><th>Element</th><th>Taps</th></tr></thead>
              <tbody id="tapElementTbl"><tr><td colspan="3" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div data-view="insights" hidden>
      <div class="stat-grid" id="insTotals">
        <div class="stat-card"><div class="stat-label">Total Devices</div><div class="stat-value" id="insTotalDevices">—</div><div class="stat-sub">all registered</div></div>
        <div class="stat-card"><div class="stat-label">Active 24h</div><div class="stat-value" id="insActive24">—</div><div class="stat-sub" id="insActive7">— in 7d</div></div>
        <div class="stat-card"><div class="stat-label">Premium</div><div class="stat-value" id="insPremium">—</div><div class="stat-sub">paid / gifted</div></div>
        <div class="stat-card"><div class="stat-label">Data Volume</div><div class="stat-value" id="insTotalGb">—</div><div class="stat-sub">GB, all sessions</div></div>
        <div class="stat-card"><div class="stat-label">Longest Session</div><div class="stat-value" id="insLongest">—</div><div class="stat-sub">single connection</div></div>
      </div>

      <!-- Reachability: from the app's own connectivity probes (probe_* in -->
      <!-- connect_telemetry), never per-user destination logs. -->
      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Service Reachability <span class="panel-sub" id="insReachSub">from in-app connectivity probes · 30d</span></span></div>
        <div class="panel-body">
          <div class="stat-grid">
            <div class="stat-card"><div class="stat-label">Instagram</div><div class="stat-value" id="insReachInstagram">—</div><div class="stat-sub">% probes OK</div></div>
            <div class="stat-card"><div class="stat-label">Telegram</div><div class="stat-value" id="insReachTelegram">—</div><div class="stat-sub">% probes OK</div></div>
            <div class="stat-card"><div class="stat-label">Google</div><div class="stat-value" id="insReachGoogle">—</div><div class="stat-sub">% probes OK</div></div>
            <div class="stat-card"><div class="stat-label">Cloudflare</div><div class="stat-value" id="insReachCloudflare">—</div><div class="stat-sub">% probes OK</div></div>
            <div class="stat-card"><div class="stat-label">Apple</div><div class="stat-value" id="insReachApple">—</div><div class="stat-sub">% probes OK</div></div>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">📡 Mobile Carriers <span class="panel-sub">ASN-derived · never raw IP</span></span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Carrier</th><th>Devices</th></tr></thead>
              <tbody id="insCarrierTbl"><tr><td colspan="2" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Geography <span class="panel-sub">by country</span></span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Country</th><th>Devices</th></tr></thead>
              <tbody id="insGeoTbl"><tr><td colspan="2" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> Platforms</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Platform</th><th>Devices</th></tr></thead>
              <tbody id="insPlatformTbl"><tr><td colspan="2" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('devices') ?> Device Brands <span class="panel-sub">top 10</span></span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Brand</th><th>Devices</th></tr></thead>
              <tbody id="insBrandTbl"><tr><td colspan="2" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('package') ?> Plans</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Plan</th><th>Devices</th></tr></thead>
              <tbody id="insPlanTbl"><tr><td colspan="2" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('globe') ?> Protocols <span class="panel-sub">sessions · GB</span></span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Protocol</th><th>Sessions</th><th>GB</th></tr></thead>
              <tbody id="insProtocolTbl"><tr><td colspan="3" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">🛰️ Nodes <span class="panel-sub">connects · 30d</span></span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Node</th><th>Connects</th></tr></thead>
              <tbody id="insNodeTbl"><tr><td colspan="2" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> Longest Sessions</span></div>
          <div class="panel-body" style="overflow-x:auto">
            <table class="tbl"><thead><tr><th>Device</th><th>Protocol</th><th>Duration</th><th>MB</th><th>Day</th></tr></thead>
              <tbody id="insLongestTbl"><tr><td colspan="5" class="tbl-empty">—</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: SEO RANKS                                              -->
    <!-- Target keyword positions over time. Source: admin/api.php?    -->
    <!-- action=seo-ranks. Positions are recorded snapshots (manual    -->
    <!-- entry now; can be fed from the Google Search Console API).    -->
    <!-- ============================================================ -->
    <div data-view="seoranks" hidden>
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-body" style="font-size:.82rem;color:var(--muted)">
          Track where target search terms rank on Google over time. Lower position = better (1 = top).
          Real positions come from Google Search Console; you can also log a manual snapshot below.
          <span style="color:var(--muted-2)">Δ vs previous: green = moved up.</span>
        </div>
      </div>

      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">🔎 Google Search Console <span class="panel-sub" id="gscStatus">checking…</span></span></div>
        <div class="panel-body">
          <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
            <label style="font-size:.8rem;color:var(--muted)">Property
              <input type="text" id="gscSite" class="input" style="width:230px" placeholder="https://setalink.no/">
            </label>
            <button class="btn btn-ghost" id="gscSaveBtn" type="button">Save</button>
            <button class="btn btn-primary" id="gscSyncBtn" type="button">Sync from Search Console</button>
            <span id="gscMsg" style="font-size:.8rem;color:var(--muted);align-self:center"></span>
          </div>
          <div id="gscSetup" style="display:none;margin-top:.7rem;font-size:.78rem;color:var(--muted-2);line-height:1.7">
            <strong>Not connected yet.</strong> One-time setup: 1) Google Cloud → enable “Search Console API”, create a
            <em>Service Account</em> → JSON key. 2) In Search Console → Settings → Users → add the service-account e-mail
            (…@….iam.gserviceaccount.com) with read access. 3) Upload the JSON to
            <code>/var/www/setalink/data/gsc-service-account.json</code> (chmod 600). Then click Sync.
          </div>
          <div id="gscUntracked" style="margin-top:.7rem"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title"><?= icon('chart') ?> Position Over Time <span class="panel-sub">lower is better</span></span></div>
        <div class="panel-body"><div style="position:relative;height:320px"><canvas id="seoChart"></canvas></div></div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title"><?= icon('grid') ?> Tracked Keywords <span class="panel-sub" id="seoKwCount">top 10 · Iran intent</span></span></div>
        <div class="panel-body" style="overflow-x:auto">
          <table class="tbl">
            <thead><tr><th>Keyword</th><th>Current</th><th>Δ</th><th>Best</th><th>Points</th><th>Last measured</th></tr></thead>
            <tbody id="seoRankTbl"><tr><td colspan="6" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title"><?= icon('download') ?> Log a Snapshot <span class="panel-sub">enter today's positions · blank = skip</span></span></div>
        <div class="panel-body">
          <div style="display:flex;gap:.6rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap">
            <label style="font-size:.8rem;color:var(--muted)">Date <input type="date" id="seoDate" class="input" style="width:auto"></label>
            <input type="text" id="seoNewKw" class="input" placeholder="+ add a new keyword to track" style="flex:1;min-width:180px">
            <button class="btn btn-ghost" id="seoAddKwBtn" type="button">Add keyword</button>
          </div>
          <div id="seoInputGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.5rem"></div>
          <div style="margin-top:.9rem;display:flex;gap:.6rem">
            <button class="btn btn-primary" id="seoSaveBtn" type="button">Save snapshot</button>
            <span id="seoSaveMsg" style="font-size:.8rem;color:var(--muted);align-self:center"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: ADS & REVENUE                                          -->
    <!-- ============================================================ -->
    <div data-view="ads" hidden>

      <!-- ── NOC Alerts ────────────────────────────────────────────── -->
      <div id="nocAlertBar" style="display:none;margin-bottom:.75rem"></div>

      <!-- ── Filter bar ─────────────────────────────────────────────── -->
      <div class="panel" style="padding:.45rem 1rem;margin-bottom:.9rem">
        <div style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap">
          <span style="font-size:.73rem;opacity:.5;white-space:nowrap">Periode:</span>
          <button class="btn btn-ghost btn-sm noc-filter" data-days="1">I dag</button>
          <button class="btn btn-ghost btn-sm noc-filter" data-days="7">7 d</button>
          <button class="btn btn-ghost btn-sm noc-filter active" data-days="30">30 d</button>
          <button class="btn btn-ghost btn-sm noc-filter" data-days="60">60 d</button>
          <button class="btn btn-ghost btn-sm noc-filter" data-days="custom">Egendefinert</button>
          <div id="nocCustomRange" style="display:none;gap:.3rem;align-items:center">
            <input type="date" id="nocFrom" class="input" style="padding:.2rem .45rem;font-size:.78rem;height:auto">
            <span style="opacity:.4">→</span>
            <input type="date" id="nocTo"   class="input" style="padding:.2rem .45rem;font-size:.78rem;height:auto">
            <button class="btn btn-sm" id="nocCustomApply">Bruk</button>
          </div>
          <div style="margin-left:auto;display:flex;gap:.4rem;align-items:center">
            <span style="font-size:.7rem;opacity:.4" id="nocTs"></span>
            <button class="btn btn-ghost btn-sm" id="adsNocRefresh"><?= icon('refresh') ?> Refresh</button>
          </div>
        </div>
      </div>

      <!-- ── KPI cards ──────────────────────────────────────────────── -->
      <div id="nocKpiGrid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:.5rem;margin-bottom:.9rem">
        <!-- filled by JS -->
      </div>

      <!-- ── Hakim AI recommendation ────────────────────────────────── -->
      <div class="panel" id="nocHakimCard" style="margin-bottom:.9rem;border-left:3px solid #d4af37">
        <div class="panel-header">
          <span class="panel-title">🤖 Hakim <span class="panel-sub" id="nocHakimBadge"></span></span>
          <span style="font-size:.72rem;opacity:.45">AI-anbefaling · kun faktiske data</span>
        </div>
        <div class="panel-body" id="nocHakimBody"><div class="loading"><div class="spinner"></div></div></div>
      </div>

      <!-- ── Charts (2-col, 4 rows) ─────────────────────────────────── -->
      <div class="two-col" style="margin-bottom:.75rem">
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('dollar') ?> Daglig inntekt</span></div>
          <div class="panel-body"><div style="position:relative;height:240px"><canvas id="chNocRev"></canvas></div></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('chart') ?> Daglige rewarded views</span></div>
          <div class="panel-body"><div style="position:relative;height:240px"><canvas id="chNocViews"></canvas></div></div></div>
      </div>
      <div class="two-col" style="margin-bottom:.75rem">
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('dollar') ?> eCPM over tid</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocEcpm"></canvas></div></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('chart') ?> Fill rate</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocFill"></canvas></div></div></div>
      </div>
      <div class="two-col" style="margin-bottom:.75rem">
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('person') ?> Revenue per bruker (ARPDAU)</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocArpdau"></canvas></div></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('download') ?> GB utdelt</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocGb"></canvas></div></div></div>
      </div>
      <div class="two-col" style="margin-bottom:.75rem">
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('gift') ?> Installasjoner fra Telegram → RealGram</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocConv"></canvas></div></div></div>
        <div class="panel"><div class="panel-header"><span class="panel-title"><?= icon('chart') ?> Kumulativ inntekt — AdMob vs AdsGram</span></div>
          <div class="panel-body"><div style="position:relative;height:220px"><canvas id="chNocCumul"></canvas></div></div></div>
      </div>

      <!-- ── Legacy recovery stats (kept) ──────────────────────────── -->
      <div id="adsConfigBanner" class="panel" style="margin-bottom:.75rem;display:none">
        <div class="panel-body" style="color:#f59e0b;font-size:.85rem" id="adsConfigBannerText"></div>
      </div>
      <div class="two-col" style="margin-bottom:.75rem">
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('dollar') ?> Rewarded Ads (AdMob, 30d) <span class="panel-sub">recovery engine</span></span></div>
          <div class="panel-body"><div style="position:relative;height:240px"><canvas id="chAds"></canvas></div></div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title"><?= icon('download') ?> Recovery Quota</span></div>
          <div class="panel-body">
            <div class="stat-grid" style="grid-template-columns:1fr 1fr">
              <div class="stat-card"><div class="stat-label">Today (AdMob)</div><div class="stat-value" id="adsToday">—</div><div class="stat-sub" id="adsWeek">— this week</div></div>
              <div class="stat-card"><div class="stat-label">Revenue 30d</div><div class="stat-value" id="adsRev30">—</div><div class="stat-sub" id="adsRevAll">— all time</div></div>
              <div class="stat-card"><div class="stat-label">GB Granted</div><div class="stat-value" id="adsGbGranted">—</div><div class="stat-sub">ledger</div></div>
              <div class="stat-card"><div class="stat-label">Users Saved</div><div class="stat-value" id="adsSaved">—</div><div class="stat-sub">zero-data</div></div>
              <div class="stat-card"><div class="stat-label">Recovery GB</div><div class="stat-value" id="adsRecGb">—</div><div class="stat-sub">reserve used</div></div>
              <div class="stat-card"><div class="stat-label">Margin / GB</div><div class="stat-value" id="adsMarginGb">—</div><div class="stat-sub" id="adsRevGb">—</div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Banner Ads (Home / Freedom placements) ─────────────────── -->
      <div class="panel" style="margin-top:.75rem;margin-bottom:.75rem">
        <div class="panel-header"><span class="panel-title"><?= icon('dollar') ?> Banner Ads <span class="panel-sub">AdMob — Home &amp; Freedom placements, same period as above</span></span></div>
        <div class="panel-body">
          <div class="two-col">
            <div>
              <div style="font-size:.72rem;font-weight:600;color:var(--muted);margin-bottom:.35rem">HOME BANNER</div>
              <table class="tbl" style="width:100%"><tbody id="bannerAdsHome"></tbody></table>
            </div>
            <div>
              <div style="font-size:.72rem;font-weight:600;color:var(--muted);margin-bottom:.35rem">FREEDOM BANNER</div>
              <table class="tbl" style="width:100%"><tbody id="bannerAdsFreedom"></tbody></table>
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:.5rem">
        <div class="panel-header"><span class="panel-title"><?= icon('person') ?> Suspicious Reward Events <span class="panel-sub" id="adsReviewCount">review queue</span></span></div>
        <div class="panel-body">
          <table class="data-table" style="width:100%">
            <thead><tr><th>Device</th><th>Risk</th><th>Flags</th><th>Source</th><th>When</th></tr></thead>
            <tbody id="adsReviewBody"><tr><td colspan="5" style="opacity:.6">No events under review.</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="margin-top:.75rem">
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
    <!-- VIEW: NETWORK INTEL                                          -->
    <!-- ============================================================ -->
    <div data-view="intel" hidden>
      <div class="panel-header" style="margin-bottom:1rem;display:flex;align-items:center;gap:.75rem">
        <span style="font-size:1.1rem;font-weight:700">RealGram Network Intelligence</span>
        <select class="select btn-sm" id="intelDays" style="width:110px">
          <option value="1">Last 24h</option>
          <option value="7" selected>Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="intelRefreshBtn"><?= icon('refresh') ?> Refresh</button>
        <span style="font-size:.72rem;color:var(--muted)" id="intelNote">Anonymous telemetry from app connects</span>
      </div>

      <!-- AI Recommendations -->
      <div class="panel" style="margin-bottom:1rem" id="intelRecsPanel">
        <div class="panel-header" style="display:flex;align-items:center;gap:.75rem">
          <span class="panel-title">⚡ Network Engineer Recommendations</span>
          <span class="panel-sub">auto-detected action items</span>
          <span id="intelRecsCount" style="margin-left:auto;font-size:.72rem;color:var(--muted)"></span>
        </div>
        <div id="intelRecs" style="padding:.75rem 1rem">
          <div class="spinner"></div>
        </div>
      </div>

      <!-- Intelligence Insights -->
      <div class="panel" style="margin-bottom:1rem" id="intelInsightsPanel">
        <div class="panel-header">
          <span class="panel-title">🤖 Intelligence Insights</span>
          <span class="panel-sub">pattern-based suggestions from telemetry</span>
        </div>
        <div id="intelInsights" style="padding:.75rem 1rem">
          <div class="spinner"></div>
        </div>
      </div>

      <!-- Node health scores from telemetry -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header">
          <span class="panel-title">Node Health — Telemetry Scores</span>
          <span class="panel-sub">success rate from real connect attempts</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Node</th><th>Total Events</th><th>OK</th><th>Fail</th><th>Success Rate</th><th>Avg Latency</th><th>Last Event</th></tr></thead>
            <tbody id="intelNodeTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Timeline chart -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">Connect Success Timeline</span><span class="panel-sub">daily success rate %</span></div>
        <div class="panel-body" style="height:200px;position:relative">
          <canvas id="intelTimelineChart"></canvas>
          <div id="intelTimelineEmpty" style="display:none;text-align:center;color:var(--muted);padding:2rem">No telemetry data yet</div>
        </div>
      </div>

      <div class="two-col" style="margin-bottom:1rem">
        <!-- Platform breakdown -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Success by Platform</span><span class="panel-sub">Android vs iOS</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Node</th><th>Platform</th><th>Total</th><th>OK</th><th>Rate</th></tr></thead>
              <tbody id="intelPlatformTbl"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>

        <!-- Network type breakdown -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Success by Network Type</span><span class="panel-sub">WiFi vs mobile data</span></div>
          <div class="tbl-wrap">
            <table>
              <thead><tr><th>Network</th><th>Total</th><th>OK</th><th>Rate</th></tr></thead>
              <tbody id="intelNetworkTbl"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ISP breakdown -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header">
          <span class="panel-title">ISP / Carrier Breakdown</span>
          <span class="panel-sub">anonymised ISP hash · top 50 by volume</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>ISP Hash</th><th>Country</th><th>Total</th><th>OK</th><th>Fail</th><th>Rate</th><th>Avg Latency</th></tr></thead>
            <tbody id="intelIspTbl"><tr><td colspan="7" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Profile scores -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">Profile Success Scores</span><span class="panel-sub">per node + SNI profile</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Node</th><th>Profile</th><th>Total</th><th>OK</th><th>Rate</th><th>Avg Latency</th></tr></thead>
            <tbody id="intelProfileTbl"><tr><td colspan="6" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Build breakdown -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">Success by Build Number</span><span class="panel-sub">per build × platform</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Build</th><th>Platform</th><th>Total</th><th>OK</th><th>Rate</th><th>Avg Latency</th></tr></thead>
            <tbody id="intelBuildTbl"><tr><td colspan="6" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Probe breakdown -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">App Probe Results</span><span class="panel-sub">% of sessions where each app reached successfully</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>App / Target</th><th>Sessions Tested</th><th>Reached</th><th>Success Rate</th></tr></thead>
            <tbody id="intelProbeTbl"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Country breakdown -->
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header"><span class="panel-title">Country Breakdown</span><span class="panel-sub">geo-derived from client IP</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Country</th><th>Total</th><th>OK</th><th>Rate</th></tr></thead>
            <tbody id="intelCountryTbl"><tr><td colspan="4" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Diagnostic Sessions -->
      <div class="panel" style="margin-bottom:1rem" id="diagSessionsPanel">
        <div class="panel-header" style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <span class="panel-title">Diagnostic Sessions (CP1–CP4)</span>
          <span class="panel-sub">auto-saved on every disconnect from build 68+</span>
          <span style="margin-left:auto;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <select class="select btn-sm" id="diagServer" style="width:110px">
              <option value="">All Servers</option>
              <option value="Finland">Finland</option>
              <option value="Germany">Germany</option>
            </select>
            <select class="select btn-sm" id="diagCp1" style="width:95px">
              <option value="">CP1 any</option>
              <option value="PASS">CP1 PASS</option>
              <option value="FAIL">CP1 FAIL</option>
            </select>
            <select class="select btn-sm" id="diagCp4" style="width:95px">
              <option value="">CP4 any</option>
              <option value="PASS">CP4 PASS</option>
              <option value="FAIL">CP4 FAIL</option>
            </select>
            <select class="select btn-sm" id="diagCode" style="width:130px">
              <option value="">Any conclusion</option>
              <option value="tunnel_ok">tunnel_ok</option>
              <option value="cp1_fail">cp1_fail</option>
              <option value="cp4_fail">cp4_fail</option>
              <option value="proxy_mode">proxy_mode</option>
              <option value="no_data">no_data</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="diagRefreshBtn">Search</button>
          </span>
        </div>
        <div id="diagSideBySide" style="display:none;padding:.75rem 1rem .25rem">
          <!-- Side-by-side server comparison injected by JS -->
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th>Time</th><th>Server</th><th>Mode</th>
              <th>CP1</th><th>CP2</th><th>CP3</th><th>CP4</th>
              <th>CP4 Conns</th><th>First Dest</th>
              <th>VPS</th><th>Conclusion</th><th>Duration</th><th>Disconnect</th>
            </tr></thead>
            <tbody id="diagSessionTbl"><tr><td colspan="13" class="tbl-empty">Select filters and click Search</td></tr></tbody>
          </table>
        </div>
      </div>

      <!-- Recent failures -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Recent Failures</span><span class="panel-sub">last 100 non-OK events</span></div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Time</th><th>Event</th><th>Node</th><th>Profile</th><th>SNI</th><th>Platform</th><th>Network</th><th>Country</th><th>Stage</th><th>Latency</th></tr></thead>
            <tbody id="intelFailTbl"><tr><td colspan="10" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: STARLINK (exit node, beta/testing — Phase 1)           -->
    <!-- ============================================================ -->
    <div data-view="starlink" hidden>
      <div class="panel-header" style="margin-bottom:1rem;display:flex;align-items:center;gap:.75rem">
        <span style="font-size:1.1rem;font-weight:700">Starlink exit nodes</span>
        <button class="btn btn-secondary btn-sm" id="stRefreshBtn"><?= icon('refresh') ?> Refresh</button>
        <span style="font-size:.72rem;color:var(--muted)">Never visible to normal users until enabled + allowlisted</span>
      </div>

      <div id="stNodesWrap"><div class="spinner"></div></div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-header">
          <span class="panel-title">Admin activity log</span>
          <span class="panel-sub">enable/disable · maintenance · fallback · token rotation</span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Time</th><th>Node</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody id="stLogTbl"><tr><td colspan="5" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============================================================ -->
    <!-- VIEW: AI DIAGNOSIS                                           -->
    <!-- ============================================================ -->
    <div data-view="aidiag" hidden>
      <div class="panel-header" style="margin-bottom:1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <span style="font-size:1.1rem;font-weight:700">AI Diagnosis</span>
        <span class="panel-sub">automatic per-session root cause analysis + cross-session pattern detection</span>
        <select class="select btn-sm" id="aidiagDays" style="width:110px">
          <option value="3">Last 3 days</option>
          <option value="7">Last 7 days</option>
          <option value="14" selected>Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="aidiagRefreshBtn">Refresh</button>
        <span id="aidiagNote" style="font-size:.72rem;color:var(--muted)"></span>
      </div>

      <!-- Summary badges -->
      <div class="dev-stat-grid" id="aidiagStats" style="margin-bottom:1rem">
        <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value" id="aidTotal">—</div></div>
        <div class="stat-card stat-ok"><div class="stat-label">Tunnel OK</div><div class="stat-value" id="aidOk">—</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">CP1 Fail</div><div class="stat-value" id="aidCp1">—</div></div>
        <div class="stat-card" style="border-left:3px solid var(--danger)"><div class="stat-label">CP4 Fail</div><div class="stat-value" id="aidCp4">—</div></div>
      </div>

      <!-- Pattern alerts -->
      <div class="panel" style="margin-bottom:1rem" id="aidiagPatternsPanel">
        <div class="panel-header">
          <span class="panel-title">Pattern Alerts</span>
          <span class="panel-sub">cross-session failure patterns auto-detected from device, iOS version, carrier, build</span>
        </div>
        <div id="aidiagPatterns" style="padding:.75rem 1rem">
          <div class="spinner"></div>
        </div>
      </div>

      <!-- Session cards -->
      <div id="aidiagCards" style="display:flex;flex-direction:column;gap:1rem">
        <div class="panel" style="padding:1.5rem;text-align:center;color:var(--muted)">
          <div class="spinner" style="margin:0 auto 1rem"></div>
          Loading sessions…
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
        <div class="stat-card"><div class="stat-label">🍎 iOS</div><div class="stat-value" id="devIos">—</div></div>
        <div class="stat-card"><div class="stat-label">🤖 Android</div><div class="stat-value" id="devAndroid">—</div></div>
        <div class="stat-card stat-warn"><div class="stat-label">🔍 Apple Review</div><div class="stat-value" id="devAppleReview">—</div></div>
        <div class="stat-card"><div class="stat-label">🔌 Never Connected</div><div class="stat-value" id="devNeverConnected">—</div></div>
      </div>
      <div class="search-row">
        <input class="input" id="devSearch" placeholder="Search User ID, device ID, country, model, version, platform…" type="search">
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
        <select class="select" id="devPlatform" style="width:160px">
          <option value="">All platforms</option>
          <option value="ios">🍎 iOS</option>
          <option value="android">🤖 Android</option>
        </select>
        <select class="select" id="devSource" style="width:170px">
          <option value="">All sources</option>
          <option value="apple_review">🔍 Apple Review</option>
          <option value="testflight">🧪 TestFlight tester</option>
          <option value="never_connected">🔌 Never connected</option>
          <option value="inactive_30">💤 Inactive 30+ days</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="devRefreshBtn"><?= icon('refresh') ?></button>
        <button class="btn btn-secondary btn-sm" id="devGeoBackfillBtn" title="Re-resolve country/flag for devices with an IP but no country">🌍 Fix flags</button>
      </div>
      <div class="panel">
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>User ID</th><th>Plan</th><th>Quota</th><th>Status</th><th>Protocol</th><th class="mobile-hide">Sessions</th><th class="mobile-hide">RX/TX</th><th class="mobile-hide">Connectivity</th><th class="mobile-hide">Last Failure</th><th class="mobile-hide">Country</th><th class="mobile-hide">First / Last Seen</th><th>Actions</th></tr></thead>
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

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">REAL Redemptions <span class="panel-sub" id="realRates">Shahnameh REAL → quota</span></span>
        </div>
        <div class="panel-body" style="padding-top:0">
          <div id="realEcoStatus" style="font-size:.78rem;margin:.2rem 0 .8rem;opacity:.85"></div>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>ID</th><th>Device</th><th>REAL Account</th><th>REAL</th><th>Quota</th><th>Kind</th><th>Tx Ref</th><th>Status</th><th>When</th><th>Actions</th></tr></thead>
            <tbody id="realTbl"><tr><td colspan="10" class="tbl-empty"><div class="spinner"></div></td></tr></tbody>
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
    <!-- VIEW: TUNNEL LOGS (PacketTunnelProvider diagnostic bundles)  -->
    <!-- ============================================================ -->
    <div data-view="tunnellogs" hidden>
      <div class="filter-row" style="flex-wrap:wrap;gap:.5rem">
        <input class="input" id="tlDevice" placeholder="Filter by device id (e.g. sl-ec58…)" type="search" style="flex:1;min-width:180px">
        <select class="input" id="tlPlatform" style="width:auto">
          <option value="">All platforms</option>
          <option value="ios">🍎 iOS</option>
          <option value="android">🤖 Android</option>
        </select>
        <select class="input" id="tlStatus" style="width:auto">
          <option value="">All status</option>
          <option value="ok">✓ OK</option>
          <option value="fail">✗ FAIL</option>
        </select>
        <select class="input" id="tlStage" style="width:auto">
          <option value="">All stages</option>
          <option value="connected">connected</option>
          <option value="failed">failed</option>
        </select>
        <input class="input" id="tlAppVer" placeholder="App version (e.g. 0.9.50)" type="search" style="width:120px">
        <button class="btn btn-secondary btn-sm" id="tlRefreshBtn"><?= icon('refresh') ?> Refresh</button>
      </div>
      <div class="panel" style="margin-bottom:1rem">
        <div class="panel-header">
          <span class="panel-title">Uploaded Tunnel Logs</span>
          <span class="panel-sub" id="tlCount"></span>
        </div>
        <div id="tlList" style="max-height:42vh;overflow-y:auto">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Detail</span>
          <span class="panel-sub" id="tlDetailStem">select a row above</span>
        </div>
        <div id="tlDetail" style="padding:.5rem;max-height:55vh;overflow-y:auto;font-size:.72rem">
          <div class="panel-empty">No log selected.</div>
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
              <input class="input" id="cfgLabel" placeholder="RealGram VPN">
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
        <div class="panel-header">
          <span class="panel-title">Adaptive Network Flags</span>
          <span class="panel-sub">pushed to mobile clients via remote-config · no APK needed</span>
        </div>
        <div class="panel-body">
          <div class="two-col" style="gap:.75rem">
            <div class="form-group">
              <label>Max Failover Nodes</label>
              <input class="input" id="rcFailoverMax" type="number" min="0" max="5" value="2"
                     title="How many extra nodes to try automatically when the selected node fails. 0 = disabled.">
              <div style="font-size:.68rem;color:var(--muted);margin-top:.2rem">0 = disabled · 2 = try 2 extra nodes</div>
            </div>
            <div class="form-group">
              <label>Telemetry</label>
              <label style="display:flex;align-items:center;gap:.4rem;margin-top:.4rem">
                <input type="checkbox" id="rcTelemetryEnabled" checked> Enable anonymous connect telemetry
              </label>
              <div style="font-size:.68rem;color:var(--muted);margin-top:.25rem">Uncheck to pause telemetry collection without an APK update</div>
            </div>
          </div>
          <div class="form-group">
            <label>Disabled Nodes (skip entirely)</label>
            <div class="tag-list" id="rcNodesDisabled"></div>
            <div style="display:flex;gap:.35rem;margin-top:.4rem">
              <input class="input input-sm" id="rcNodeDisInput" placeholder="node-id e.g. fi-hel" style="flex:1;padding:.3rem .5rem;font-size:.75rem">
              <button class="btn btn-ghost btn-sm" id="rcNodeDisAdd"><?= icon('plus') ?></button>
            </div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:.2rem">Nodes listed here are skipped in auto-selection and failover. Use to kill a node without a new APK.</div>
          </div>
          <div class="two-col" style="gap:.75rem">
            <div class="form-group">
              <label>Extra Logging — Platform</label>
              <select class="select" id="rcExtraLogPlatform">
                <option value="">Off</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>
            </div>
            <div class="form-group">
              <label>Extra Logging — Node ID</label>
              <input class="input" id="rcExtraLogNode" placeholder="primary or fi-hel">
            </div>
          </div>
          <div class="form-group">
            <label>Rollout Fractions (JSON)</label>
            <textarea class="input" id="rcRollout" rows="3" style="font-family:var(--font-mono);font-size:.72rem;resize:vertical"
              placeholder='{"node_auto_failover": 1.0, "telemetry_v2": 0.5}'></textarea>
            <div style="font-size:.68rem;color:var(--muted);margin-top:.2rem">Feature → fraction (0.0–1.0). 1.0 = everyone · 0.5 = 50% · 0.0 = no one</div>
          </div>
          <button class="btn btn-primary" id="cfgSaveAdaptive"><?= icon('save') ?> Save Adaptive Flags</button>
          <span id="adaptiveSaveMsg" style="margin-left:.75rem;font-size:.75rem;color:var(--ok)"></span>
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

    <!-- ============================================================ -->
    <!-- VIEW: HAKIM ADMIN (ADMIN_NOC_ROADMAP.md § 8.11)               -->
    <!-- Reads hakim-bot's ACTUAL running state (systemctl, hakim.db)  -->
    <!-- — never a plausible invented status. § 8.0 applies here too.  -->
    <!-- ============================================================ -->
    <!-- ============================================================ -->
    <!-- VIEW: PROFILE                                               -->
    <!-- ============================================================ -->
    <div data-view="profile" hidden>

      <!-- Search bar -->
      <div class="panel" style="margin-bottom:.75rem">
        <div class="panel-body" style="padding:.75rem 1rem;display:flex;gap:.75rem;align-items:center">
          <input id="profileSearch" class="input" style="flex:1;max-width:420px"
                 placeholder="Device ID, User ID, or handle…" autocomplete="off" spellcheck="false">
          <button class="btn btn-primary btn-sm" id="profileSearchBtn">Look up</button>
          <span id="profileSearchStatus" style="font-size:.8rem;color:var(--text-muted)"></span>
        </div>
      </div>

      <!-- Profile card (hidden until loaded) -->
      <div id="profileCard" hidden>

        <!-- ── 👤 Identity ── -->
        <div class="panel" style="margin-bottom:.75rem">
          <div class="panel-header" style="gap:.5rem">
            <span style="font-size:1.6rem;line-height:1" id="profAvatar">👤</span>
            <div>
              <span class="panel-title" id="profTitle">Identity</span>
              <span class="badge" id="profPlanBadge" style="margin-left:.5rem;vertical-align:middle"></span>
              <span class="badge" id="profCountryBadge" style="margin-left:.25rem;vertical-align:middle"></span>
              <span class="badge badge-muted" id="profBlockedBadge" style="margin-left:.25rem;vertical-align:middle;display:none;background:var(--danger-dim);color:var(--danger)">BLOCKED</span>
            </div>
          </div>
          <div class="panel-body" style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.65rem">
            <div class="stat-mini"><div class="stat-mini-label">REAL_ID</div><div class="stat-mini-val" id="profRealId" style="font-size:.75rem;font-family:monospace;word-break:break-all">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">User ID</div><div class="stat-mini-val" id="profUserId" style="font-size:.78rem;font-family:monospace">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Handle</div><div class="stat-mini-val" id="profHandle">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Persona</div><div class="stat-mini-val" id="profPersona">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Platform</div><div class="stat-mini-val" id="profPlatform">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">App version</div><div class="stat-mini-val" id="profAppVersion">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Joined</div><div class="stat-mini-val" id="profCreated">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Last seen</div><div class="stat-mini-val" id="profLastSeen">—</div></div>
          </div>
        </div>

        <!-- ── 💎 Wallet ── -->
        <div class="panel" style="margin-bottom:.75rem">
          <div class="panel-header"><span class="panel-title">💎 Wallet</span></div>
          <div class="panel-body" style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.65rem">
            <div class="stat-mini"><div class="stat-mini-label">GB Free</div><div class="stat-mini-val" id="profGbFree">—</div><div style="font-size:.7rem;color:var(--text-muted)" id="profGbUsed">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Lifetime Earned</div><div class="stat-mini-val" id="profGbLifetime">—</div></div>
            <div class="stat-mini"><div class="stat-mini-label">REAL</div><div class="stat-mini-val" id="profRealBal" style="color:var(--gold,#F5A623)">—</div><div style="font-size:.68rem;color:var(--text-muted)">via Shahnameh</div></div>
            <div class="stat-mini"><div class="stat-mini-label">TON</div><div class="stat-mini-val" id="profTonBal">—</div><div style="font-size:.68rem;color:var(--text-muted)">via TON wallet</div></div>
            <div class="stat-mini"><div class="stat-mini-label">Plan</div><div class="stat-mini-val" id="profWalletPlan">—</div><div style="font-size:.7rem;color:var(--text-muted)" id="profPlanExpiry"></div></div>
          </div>
        </div>

        <!-- ── 3-column: Freedom · Community · Shahnameh ── -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem">

          <!-- 🌍 Freedom -->
          <div class="panel">
            <div class="panel-header"><span class="panel-title">🌍 Freedom</span></div>
            <div class="panel-body" style="padding:.75rem">
              <div id="profFreedomList"></div>
              <div style="font-size:.73rem;color:var(--text-muted);margin-top:.4rem;font-style:italic" id="profTopProtocol"></div>
            </div>
          </div>

          <!-- 👥 Community -->
          <div class="panel">
            <div class="panel-header"><span class="panel-title">👥 Community</span></div>
            <div class="panel-body" style="padding:.75rem">
              <div id="profClanRank" style="font-size:1.05rem;font-weight:700;margin-bottom:.5rem"></div>
              <div id="profClanList"></div>
              <div id="profClanReferrals" style="margin-top:.5rem;font-size:.76rem;color:var(--text-muted);line-height:1.4"></div>
            </div>
          </div>

          <!-- 🎮 Shahnameh -->
          <div class="panel">
            <div class="panel-header">
              <span class="panel-title">🎮 Shahnameh</span>
              <span class="badge badge-muted" id="profShahnamehBadge" style="margin-left:.5rem;font-size:.65rem">NOT LINKED</span>
            </div>
            <div class="panel-body" style="padding:.75rem">
              <div id="profShahnamehList"></div>
              <div style="margin-top:.75rem;padding:.5rem;background:var(--bg-2);border-radius:4px;font-size:.72rem;color:var(--text-muted)">
                Hero · Chapter · Level · Clan · XP · REAL Earned will populate here once the Shahnameh backend exposes a <code>/v1/profile/:real_id</code> endpoint (Agent B).
              </div>
            </div>
          </div>

        </div>

        <!-- ── 📜 Activity ── -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">📜 Activity</span>
            <div style="margin-left:auto;display:flex;gap:.4rem;align-items:center">
              <select id="profTlFilter" class="input" style="font-size:.75rem;padding:.2rem .4rem;height:auto">
                <option value="">All types</option>
                <option value="vpn">🌐 VPN</option>
                <option value="quota">💰 Wallet</option>
                <option value="referral">👥 Referral</option>
                <option value="install">📦 Install</option>
                <option value="app">🎮 App</option>
              </select>
            </div>
          </div>
          <div class="panel-body" style="padding:0">
            <table class="tbl" id="profTimeline">
              <thead><tr><th style="white-space:nowrap">When</th><th></th><th>Event</th><th>Detail</th></tr></thead>
              <tbody></tbody>
            </table>
            <div id="profTlNav" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;border-top:1px solid var(--border);font-size:.78rem">
              <button class="btn btn-ghost btn-sm" id="profTlPrev" disabled>← Earlier</button>
              <span id="profTlInfo" style="color:var(--text-muted)"></span>
              <button class="btn btn-ghost btn-sm" id="profTlNext">Later →</button>
            </div>
          </div>
        </div>

      </div><!-- /profileCard -->

      <div id="profileEmpty" style="padding:3rem;text-align:center;color:var(--text-muted)">
        Enter a Device ID, User ID, or @handle above to view a unified profile.
      </div>

    </div>

    <!-- ============================================================ -->
    <!-- VIEW: WALLET (placeholder)                                   -->
    <!-- ============================================================ -->
    <div data-view="wallet" hidden>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">💎 REAL Wallet</span></div>
        <div class="panel-body" style="padding:2rem;text-align:center;color:var(--text-muted)">
          <div style="font-size:2rem;margin-bottom:.75rem">💎</div>
          <div style="font-weight:600;margin-bottom:.5rem">REAL Economy</div>
          <div style="font-size:.85rem">ZAR balances · REAL token · wallet transactions · top earners · burn rate</div>
          <div style="margin-top:1.5rem;font-size:.8rem;opacity:.6">Coming soon — requires zar_store ledger API + REAL wallet contract</div>
        </div>
      </div>
    </div>

    <div data-view="hakim" hidden>
      <div class="two-col">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Bot Status</span></div>
          <div class="panel-body">
            <div class="stat-row" style="display:flex;gap:1rem;flex-wrap:wrap">
              <div><span class="dot" id="hakimStatusDot"></span> <strong id="hakimStatusText">—</strong></div>
              <div>Model: <strong id="hakimModel">—</strong></div>
              <div>Bot active flag: <strong id="hakimActiveFlag">—</strong></div>
              <div>Config last updated: <strong id="hakimLastUpdate">—</strong></div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Requests</span></div>
          <div class="panel-body">
            <div class="stat-row" style="display:flex;gap:1rem;flex-wrap:wrap">
              <div>Total messages in: <strong id="hakimReqTotal">—</strong></div>
              <div>Users: <strong id="hakimUserCount">—</strong></div>
              <div>Success rate: <strong id="hakimSuccessRate">—</strong></div>
              <div>Avg response time: <strong id="hakimAvgLatency">—</strong></div>
            </div>
            <p id="hakimReqNote" style="font-size:.7rem;color:var(--muted-2);margin-top:.5rem"></p>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Recent Errors</span><span class="panel-sub" id="hakimErrorCount"></span></div>
        <div id="hakimErrorList" style="max-height:220px;overflow-y:auto">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="two-col" style="margin-top:1rem">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Knowledge Sources</span></div>
          <div class="panel-body" id="hakimKnowledge">—</div>
        </div>
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Advisor Mode</span></div>
          <div class="panel-body">
            <p style="font-size:.75rem;color:var(--muted-2)">
              Not implemented yet client-side (§ 8.9) — no config to show.
              This panel will control it once built.
            </p>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Test Hakim</span><span class="panel-sub">sends a real message to the live bot — costs a real API call</span></div>
        <div class="panel-body">
          <div class="form-group">
            <textarea class="input" id="hakimTestQuestion" rows="2" placeholder="e.g. Hvordan fungerer Rikets Ære?"></textarea>
          </div>
          <button class="btn btn-primary" id="hakimTestBtn"><?= icon('refresh') ?> Send test question</button>
          <div id="hakimTestResult" style="margin-top:.75rem;font-size:.82rem;white-space:pre-wrap"></div>
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
    <button class="btn btn-secondary btn-sm" id="devProfileBtn" style="display:none">👤 Full Profile</button>
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
function platformBadge(p) {
  if ((p||'').toLowerCase() === 'ios')
    return '<span class="badge badge-info" title="iOS (TestFlight / App Store)" style="font-size:.65rem">🍎 iOS</span>';
  return '<span class="badge badge-muted" title="Android" style="font-size:.65rem">🤖 Android</span>';
}
function probeBadge(r) {
  if (r === 'ok')   return '<span class="badge badge-ok"  title="Probe reached internet through tunnel">✓ probe ok</span>';
  if (r === 'fail') return '<span class="badge badge-danger" title="Tunnel connected but internet unreachable">✗ probe fail</span>';
  return '<span style="color:var(--muted-2);font-size:.7rem">—</span>';
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
  dashboard: ['Dashboard',            'live monitoring · auto-refresh 10s'],
  analytics: ['Growth & Usage',       'growth & usage trends · 30-day charts'],
  ads:       ['Ads — AdsGram · AdMob','rewarded ads · AdsGram callback · AdMob config · revenue vs cost'],
  payments:  ['Payments & Packages',  'premium packages · REAL vs USDT · intents · transaction log'],
  iran:      ['Censorship Debug',     'censorship diagnostics · Iranian ISP analysis · bypass routes'],
  intel:     ['AI Routing Intel',     'connect telemetry · learned node scores · ISP/platform breakdown'],
  insights:  ['User Insights',        'aggregate carriers · geo · devices · reachability · no per-user tracking'],
  seoranks:  ['SEO Ranks',            'target keyword positions · Iran filtershekan intent · GSC sync'],
  tapstream: ['Tap Stream',           'batched UI tap telemetry · top screens & elements (B-24)'],
  starlink:  ['Starlink Node',        'exit-node (beta) · tunnel health · unlock status · allowlist'],
  installs:  ['Install Diagnostics',  'app versions · Android/iOS · ABI split · install failures'],
  devices:   ['Devices',              'device management · quota · plan · payments'],
  logs:      ['Logs',                 'structured log viewer · xray · nginx · error log'],
  tunnellogs:['Tunnel Logs',          'per-device PacketTunnelProvider diagnostics · stage · server · final error'],
  release:   ['Release & OTA',        'APK channels · version.json · iOS TestFlight · health'],
  config:    ['Config',               'remote config · bootstrap server · feature flags'],
  referrals: ['Referrals',            'invite analytics · leaderboard · conversion · bonus grants'],
  hakim:     ['Shahnameh AI (Hakim)', 'bot status · requests · errors · knowledge sources · test interface'],
  aidiag:    ['AI Diagnostics',       'node recommendation quality · confidence scores · failure analysis'],
  profile:   ['User Profiles',        'Shahnameh identity · handle · persona · ZAR · invite tree'],
  wallet:    ['REAL Wallet',          'ZAR balances · REAL token · wallet transactions · top earners'],
};

function navigate(page) {
  if (!pageTitles[page]) page = 'dashboard';
  closeSidebar(); // close mobile drawer on every navigation
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.page===page));
  document.querySelectorAll('[data-view]').forEach(el=>{ el.hidden = el.dataset.view!==page; });
  const [title, sub] = pageTitles[page];
  $('pageTitle').textContent = title;
  $('pageSub').textContent = sub;
  document.title = `RealGram Admin — ${title}`;
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
$('seoSaveBtn')?.addEventListener('click', ()=>views.seoranks.save());
$('seoAddKwBtn')?.addEventListener('click', ()=>views.seoranks.addKeyword());
$('gscSyncBtn')?.addEventListener('click', ()=>views.seoranks.syncGsc());
$('gscSaveBtn')?.addEventListener('click', ()=>views.seoranks.saveGscConfig());
$('ga4SaveBtn')?.addEventListener('click', ()=>views.analytics.saveGa4Property());
$('ga4SyncBtn')?.addEventListener('click', ()=>views.analytics.syncGa4());

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
    this.loadGa4();
  },
  // ── Google Analytics (GA4) — separate from the internal charts above ──
  async loadGa4() {
    try {
      const d = await api.get('ga4-summary');
      $('ga4Property').value = d.property_id || '';
      $('ga4Setup').style.display = d.configured ? 'none' : '';
      if (!d.key_present) {
        $('ga4Status').textContent = 'service-account key missing';
      } else if (!d.property_id) {
        $('ga4Status').textContent = 'not configured';
      } else if (d.last_sync) {
        $('ga4Status').textContent = 'last synced ' + d.last_sync;
      } else {
        $('ga4Status').textContent = 'configured, not synced yet';
      }
      this.renderGa4(d.cache);
    } catch (e) { $('ga4Status').textContent = 'error: ' + e.message; }
  },
  renderGa4(cache) {
    if (!cache) return;
    const t = cache.totals || ['0','0','0','0'];
    $('ga4Users').textContent      = t[0] ?? '—';
    $('ga4NewUsers').textContent   = t[1] ?? '—';
    $('ga4Views').textContent      = t[2] ?? '—';
    const secs = Math.round(+t[3] || 0);
    $('ga4AvgSession').textContent = secs ? (Math.floor(secs/60) + 'm ' + (secs%60) + 's') : '—';
    $('ga4DaysSub').textContent    = 'last ' + (cache.days ?? 30) + 'd';

    const byDay = cache.by_day || []; // [[date, activeUsers, screenPageViews], ...]
    const labels = byDay.map(r => (r[0]||'').replace(/^(\d{4})(\d{2})(\d{2})$/, '$2-$3'));
    if (typeof Chart !== 'undefined') {
      if (this.charts.ga4Users) { try { this.charts.ga4Users.destroy(); } catch(e){} }
      this.charts.ga4Users = new Chart($('chGa4Users'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Active Users', data: byDay.map(r => +r[1]||0),
          borderColor: this.PALETTE[3], backgroundColor: 'rgba(239,68,68,.15)', fill: true, tension: .3, pointRadius: 2 }] },
        options: this._baseOpts({ plugins: { legend: { display: false } } }),
      });
    }

    const pagesRows = (cache.pages || []).map(r=>`<tr><td style="font-family:var(--mono);font-size:.75rem">${esc(r[0]||'')}</td><td>${r[1]||0}</td></tr>`);
    $('ga4PagesTbl').innerHTML = pagesRows.length ? pagesRows.join('') : '<tr><td colspan="2" class="tbl-empty">No data</td></tr>';
    const geoRows = (cache.geo || []).map(r=>`<tr><td>${esc(r[0]||'')}</td><td>${r[1]||0}</td></tr>`);
    $('ga4GeoTbl').innerHTML = geoRows.length ? geoRows.join('') : '<tr><td colspan="2" class="tbl-empty">No data</td></tr>';
    // [platform, streamName, activeUsers, screenPageViews]
    const platRows = (cache.platforms || []).map(r=>`<tr><td>${esc(r[0]||'')}</td><td>${esc(r[1]||'')}</td><td>${r[2]||0}</td><td>${r[3]||0}</td></tr>`);
    $('ga4PlatformTbl').innerHTML = platRows.length ? platRows.join('') : '<tr><td colspan="4" class="tbl-empty">No data</td></tr>';
  },
  async saveGa4Property() {
    const pid = ($('ga4Property').value || '').trim();
    if (!/^\d+$/.test(pid)) { $('ga4Msg').textContent = 'Property ID must be numeric'; return; }
    try {
      // GET, not POST — this app's POST route is a separate, closed action
      // dispatcher (device-block/unblock/etc.) that doesn't reach this
      // switch; GET does (same path ga4-summary/ga4-sync already use).
      await api.get('ga4-save-property', { property_id: pid });
      $('ga4Msg').textContent = 'Saved.';
      this.loadGa4();
    } catch (e) { $('ga4Msg').textContent = 'Error: ' + e.message; }
  },
  async syncGa4() {
    $('ga4Msg').textContent = 'Syncing…';
    try {
      await api.get('ga4-sync');
      $('ga4Msg').textContent = 'Synced.';
      this.loadGa4();
    } catch (e) { $('ga4Msg').textContent = 'Error: ' + e.message; toast('GA4 sync: '+e.message,'error'); }
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

    // Android version distribution
    const vers = (ana.version_distribution || []).slice(0, 10);
    this.charts.ver = new Chart($('chVer'), {
      type: 'bar',
      data: { labels: vers.map(v => v.version || '?'), datasets: [{ label: 'Devices',
        data: vers.map(v => +v.cnt || 0), backgroundColor: this.PALETTE[5], borderRadius: 3 }] },
      options: this._baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } } }),
    });

    // Platform counts
    const plat = ana.platform_counts || {};
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('anaIos', plat.ios ?? '—');
    set('anaAndroid', plat.android ?? '—');

    // iOS tunnel stats
    const iosSess = ana.ios_tunnel_stats || {};
    set('anaIosOk', iosSess.success ?? '—');
    const failEl = $('anaIosFail');
    if (failEl) failEl.textContent = (iosSess.fail ?? '—') + ' failed';

    // iOS version distribution
    const iosVers = (ana.ios_version_distribution || []).slice(0, 10);
    if ($('chIosVer')) {
      this.charts.iosver = new Chart($('chIosVer'), {
        type: 'bar',
        data: { labels: iosVers.map(v => v.version || '?'), datasets: [{ label: 'iOS Devices',
          data: iosVers.map(v => +v.cnt || 0), backgroundColor: this.PALETTE[3], borderRadius: 3 }] },
        options: this._baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } } }),
      });
    }

    // iOS stage failure breakdown
    const stages = ana.ios_stage_breakdown || {};
    const stageKeys = Object.keys(stages);
    const stagePanel = $('iosStagePanel');
    set('anaIosStages', stageKeys.length);
    if (stagePanel) {
      if (!stageKeys.length) {
        stagePanel.innerHTML = '<div class="panel-empty">No stage failures in uploaded tunnel logs</div>';
      } else {
        const maxV = Math.max(...Object.values(stages));
        stagePanel.innerHTML = stageKeys.map(k => {
          const v = stages[k];
          const pct = maxV > 0 ? Math.round(v / maxV * 100) : 0;
          return `<div style="margin:.3rem 0">
            <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.15rem">
              <span style="color:var(--muted)">${esc(k)}</span><span><b>${v}</b></span>
            </div>
            <div style="height:5px;background:var(--border,#2a3550);border-radius:3px">
              <div style="height:5px;background:var(--bad,#ef4444);border-radius:3px;width:${pct}%"></div>
            </div>
          </div>`;
        }).join('');
      }
    }

    // iOS recent devices table
    const iosRecent = ana.ios_recent_devices || [];
    const body = $('iosRecentBody');
    if (body) {
      body.innerHTML = iosRecent.length
        ? iosRecent.map(r => `<tr>
            <td><span class="mono" style="font-size:.72rem">${esc(r.device_id||'—')}</span></td>
            <td>${esc(r.app_version||'—')}</td>
            <td>${esc(r.model||'—')}</td>
            <td>${esc(r.last_seen||'—')}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="tbl-empty">No iOS devices yet</td></tr>';
    }
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

// ── VIEW: ADS NOC ────────────────────────────────────────────────────
// Full Ads Performance NOC: KPI cards, Hakim AI, 8 charts, alerts.
// Two parallel loads: legacy ads-metrics (recovery) + new ads-perf-comparison (NOC).
views.ads = {
  charts: {},
  nocDays: 30, nocFrom: null, nocTo: null,
  init() {
    // Config save
    const btn = $('adsCfgSave');
    if (btn) btn.onclick = () => this.save();

    // Filter buttons
    document.querySelectorAll('.noc-filter').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.noc-filter').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const days = b.dataset.days;
        const cr = $('nocCustomRange');
        if (days === 'custom') {
          if (cr) cr.style.display = 'flex';
        } else {
          if (cr) cr.style.display = 'none';
          this.nocDays = parseInt(days, 10);
          this.nocFrom = null; this.nocTo = null;
          this.loadNoc();
          this.loadBanner();
        }
      };
    });
    const applyBtn = $('nocCustomApply');
    if (applyBtn) applyBtn.onclick = () => {
      const f = ($('nocFrom') || {}).value;
      const t = ($('nocTo')   || {}).value;
      if (f && t && f <= t) { this.nocFrom = f; this.nocTo = t; this.loadNoc(); this.loadBanner(); }
    };
    const rfr = $('adsNocRefresh');
    if (rfr) rfr.onclick = () => { this.loadNoc(); this.loadBanner(); };

    this.load();
    this.loadNoc();
    this.loadBanner();
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

  fmtUsd(n, digits = 2) {
    if (n == null) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) });
  },
  fmtPct(n) { return n == null ? '—' : (Number(n) * 100).toFixed(1) + '%'; },
  fmtRoi(n) { return n == null ? '—' : Number(n).toFixed(2) + '×'; },
  fmtSec(n) { return n == null ? '—' : Number(n).toFixed(1) + 's'; },

  // ── Legacy recovery load (ads-metrics) ──────────────────────────────
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
    set('adsMarginGb', this.fmtUsd((+d.revenue_per_gb || 0) - (+d.cost_per_gb || 0)));
    const c = d.config || {}, warn = [];
    if (!c.admob_configured)         warn.push('AdMob ad-unit not configured.');
    if (!c.admob_ssv_enabled)        warn.push('AdMob SSV disabled.');
    if (!c.recovery_node_configured) warn.push('Recovery exit node not configured.');
    const banner = $('adsConfigBanner');
    if (banner) { banner.style.display = warn.length ? '' : 'none'; const bt = $('adsConfigBannerText'); if(bt) bt.textContent = '⚠ ' + warn.join('  '); }
    const ed = d.editable || {}, form = $('adsConfigForm');
    if (form) {
      const secret = k => /uuid|pbk|sid|app_id|unit_id/.test(k);
      form.innerHTML = Object.keys(ed).sort().map(k => {
        const v = ed[k] ?? '';
        return `<label style="font-size:.78rem;display:flex;flex-direction:column;gap:.2rem"><span style="opacity:.6;font-family:monospace">${k}</span><input data-cfg="${k}" type="${secret(k)?'text':(typeof v==='number'?'number':'text')}" value="${String(v).replace(/"/g,'&quot;')}" style="padding:.4rem;border-radius:6px;border:1px solid #2a3550;background:#0f1626;color:#e6ecff"></label>`;
      }).join('');
    }
    const rows = d.review || [], tb = $('adsReviewBody'); const rc = $('adsReviewCount'); if(rc) rc.textContent = (d.review_count ?? 0) + ' under review';
    if (tb) tb.innerHTML = rows.length ? rows.map(r => `<tr><td>${(r.device_id||'').slice(0,16)}</td><td>${r.risk_score}</td><td>${r.risk_flags||'—'}</td><td>${r.source||'—'}</td><td>${r.created_at||''}</td></tr>`).join('') : '<tr><td colspan="5" style="opacity:.6">No events under review.</td></tr>';
    if (typeof Chart !== 'undefined') {
      if (this.charts.legacy) { try { this.charts.legacy.destroy(); } catch(_){} }
      const labels = (d.days || []).map(x => (x || '').slice(5));
      this.charts.legacy = new Chart($('chAds'), {
        type: 'bar', data: { labels, datasets: [{ label: 'AdMob', data: d.ads_series || [], backgroundColor: '#22c55e', borderRadius: 3 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
          scales:{ x:{grid:{color:'rgba(138,155,191,.12)'},ticks:{color:'#8a9bbf',maxRotation:0,autoSkip:true,font:{size:10}}},
                   y:{grid:{color:'rgba(138,155,191,.12)'},ticks:{color:'#8a9bbf',font:{size:10}},beginAtZero:true} } },
      });
    }
  },

  // ── Full NOC load (ads-perf-comparison) ─────────────────────────────
  async loadNoc() {
    const params = this.nocFrom && this.nocTo
      ? { from: this.nocFrom, to: this.nocTo }
      : { days: this.nocDays };
    const ts = $('nocTs'); if (ts) ts.textContent = 'Laster…';
    let d;
    try { d = await api.get('ads-perf-comparison', params); } catch (e) { return; }
    if (ts) ts.textContent = d.checked_at || '';

    this.renderAlerts(d.alerts || []);
    this.renderKpis(d);
    this.renderHakim(d.hakim || {});
    this.renderCharts(d);
  },

  renderAlerts(alerts) {
    const bar = $('nocAlertBar');
    if (!bar) return;
    if (!alerts.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    const colors = { error: '#f87171', warn: '#f59e0b', info: '#60a5fa' };
    bar.style.display = '';
    bar.innerHTML = alerts.map(a => {
      const c = colors[a.level] || '#8a9bbf';
      return `<div style="padding:.4rem .75rem;border-left:3px solid ${c};background:${c}18;border-radius:4px;font-size:.8rem;margin-bottom:.35rem;color:${c}">
        <strong>${a.platform}:</strong> ${a.msg}
      </div>`;
    }).join('');
  },

  renderKpis(d) {
    const grid = $('nocKpiGrid');
    if (!grid) return;
    const am = d.admob || {}, ag = d.adsgram || {};
    const amt = am.totals || {}, agt = ag.totals || {};
    const am_t = am.today || {}, ag_t = ag.today || {};
    const am_7 = am['7d'] || {},  ag_7 = ag['7d'] || {};
    const cv = d.conversion || {};
    const AG_COLOR = '#f59e0b', AM_COLOR = '#22c55e', MISS = '<span style="opacity:.4">—</span>';
    const fU = (n, d=2) => n == null || n === 0 ? MISS : '$'+Number(n).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:Math.max(d,4)});
    const fP = n => n == null ? MISS : (Number(n)*100).toFixed(1)+'%';
    const fR = n => n == null || n === 0 ? MISS : Number(n).toFixed(2)+'×';
    const fN = n => n == null ? MISS : Number(n).toLocaleString();
    const fG = n => (!n || n===0) ? MISS : Number(n).toFixed(3)+' GB';

    const kpis = [
      { label: 'Revenue i dag',    am: fU(am_t.revenue_usd), ag: fU(ag_t.revenue_usd) },
      { label: 'Revenue 7 dager',  am: fU(am_7.revenue_usd), ag: fU(ag_7.revenue_usd) },
      { label: 'Revenue (vindu)',   am: fU(amt.revenue_usd),  ag: fU(agt.revenue_usd)  },
      { label: 'eCPM',             am: fU(amt.ecpm_usd),     ag: fU(agt.ecpm_usd)     },
      { label: 'ARPDAU',           am: fU(amt.revenue_per_user, 4), ag: fU(agt.revenue_per_user, 4) },
      { label: 'Fill rate',        am: fP(amt.fill_rate),    ag: fP(agt.fill_rate)    },
      { label: 'Rewarded views',   am: fN(amt.rewarded_views), ag: fN(agt.rewarded_views) },
      { label: 'Konvertering →',   am: `${cv.linked_devices??0}/${cv.total_devices??0}`, ag: fP(cv.rate) },
      { label: 'GB utdelt',        am: fG(amt.gb_granted),   ag: fG(agt.gb_granted)   },
      { label: 'ROI',              am: fR(amt.roi),          ag: fR(agt.roi)           },
    ];

    grid.innerHTML = kpis.map(k => `
      <div class="stat-card" style="padding:.6rem .75rem">
        <div class="stat-label" style="margin-bottom:.3rem">${k.label}</div>
        <div style="display:flex;gap:.5rem;align-items:flex-end">
          <div style="flex:1;min-width:0">
            <div style="font-size:1rem;font-weight:700;color:${AM_COLOR};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${k.am}</div>
            <div style="font-size:.65rem;opacity:.5;margin-top:.1rem">AdMob</div>
          </div>
          <div style="flex:1;min-width:0;border-left:1px solid #1e2d4d;padding-left:.5rem">
            <div style="font-size:1rem;font-weight:700;color:${AG_COLOR};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${k.ag}</div>
            <div style="font-size:.65rem;opacity:.5;margin-top:.1rem">AdsGram</div>
          </div>
        </div>
      </div>`).join('');
  },

  renderHakim(h) {
    const body = $('nocHakimBody'), badge = $('nocHakimBadge');
    if (!body) return;
    if (badge) {
      const conf = { high: '● Høy sikkerhet', medium: '◐ Middels sikkerhet', low: '○ Lav sikkerhet', waiting: '' };
      badge.textContent = conf[h.confidence] || '';
    }
    const recColors = { realink: '#22c55e', adsgram: '#f59e0b', both: '#60a5fa', waiting: '#8a9bbf' };
    const c = recColors[h.recommendation] || '#8a9bbf';
    const rationale = (h.rationale || []).map(r => `<li>${r}</li>`).join('');
    const kpis = (h.kpis || []).map(k => `<div style="font-family:monospace;font-size:.75rem;background:#111827;padding:.2rem .5rem;border-radius:4px;margin:.15rem 0">${k}</div>`).join('');
    body.innerHTML = `
      <div style="display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap">
        <div style="min-width:200px">
          <div style="font-size:1.1rem;font-weight:700;color:${c};margin-bottom:.4rem">${h.label || '—'}</div>
          ${h.action ? `<div style="font-size:.8rem;background:${c}18;border-radius:6px;padding:.4rem .6rem;color:${c};margin-bottom:.5rem">${h.action}</div>` : ''}
        </div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:.78rem;font-weight:600;opacity:.6;margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em">Begrunnelse</div>
          <ul style="font-size:.82rem;margin:0;padding-left:1.1rem;line-height:1.7;opacity:.85">${rationale || '<li style="opacity:.5">Ingen data ennå.</li>'}</ul>
          ${kpis ? `<div style="margin-top:.5rem">${kpis}</div>` : ''}
        </div>
      </div>`;
  },

  renderCharts(d) {
    if (typeof Chart === 'undefined') return;
    Object.values(this.charts).forEach(c => { try { if (c !== this.charts.legacy) c.destroy(); } catch(_){} });
    // Keep legacy chart reference
    const legacyChart = this.charts.legacy;
    this.charts = { legacy: legacyChart };

    const labels = (d.days || []).map(x => (x||'').slice(5));
    const am = d.admob || {}, ag = d.adsgram || {}, cv = d.conversion || {};
    const AM = '#22c55e', AG = '#f59e0b';
    const opts = (extra = {}) => ({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position:'top', labels:{ color:'#8a9bbf', boxWidth:10, font:{size:10} } } },
      scales: {
        x: { grid:{color:'rgba(138,155,191,.09)'}, ticks:{color:'#8a9bbf',maxRotation:0,autoSkip:true,font:{size:9}} },
        y: { grid:{color:'rgba(138,155,191,.09)'}, ticks:{color:'#8a9bbf',font:{size:9}}, beginAtZero:true },
        ...extra,
      },
    });
    const line = (label, data, color, fill=false, tension=.35) => ({
      label, data, borderColor:color, backgroundColor: fill ? color+'22':'transparent',
      tension, fill, pointRadius:2, spanGaps:true,
    });
    const bar_ = (label, data, color) => ({ label, data, backgroundColor:color+'aa', borderRadius:3 });

    const mk = (id, type, datasets, extraOpts={}) => {
      const el = $(id); if (!el) return;
      this.charts[id] = new Chart(el, { type, data:{ labels, datasets }, options:{ ...opts(extraOpts) } });
    };

    mk('chNocRev',    'bar',  [bar_('AdMob',   am.rev_series||[],AM),    bar_('AdsGram',  ag.rev_series||[],AG)]);
    mk('chNocViews',  'bar',  [bar_('AdMob',   am.views_series||[],AM),  bar_('AdsGram',  ag.views_series||[],AG)]);
    mk('chNocEcpm',   'line', [line('AdMob',   am.ecpm_series||[],AM,false), line('AdsGram',ag.ecpm_series||[],AG,false)]);
    mk('chNocFill',   'line', [line('AdMob',   am.fill_series||[],AM,false), line('AdsGram',ag.fill_series||[],AG,false)]);
    mk('chNocArpdau', 'line', [line('AdMob',   am.arpdau_series||[],AM,true), line('AdsGram',ag.arpdau_series||[],AG,true)]);
    mk('chNocGb',     'bar',  [bar_('AdMob',   am.gb_series||[],AM),     bar_('AdsGram',  ag.gb_series||[],AG)]);
    mk('chNocConv',   'bar',  [bar_('Nye koblinger', cv.daily_series||[], '#60a5fa')]);

    // Cumulative revenue
    const cumul = (arr) => { let s=0; return (arr||[]).map(v => (s += (v||0), Math.round(s*1000)/1000)); };
    mk('chNocCumul', 'line', [line('AdMob kumulativ', cumul(am.rev_series),AM,true), line('AdsGram kumulativ',cumul(ag.rev_series),AG,true)]);
  },

  // ── Banner Ads (Home / Freedom) ──────────────────────────────────────
  // Requests/Loaded/Impressions/Clicks/CTR/Revenue/No-fill per placement
  // (Khabat, 2026-07-19) — same period selector as the NOC charts above.
  async loadBanner() {
    const params = this.nocFrom && this.nocTo
      ? { from: this.nocFrom, to: this.nocTo }
      : { days: this.nocDays };
    let d;
    try { d = await api.get('banner-ads-stats', params); } catch (e) { return; }
    const row = (label, v) => `<tr><td style="font-size:.76rem;color:var(--muted-2)">${label}</td><td style="font-size:.76rem;text-align:right;font-family:var(--mono)">${v}</td></tr>`;
    const renderSlot = (id, s) => {
      const el = $(id); if (!el) return;
      el.innerHTML = [
        row('Requests',    s.requests ?? 0),
        row('Loaded',      s.loaded ?? 0),
        row('Impressions', s.impressions ?? 0),
        row('Clicks',      s.clicks ?? 0),
        row('CTR',         s.ctr == null ? '—' : s.ctr.toFixed(2) + '%'),
        row('Revenue',     this.fmtUsd(s.revenue_usd, 4)),
        row('No-fill',     s.no_fill ?? 0),
      ].join('');
    };
    renderSlot('bannerAdsHome',    d.home_banner    || {});
    renderSlot('bannerAdsFreedom', d.freedom_banner || {});
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
        <div class="stat-card"><div class="stat-label">Distinct SNIs</div><div class="stat-value">${fmtNum(s.sni_count)}</div></div>
        <div class="stat-card"><div class="stat-label">Avg RTT</div><div class="stat-value">${s.avg_rtt!=null?Math.round(s.avg_rtt)+' ms':'—'}</div></div>
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

// ── VIEW: NETWORK INTEL ──────────────────────────────────────────────
views.intel = {
  chart: null,
  init() {
    $('intelRefreshBtn').addEventListener('click', ()=>this.load());
    $('intelDays').addEventListener('change', ()=>this.load());
    $('diagRefreshBtn').addEventListener('click', ()=>this.loadDiagSessions());
    this.load();
  },
  async load() {
    const days = $('intelDays').value;
    $('intelNote').textContent = 'Loading…';
    try {
      const d = await api.get('node-intel', {days});
      this.renderRecs(d.recommendations || []);
      this.renderInsights(d.agent_insights || []);
      this.renderNodes(d.node_scores || {});
      this.renderPlatform(d.platform_breakdown || []);
      this.renderNetwork(d.network_breakdown || []);
      this.renderIsp(d.isp_breakdown || []);
      this.renderProfiles(d.node_profile_scores || []);
      this.renderBuild(d.build_breakdown || []);
      this.renderProbes(d.probe_breakdown || []);
      this.renderCountry(d.country_breakdown || []);
      this.renderFailures(d.recent_failures || []);
      this.renderTimeline(d.timeline || []);
      $('intelNote').textContent = `Anonymous telemetry · ${days}-day window`;
    } catch(e) {
      $('intelNote').textContent = 'Error: ' + esc(e.message);
    }
  },
  renderNodes(scores) {
    const ids = Object.keys(scores);
    if (!ids.length) {
      $('intelNodeTbl').innerHTML = '<tr><td colspan="7" class="tbl-empty">No telemetry data yet — connect events will appear here once the app uploads them.</td></tr>';
      return;
    }
    const rateColor = r => r===null?'var(--muted)':r>=80?'var(--ok)':r>=50?'var(--warn)':'var(--danger)';
    $('intelNodeTbl').innerHTML = ids.map(id => {
      const n = scores[id];
      const rate = n.success_rate;
      return `<tr>
        <td><strong>${esc(id)}</strong></td>
        <td>${fmtNum(n.total)}</td>
        <td style="color:var(--ok)">${fmtNum(n.ok)}</td>
        <td style="color:var(--danger)">${fmtNum(n.fail)}</td>
        <td style="color:${rateColor(rate)};font-weight:700">${rate !== null ? rate+'%' : '—'}</td>
        <td>${n.avg_latency_ms !== null ? n.avg_latency_ms+' ms' : '—'}</td>
        <td style="font-size:.7rem;color:var(--muted)">${esc((n.last_event_at||'').replace('T',' ').replace('Z',''))}</td>
      </tr>`;
    }).join('');
  },
  renderPlatform(rows) {
    if (!rows.length) { $('intelPlatformTbl').innerHTML = '<tr><td colspan="5" class="tbl-empty">No data</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelPlatformTbl').innerHTML = rows.map(r => `<tr>
      <td>${esc(r.node_id)}</td>
      <td>${r.platform==='ios'?'🍎':r.platform==='android'?'🤖':'?'} ${esc(r.platform)}</td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
    </tr>`).join('');
  },
  renderNetwork(rows) {
    if (!rows.length) { $('intelNetworkTbl').innerHTML = '<tr><td colspan="4" class="tbl-empty">No data</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelNetworkTbl').innerHTML = rows.map(r => `<tr>
      <td>${r.network_type==='wifi'?'📶':r.network_type==='mobile'?'📡':'?'} ${esc(r.network_type)}</td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
    </tr>`).join('');
  },
  renderIsp(rows) {
    if (!rows.length) { $('intelIspTbl').innerHTML = '<tr><td colspan="7" class="tbl-empty">No ISP data yet (requires isp field in telemetry payload)</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelIspTbl').innerHTML = rows.map(r => `<tr>
      <td class="mono" style="font-size:.72rem">${esc(r.isp_hash)}</td>
      <td>${esc(r.country||'?')}</td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="color:var(--danger)">${fmtNum(r.fail)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
      <td>${r.avg_latency_ms !== null ? r.avg_latency_ms+' ms' : '—'}</td>
    </tr>`).join('');
  },
  renderProfiles(rows) {
    if (!rows.length) { $('intelProfileTbl').innerHTML = '<tr><td colspan="6" class="tbl-empty">No data</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelProfileTbl').innerHTML = rows.map(r => `<tr>
      <td>${esc(r.node_id)}</td>
      <td class="mono" style="font-size:.72rem">${esc(r.profile_id)}</td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
      <td>${r.avg_latency_ms !== null ? r.avg_latency_ms+' ms' : '—'}</td>
    </tr>`).join('');
  },
  renderCountry(rows) {
    if (!rows.length) { $('intelCountryTbl').innerHTML = '<tr><td colspan="4" class="tbl-empty">No data</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelCountryTbl').innerHTML = rows.map(r => `<tr>
      <td><strong>${esc(r.country)}</strong></td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
    </tr>`).join('');
  },
  renderFailures(rows) {
    if (!rows.length) { $('intelFailTbl').innerHTML = '<tr><td colspan="10" class="tbl-empty">No recent failures</td></tr>'; return; }
    const evtColor = e => e==='connect_ok'?'var(--ok)':e==='internet_fail'?'var(--warn)':'var(--danger)';
    $('intelFailTbl').innerHTML = rows.slice(0,100).map(r => `<tr>
      <td style="font-size:.68rem;color:var(--muted)">${esc((r.created_at||'').replace('T',' ').replace('Z',''))}</td>
      <td><span style="color:${evtColor(r.event)};font-size:.72rem;font-weight:700">${esc(r.event)}</span></td>
      <td>${esc(r.node_id||'')}</td>
      <td class="mono" style="font-size:.68rem">${esc(r.profile_id||'—')}</td>
      <td class="mono" style="font-size:.68rem">${esc(r.sni||'—')}</td>
      <td>${r.platform==='ios'?'🍎':r.platform==='android'?'🤖':'?'} ${esc(r.platform||'?')}</td>
      <td>${esc(r.network_type||'?')}</td>
      <td>${esc(r.country||'?')}</td>
      <td style="font-size:.68rem;color:var(--warn)">${esc(r.failure_stage||'—')}</td>
      <td>${r.latency_ms !== null && r.latency_ms !== undefined ? r.latency_ms+' ms' : '—'}</td>
    </tr>`).join('');
  },
  renderInsights(rows) {
    if (!rows.length) {
      $('intelInsights').innerHTML = '<span style="color:var(--muted);font-size:.85rem">No insights yet.</span>';
      return;
    }
    const icon  = l => l==='warn'?'⚠️':l==='ok'?'✅':'ℹ️';
    const color = l => l==='warn'?'var(--warn)':l==='ok'?'var(--ok)':'var(--muted)';
    $('intelInsights').innerHTML = `<div style="display:flex;flex-direction:column;gap:.5rem">`
      + rows.map(r => `<div style="display:flex;align-items:flex-start;gap:.5rem;padding:.5rem .75rem;border-radius:6px;background:rgba(255,255,255,.04);border-left:3px solid ${color(r.level)}">
          <span style="flex-shrink:0">${icon(r.level)}</span>
          <span style="font-size:.85rem;color:var(--text)">${esc(r.message)}</span>
        </div>`).join('')
      + '</div>';
  },
  renderRecs(rows) {
    const el  = $('intelRecs');
    const cnt = $('intelRecsCount');
    if (!rows.length) {
      el.innerHTML = '<span style="color:var(--muted);font-size:.85rem">No recommendations — all patterns within normal range.</span>';
      cnt.textContent = '';
      return;
    }
    const critCount = rows.filter(r=>r.severity==='critical').length;
    const warnCount = rows.filter(r=>r.severity==='warn').length;
    cnt.textContent = [
      critCount ? `${critCount} critical` : '',
      warnCount ? `${warnCount} warning`  : '',
    ].filter(Boolean).join(' · ');

    const sev      = s => s==='critical'?'#f87171':s==='warn'?'#fbbf24':'#60a5fa';
    const sevLabel = s => s==='critical'?'CRITICAL':s==='warn'?'WARN':'INFO';
    const typeIcon = t => ({route:'🔀',infra:'🖥',protocol:'📡',security:'🔒',platform:'📱'})[t]||'•';

    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:.6rem">`
      + rows.map(r => `
        <div style="border-left:3px solid ${sev(r.severity)};background:rgba(255,255,255,.03);border-radius:0 6px 6px 0;padding:.65rem .85rem">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
            <span style="font-size:.68rem;font-weight:700;color:${sev(r.severity)};letter-spacing:.04em">${sevLabel(r.severity)}</span>
            <span style="font-size:.7rem;color:var(--muted-2);background:rgba(255,255,255,.06);padding:1px 6px;border-radius:3px">${typeIcon(r.type)} ${esc((r.type||'').toUpperCase())}</span>
            <span style="font-size:.85rem;font-weight:700;color:var(--text)">${esc(r.title)}</span>
          </div>
          <div style="font-size:.8rem;color:var(--muted);margin-bottom:.3rem">${esc(r.body)}</div>
          <div style="font-size:.75rem;color:var(--accent)">→ ${esc(r.action)}</div>
        </div>`).join('')
      + '</div>';
  },
  async loadDiagSessions() {
    const btn = $('diagRefreshBtn');
    btn.textContent = 'Loading…';
    btn.disabled = true;
    try {
      const params = {};
      const srv = $('diagServer').value; if (srv) params.server = srv;
      const cp1 = $('diagCp1').value;   if (cp1) params.cp1    = cp1;
      const cp4 = $('diagCp4').value;   if (cp4) params.cp4    = cp4;
      const code= $('diagCode').value;   if (code) params.conclusion_code = code;
      params.limit = 100;
      const d = await api.get('diag-sessions', params);
      this.renderDiagSessions(d.sessions || [], d.by_server || {});
    } catch(e) {
      $('diagSessionTbl').innerHTML = `<tr><td colspan="13" class="tbl-empty">${esc(e.message)}</td></tr>`;
    } finally {
      btn.textContent = 'Search';
      btn.disabled = false;
    }
  },
  renderDiagSessions(rows, byServer) {
    const cpBadge = v => {
      if (v === 'PASS')    return `<span style="color:var(--ok);font-weight:700">PASS</span>`;
      if (v === 'FAIL')    return `<span style="color:var(--danger);font-weight:700">FAIL</span>`;
      return `<span style="color:var(--muted-2);font-size:.72rem">—</span>`;
    };
    const codeBadge = c => {
      const map = {tunnel_ok:'ok',cp1_fail:'danger',cp4_fail:'danger',proxy_mode:'',no_data:''};
      const cls = map[c]?`color:var(--${map[c]})`:' color:var(--muted)';
      return `<span style="${cls};font-size:.72rem;font-weight:600">${esc(c||'—')}</span>`;
    };
    const srvBadge = (s) => {
      if ((s||'').includes('Finland')) return `<span style="font-size:.8rem">🇫🇮 ${esc(s)}</span>`;
      if ((s||'').includes('Germany') || (s||'').includes('Primary')) return `<span style="font-size:.8rem">🇩🇪 ${esc(s)}</span>`;
      return `<span style="font-size:.78rem">${esc(s||'?')}</span>`;
    };
    // Side-by-side server summary
    const servers = Object.keys(byServer);
    const sbDiv = $('diagSideBySide');
    if (servers.length >= 2) {
      sbDiv.style.display = '';
      sbDiv.innerHTML = `<div style="display:grid;grid-template-columns:repeat(${servers.length},1fr);gap:1rem;margin-bottom:.75rem">`
        + servers.map(srv => {
          const sRows = byServer[srv] || [];
          const total = sRows.length;
          const cp1p  = sRows.filter(r=>r.cp1_result==='PASS').length;
          const cp4p  = sRows.filter(r=>r.cp4_result==='PASS').length;
          const ok    = sRows.filter(r=>r.conclusion_code==='tunnel_ok').length;
          const flag  = srv.includes('Finland')?'🇫🇮':srv.includes('Germany')||srv.includes('Primary')?'🇩🇪':'🌐';
          return `<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:.75rem 1rem">
            <div style="font-weight:700;font-size:.9rem;margin-bottom:.5rem">${flag} ${esc(srv)}</div>
            <div style="font-size:.78rem;line-height:1.8">
              Sessions: <strong>${total}</strong><br>
              CP1 PASS: <strong style="color:var(--ok)">${cp1p}</strong> / ${total}<br>
              CP4 PASS: <strong style="color:var(--ok)">${cp4p}</strong> / ${total}<br>
              Tunnel OK: <strong style="color:var(--ok)">${ok}</strong> / ${total}
            </div>
          </div>`;
        }).join('')
        + '</div>';
    } else {
      sbDiv.style.display = 'none';
    }
    if (!rows.length) {
      $('diagSessionTbl').innerHTML = '<tr><td colspan="13" class="tbl-empty">No sessions found — run a test then disconnect to generate one</td></tr>';
      return;
    }
    $('diagSessionTbl').innerHTML = rows.map(r => `<tr>
      <td style="font-size:.66rem;color:var(--muted);white-space:nowrap">${esc((r.created_at||'').slice(0,16).replace('T',' '))}</td>
      <td>${srvBadge(r.server_label)}</td>
      <td style="font-size:.72rem">${esc(r.tunnel_mode||'—')}</td>
      <td>${cpBadge(r.cp1_result)}</td>
      <td>${cpBadge(r.cp2_result)}</td>
      <td>${cpBadge(r.cp3_result)}</td>
      <td>${cpBadge(r.cp4_result)}</td>
      <td style="font-size:.78rem;font-weight:700">${r.cp4_connections > 0 ? r.cp4_connections : '0'}</td>
      <td class="mono" style="font-size:.65rem;color:var(--muted-2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.cp4_first_dest||'')}">${esc(r.cp4_first_dest||'—')}</td>
      <td style="font-size:.72rem">${r.vps_connections !== null ? r.vps_connections : '<span style="color:var(--muted-2)">n/a</span>'}</td>
      <td style="max-width:220px">${codeBadge(r.conclusion_code)}</td>
      <td style="font-size:.72rem;color:var(--muted)">${r.session_duration_secs !== null ? r.session_duration_secs+'s' : '—'}</td>
      <td style="font-size:.66rem;color:var(--muted-2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.disconnect_reason||'')}">${esc(r.disconnect_reason||'—')}</td>
    </tr>`).join('');
  },
  renderBuild(rows) {
    if (!rows.length) { $('intelBuildTbl').innerHTML = '<tr><td colspan="6" class="tbl-empty">No build data yet</td></tr>'; return; }
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelBuildTbl').innerHTML = rows.map(r => `<tr>
      <td><strong>#${r.build_number}</strong></td>
      <td>${r.platform==='ios'?'🍎':r.platform==='android'?'🤖':'?'} ${esc(r.platform||'?')}</td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:600">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
      <td>${r.avg_latency_ms !== null ? r.avg_latency_ms+' ms' : '—'}</td>
    </tr>`).join('');
  },
  renderProbes(rows) {
    if (!rows.length) { $('intelProbeTbl').innerHTML = '<tr><td colspan="4" class="tbl-empty">No probe data yet — requires updated app build</td></tr>'; return; }
    const icons = {google:'🌐',apple:'🍎',telegram:'✈️',cloudflare:'☁️',instagram:'📸'};
    const rateColor = r => r===null?'':r>=80?'color:var(--ok)':r>=50?'color:var(--warn)':'color:var(--danger)';
    $('intelProbeTbl').innerHTML = rows.map(r => `<tr>
      <td><strong>${icons[r.probe]||'🔵'} ${esc(r.probe)}</strong></td>
      <td>${fmtNum(r.total)}</td>
      <td style="color:var(--ok)">${fmtNum(r.ok)}</td>
      <td style="${rateColor(r.success_rate)};font-weight:700">${r.success_rate !== null ? r.success_rate+'%' : '—'}</td>
    </tr>`).join('');
  },
  renderTimeline(rows) {
    const canvas = document.getElementById('intelTimelineChart');
    const emptyEl = $('intelTimelineEmpty');
    if (!rows.length) {
      canvas.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    canvas.style.display = '';
    emptyEl.style.display = 'none';
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    try {
      const labels = rows.map(r => r.day);
      const rates  = rows.map(r => r.success_rate);
      const totals = rows.map(r => r.total);
      this.chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Success Rate %', data: rates, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,.08)', tension: 0.3, yAxisID: 'y' },
            { label: 'Total Events',   data: totals, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,.06)', tension: 0.3, yAxisID: 'y2', borderDash: [4,3] },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#8a9bbf', font: { size: 11 } } } },
          scales: {
            x:  { ticks: { color: '#8a9bbf', maxRotation: 45, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
            y:  { min: 0, max: 100, position: 'left',  ticks: { color: '#8a9bbf', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: 'Success %', color: '#8a9bbf', font: { size: 10 } } },
            y2: { position: 'right', ticks: { color: '#60a5fa', font: { size: 10 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Events', color: '#60a5fa', font: { size: 10 } } },
          },
        },
      });
    } catch(e) { /* Chart.js not yet loaded / canvas issue */ }
  },
};

// ── VIEW: STARLINK ───────────────────────────────────────────────────
views.starlink = {
  init() {
    $('stRefreshBtn').addEventListener('click', ()=>this.load());
    this.load();
  },
  async load() {
    try {
      const d = await api.get('starlink-list');
      this.renderNodes(d.nodes || []);
      this.renderLog(d.log || []);
    } catch(e) {
      $('stNodesWrap').innerHTML = `<div class="panel-empty">Error: ${esc(e.message)}</div>`;
    }
  },
  healthColor(h) {
    return h==='ONLINE' ? 'var(--ok)' : h==='DEGRADED' ? 'var(--warn)' : h==='MAINTENANCE' ? 'var(--muted)' : 'var(--danger)';
  },
  renderNodes(nodes) {
    if (!nodes.length) { $('stNodesWrap').innerHTML = '<div class="panel-empty">No Starlink nodes registered yet.</div>'; return; }
    $('stNodesWrap').innerHTML = nodes.map(n => {
      const allow = (n.allowlist||[]).map(a=>`<span class="chip">${esc(a.device_id)} <a href="#" data-remove-device="${esc(a.device_id)}" data-node="${esc(n.node_id)}" title="Revoke">×</a></span>`).join(' ') || '<span style="color:var(--muted)">none</span>';
      return `<div class="panel" style="margin-bottom:1rem" data-node-panel="${esc(n.node_id)}">
        <div class="panel-header" style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <span class="panel-title">${esc(n.display_name)} <span style="font-weight:400;color:var(--muted)">(${esc(n.node_id)})</span></span>
          <span class="badge" style="background:${this.healthColor(n.health_state)}20;color:${this.healthColor(n.health_state)};border:1px solid ${this.healthColor(n.health_state)}">${esc(n.health_state)}</span>
          <span class="badge" style="margin-left:auto">${n.enabled ? 'Enabled' : 'Disabled'} · ${esc(n.testing_state)}</span>
        </div>
        <div class="panel-body" style="padding:.75rem 1rem;font-size:.8rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.5rem">
          <div><b>Country</b><br>${esc(n.country)}</div>
          <div><b>Tunnel</b><br>${esc(n.tunnel_status)}</div>
          <div><b>Last heartbeat</b><br>${esc((n.last_heartbeat_at||'never').replace('T',' '))}</div>
          <div><b>Public IPv4</b><br>${esc(n.public_ipv4||'—')}</div>
          <div><b>Public IPv6</b><br>${esc(n.public_ipv6||'—')}</div>
          <div><b>Exit IP</b><br>${esc(n.exit_ip||'—')}</div>
          <div><b>Latency</b><br>${n.latency_ms!=null?n.latency_ms+' ms':'—'}</div>
          <div><b>Packet loss</b><br>${n.packet_loss_pct!=null?n.packet_loss_pct+'%':'—'}</div>
          <div><b>Recent disconnects</b><br>${fmtNum(n.recent_disconnects||0)}</div>
          <div><b>Down / Up</b><br>${n.measured_download_kbps!=null?(n.measured_download_kbps/1000).toFixed(1)+' Mbps':'—'} / ${n.measured_upload_kbps!=null?(n.measured_upload_kbps/1000).toFixed(1)+' Mbps':'—'}</div>
          <div><b>Sessions</b><br>${n.current_sessions}/${n.max_sessions}</div>
          <div><b>Allocated</b><br>${(n.allocated_kbps/1000).toFixed(0)} Mbps of ${(n.nominal_capacity_kbps/1000).toFixed(0)} Mbps nominal</div>
          <div><b>Version</b><br>${esc(n.software_version||'—')}</div>
          <div><b>Last error</b><br><span style="color:var(--danger)">${esc(n.last_error||'—')}</span></div>
        </div>
        <div class="panel-body" style="padding:0 1rem 1rem;display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-sm ${n.enabled?'btn-secondary':'btn-primary'}" data-act="toggle" data-node="${esc(n.node_id)}" data-val="${n.enabled?0:1}">${n.enabled?'Disable':'Enable'}</button>
          <button class="btn btn-sm btn-secondary" data-act="maint" data-node="${esc(n.node_id)}" data-val="${n.maintenance_mode?0:1}">${n.maintenance_mode?'Exit maintenance':'Enter maintenance'}</button>
          <button class="btn btn-sm btn-secondary" data-act="fallback" data-node="${esc(n.node_id)}">Force fallback</button>
          <button class="btn btn-sm btn-secondary" data-act="token" data-node="${esc(n.node_id)}">Generate heartbeat token</button>
          <button class="btn btn-sm btn-secondary" data-act="winsetup" data-node="${esc(n.node_id)}" title="Generate new token + download self-installing PowerShell setup script for Windows gateway">⬇ Windows setup (.ps1)</button>
        </div>
        <div class="panel-body" style="padding:0 1rem 1rem">
          <b style="font-size:.8rem">Allowlisted test devices</b><br>
          <div style="margin:.4rem 0">${allow}</div>
          <form data-allow-form="${esc(n.node_id)}" style="display:flex;gap:.4rem">
            <input class="input btn-sm" name="device_id" placeholder="device_id" style="flex:1">
            <button class="btn btn-sm btn-primary" type="submit">Allow</button>
          </form>
        </div>
      </div>`;
    }).join('');

    $('stNodesWrap').querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => this.act(btn)));
    $('stNodesWrap').querySelectorAll('[data-remove-device]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      this.allowlistRemove(a.dataset.node, a.dataset.removeDevice);
    }));
    $('stNodesWrap').querySelectorAll('[data-allow-form]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const did = f.device_id.value.trim();
      if (did) this.allowlistAdd(f.dataset.allowForm, did);
    }));
  },
  async act(btn) {
    const node = btn.dataset.node, act = btn.dataset.act;
    try {
      if (act === 'toggle') {
        await api.post({action:'starlink-toggle-enabled', node_id:node, enabled: btn.dataset.val === '1'});
      } else if (act === 'maint') {
        await api.post({action:'starlink-set-maintenance', node_id:node, maintenance: btn.dataset.val === '1'});
      } else if (act === 'fallback') {
        if (!confirm('Force this node into fallback (stop routing new sessions) now?')) return;
        await api.post({action:'starlink-force-fallback', node_id:node});
      } else if (act === 'token') {
        const d = await api.post({action:'starlink-generate-token', node_id:node});
        prompt('Heartbeat token (shown once — copy into the gateway config now):', d.heartbeat_token);
      } else if (act === 'winsetup') {
        if (!confirm('This will rotate the heartbeat token and generate a new Windows setup script. Continue?')) return;
        const d = await api.post({action:'starlink-windows-installer', node_id:node});
        const blob = new Blob([d.installer_ps1], {type:'text/plain'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = d.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Setup script downloaded — run as Administrator on the Windows gateway', 'success');
      }
      toast('Updated', 'success');
      this.load();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  },
  async allowlistAdd(node, deviceId) {
    try {
      await api.post({action:'node-allowlist-add', node_id: node, device_id: deviceId});
      toast('Device allowlisted', 'success');
      this.load();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  },
  async allowlistRemove(node, deviceId) {
    try {
      await api.post({action:'node-allowlist-remove', node_id: node, device_id: deviceId});
      toast('Device revoked', 'success');
      this.load();
    } catch(e) { toast('Error: ' + e.message, 'error'); }
  },
  renderLog(rows) {
    if (!rows.length) { $('stLogTbl').innerHTML = '<tr><td colspan="5" class="tbl-empty">No admin activity yet</td></tr>'; return; }
    $('stLogTbl').innerHTML = rows.map(r => `<tr>
      <td style="font-size:.7rem;color:var(--muted)">${esc((r.created_at||'').replace('T',' '))}</td>
      <td>${esc(r.node_id)}</td>
      <td>${esc(r.actor)}</td>
      <td>${esc(r.action)}</td>
      <td style="font-size:.75rem;color:var(--muted)">${esc(r.detail||'')}</td>
    </tr>`).join('');
  },
};

// ── VIEW: AI DIAGNOSIS ───────────────────────────────────────────────
views.aidiag = {
  init() {
    $('aidiagRefreshBtn').addEventListener('click', ()=>this.load());
    $('aidiagDays').addEventListener('change', ()=>this.load());
    this.load();
  },
  async load() {
    const days = $('aidiagDays').value;
    $('aidiagNote').textContent = 'Loading…';
    $('aidiagCards').innerHTML = '<div class="panel" style="padding:1.5rem;text-align:center;color:var(--muted)"><div class="spinner" style="margin:0 auto 1rem"></div>Loading sessions…</div>';
    $('aidiagPatterns').innerHTML = '<div class="spinner"></div>';
    try {
      const d = await api.get('ai-diagnosis', {days, limit: 30});
      // Summary badges
      const s = d.summary || {};
      $('aidTotal').textContent = s.total ?? '—';
      $('aidOk').textContent    = s.tunnel_ok ?? '—';
      $('aidCp1').textContent   = s.cp1_fail  ?? '—';
      $('aidCp4').textContent   = s.cp4_fail  ?? '—';
      this.renderPatterns(d.patterns || []);
      this.renderCards(d.sessions || []);
      $('aidiagNote').textContent = `${(d.sessions||[]).length} sessions · ${days}-day window`;
    } catch(e) {
      $('aidiagNote').textContent = 'Error: ' + esc(e.message);
      $('aidiagCards').innerHTML = `<div class="panel" style="padding:1rem;color:var(--danger)">${esc(e.message)}</div>`;
      $('aidiagPatterns').innerHTML = '';
    }
  },
  renderPatterns(patterns) {
    if (!patterns.length) {
      $('aidiagPatterns').innerHTML = '<span style="color:var(--muted);font-size:.85rem">No cross-session patterns detected yet — need ≥2 sessions with matching device/carrier/build to trigger.</span>';
      return;
    }
    const sev = s => s==='critical'?'#f87171':s==='warn'?'#fbbf24':'#60a5fa';
    const icon = s => s==='critical'?'🚨':s==='warn'?'⚠️':'ℹ️';
    $('aidiagPatterns').innerHTML = `<div style="display:flex;flex-direction:column;gap:.5rem">`
      + patterns.map(p => `<div style="border-left:3px solid ${sev(p.severity)};background:rgba(255,255,255,.04);border-radius:0 6px 6px 0;padding:.6rem .85rem">
          <div style="display:flex;align-items:baseline;gap:.5rem">
            <span>${icon(p.severity)}</span>
            <span style="font-size:.85rem;font-weight:600;color:var(--text)">${esc(p.message)}</span>
          </div>
          ${p.detail ? `<div style="font-size:.72rem;color:var(--muted-2);margin-top:.2rem">${esc(p.detail)}</div>` : ''}
        </div>`).join('')
      + '</div>';
  },
  renderCards(sessions) {
    if (!sessions.length) {
      $('aidiagCards').innerHTML = '<div class="panel" style="padding:1.25rem;color:var(--muted);text-align:center">No sessions found in this time window. Connect and disconnect with build 69+ to generate diagnostic records.</div>';
      return;
    }
    const cpBadge = v => {
      if (v === 'PASS')    return `<span style="background:#166534;color:#4ade80;font-size:.72rem;font-weight:700;padding:2px 7px;border-radius:4px">PASS</span>`;
      if (v === 'FAIL')    return `<span style="background:#7f1d1d;color:#f87171;font-size:.72rem;font-weight:700;padding:2px 7px;border-radius:4px">FAIL</span>`;
      return `<span style="background:rgba(255,255,255,.07);color:var(--muted);font-size:.72rem;padding:2px 7px;border-radius:4px">?</span>`;
    };
    const confColor = c => c>=90?'#4ade80':c>=70?'#fbbf24':'#f87171';
    const confBar   = c => `<div style="display:inline-block;width:${c}px;height:6px;background:${confColor(c)};border-radius:3px;vertical-align:middle;max-width:100px"></div>`;
    const netIcon   = n => n==='wifi'?'📶':n==='mobile'?'📱':'🌐';
    const srvFlag   = s => (s||'').includes('Finland')?'🇫🇮':(s||'').includes('Germany')||(s||'').includes('Primary')?'🇩🇪':'🌐';
    const codeStyle = c => ({tunnel_ok:'color:#4ade80',cp1_fail:'color:#f87171',cp4_fail:'color:#f87171',proxy_mode:'color:var(--muted)',no_data:'color:var(--muted)'})[c]||'';

    $('aidiagCards').innerHTML = sessions.map((s, idx) => {
      const date = (s.created_at||'').slice(0,16).replace('T',' ');
      const conf = s.confidence ?? 0;
      const sugg = (s.suggestions||[]);
      const conc = s.conclusion_code || 'unknown';
      return `<div class="panel" style="border-left:3px solid ${confColor(conf)};overflow:hidden">
        <!-- Header row -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:.85rem 1rem .5rem;gap:.5rem;flex-wrap:wrap">
          <div>
            <span style="font-size:.7rem;color:var(--muted-2);font-family:var(--mono)">#${esc(s.session_id||'?')}</span>
            <span style="font-size:.7rem;color:var(--muted);margin-left:.6rem">${esc(date)}</span>
          </div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
            <span style="font-size:.78rem;font-weight:600">${srvFlag(s.server_label)} ${esc(s.server_label||'?')}</span>
            ${s.build_number ? `<span style="background:rgba(255,255,255,.07);color:var(--text);font-size:.7rem;padding:2px 6px;border-radius:4px">Build #${s.build_number}</span>` : ''}
            ${s.tunnel_mode ? `<span style="background:rgba(96,165,250,.15);color:#60a5fa;font-size:.7rem;padding:2px 6px;border-radius:4px">${esc(s.tunnel_mode)}</span>` : ''}
            ${s.ios_version  ? `<span style="font-size:.7rem;color:var(--muted)">iOS ${esc(s.ios_version)}</span>` : ''}
            ${s.device_model ? `<span style="font-size:.7rem;color:var(--muted-2);font-family:var(--mono)">${esc(s.device_model)}</span>` : ''}
          </div>
        </div>

        <!-- Context row -->
        <div style="padding:0 1rem .65rem;display:flex;gap:.75rem;flex-wrap:wrap;font-size:.75rem;color:var(--muted)">
          ${s.network_type ? `${netIcon(s.network_type)} <span>${s.network_type==='wifi'?'WiFi':'Cellular'}</span>` : ''}
          ${s.carrier      ? `<span>📡 ${esc(s.carrier)}</span>` : ''}
          ${s.country      ? `<span>🌍 ${esc(s.country)}</span>` : ''}
          ${s.session_duration_secs ? `<span>⏱ ${s.session_duration_secs}s</span>` : ''}
        </div>

        <!-- CP badge row -->
        <div style="padding:.5rem 1rem .65rem;display:flex;gap:.5rem;align-items:center">
          <span style="font-size:.72rem;color:var(--muted-2);width:32px">CP1</span>${cpBadge(s.cp1_result)}
          <span style="font-size:.72rem;color:var(--muted-2);margin-left:.35rem;width:32px">CP2</span>${cpBadge(s.cp2_result)}
          <span style="font-size:.72rem;color:var(--muted-2);margin-left:.35rem;width:32px">CP3</span>${cpBadge(s.cp3_result)}
          <span style="font-size:.72rem;color:var(--muted-2);margin-left:.35rem;width:32px">CP4</span>${cpBadge(s.cp4_result)}
          ${s.cp4_connections > 0 ? `<span style="font-size:.7rem;color:var(--muted);margin-left:.5rem">${s.cp4_connections} Xray conn${s.cp4_connections!==1?'s':''}</span>` : ''}
          ${s.cp4_first_dest ? `<span style="font-size:.68rem;color:var(--muted-2);font-family:var(--mono);margin-left:.3rem">→ ${esc(s.cp4_first_dest)}</span>` : ''}
        </div>

        <!-- Diagnosis -->
        <div style="background:rgba(0,0,0,.18);border-top:1px solid rgba(255,255,255,.05);padding:.75rem 1rem">
          <div style="font-size:.72rem;font-weight:700;color:var(--muted-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.35rem">Most likely cause</div>
          <div style="font-size:.85rem;color:var(--text);margin-bottom:.6rem">${esc(s.cause||'—')}</div>
          <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.65rem">
            <span style="font-size:.72rem;color:var(--muted-2)">Confidence</span>
            ${confBar(conf)}
            <span style="font-size:.8rem;font-weight:700;color:${confColor(conf)}">${conf > 0 ? conf+'%' : 'N/A'}</span>
            <span style="margin-left:auto;font-size:.7rem;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.06);${codeStyle(conc)}">${esc(conc)}</span>
          </div>
          ${sugg.length ? `<div style="font-size:.72rem;font-weight:700;color:var(--muted-2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem">Suggestions</div>
          <ul style="margin:0;padding-left:1.2rem;display:flex;flex-direction:column;gap:.25rem">
            ${sugg.map(s=>`<li style="font-size:.8rem;color:var(--muted)">${esc(s)}</li>`).join('')}
          </ul>` : ''}
          ${s.vps_connections !== null ? `<div style="margin-top:.5rem;font-size:.72rem;color:var(--muted-2)">VPS connections (last ~200 log lines): <strong>${s.vps_connections}</strong>${s.vps_sample ? ` — <span style="font-family:var(--mono);font-size:.65rem">${esc(s.vps_sample.split('\n')[0]||'')}</span>` : ''}</div>` : ''}
        </div>
      </div>`;
    }).join('');
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
            const isIos = r.platform === 'ios';
            const abi32 = !isIos && r.abi && !r.abi.includes('arm64-v8a');
            const platformBadge = isIos
              ? '<span class="badge badge-info" style="font-size:.65rem">🍎 iOS</span> '
              : '';
            const abiCell = isIos ? '<span class="badge badge-info" style="font-size:.65rem">N/A</span>'
              : r.abi ? `<span class="badge ${abi32?'badge-warn':'badge-ok'}">${esc(r.abi.split(',')[0])}${abi32?' (32-bit)':''}</span>`
              : '—';
            return `<tr>
              <td>${platformBadge}${esc((r.manufacturer||'')+' '+(r.model||''))}</td>
              <td>${isIos ? '<span style="color:var(--muted)">—</span>' : esc(r.android_version||'—')}</td>
              <td>${isIos ? '<span style="color:var(--muted)">—</span>' : (r.sdk_version||'—')}</td>
              <td>${abiCell}</td>
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

// ── VIEW: USER INSIGHTS ──────────────────────────────────────────────
// Aggregate, privacy-safe breakdowns from admin/api.php?action=user-insights.
// No per-user destination logging: carriers are ASN-derived operator names,
// reachability comes from the app's own connectivity probes.
views.insights = {
  init() { this.load(); },
  fmtDur(secs) {
    secs = Number(secs) || 0;
    if (secs < 60) return secs + 's';
    if (secs < 3600) return Math.floor(secs/60) + 'm ' + (secs%60) + 's';
    return Math.floor(secs/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
  },
  pct(v) { return (v===null || v===undefined || isNaN(v)) ? '—' : Math.round(v) + '%'; },
  rows(tbody, list, cols, cells) {
    const el = $(tbody); if (!el) return;
    el.innerHTML = (list && list.length)
      ? list.map(cells).join('')
      : `<tr><td colspan="${cols}" class="tbl-empty">No data</td></tr>`;
  },
  async load() {
    try {
      const d = await api.get('user-insights');
      const t = d.totals || {}, r = d.reachability || {};

      $('insTotalDevices').textContent = t.total_devices ?? '—';
      $('insActive24').textContent     = t.active_24h ?? '—';
      $('insActive7').textContent      = (t.active_7d ?? '—') + ' in 7d';
      $('insPremium').textContent      = t.premium ?? '—';
      $('insTotalGb').textContent      = (t.total_gb ?? 0) + ' GB';
      $('insLongest').textContent      = this.fmtDur(t.longest_secs);

      $('insReachInstagram').textContent  = this.pct(r.instagram);
      $('insReachTelegram').textContent   = this.pct(r.telegram);
      $('insReachGoogle').textContent     = this.pct(r.google);
      $('insReachCloudflare').textContent = this.pct(r.cloudflare);
      $('insReachApple').textContent      = this.pct(r.apple);
      $('insReachSub').textContent = `from in-app connectivity probes · ${d.days ?? 30}d`;

      this.rows('insCarrierTbl', d.carriers, 2, x=>`<tr><td>${esc(x.carrier)}</td><td>${x.devices}</td></tr>`);
      this.rows('insGeoTbl', d.geo, 2, x=>`<tr><td>${esc(x.country)}</td><td>${x.devices}</td></tr>`);
      this.rows('insPlatformTbl', d.platforms, 2, x=>`<tr><td>${esc(x.platform)}</td><td>${x.devices}</td></tr>`);
      this.rows('insBrandTbl', d.brands, 2, x=>`<tr><td>${esc(x.brand)}</td><td>${x.devices}</td></tr>`);
      this.rows('insPlanTbl', d.plans, 2, x=>`<tr><td>${esc(x.plan||'free')}</td><td>${x.devices}</td></tr>`);
      this.rows('insProtocolTbl', d.protocols, 3, x=>`<tr><td>${esc(x.protocol)}</td><td>${x.sessions}</td><td>${x.gb ?? 0}</td></tr>`);
      this.rows('insNodeTbl', d.nodes, 2, x=>`<tr><td>${esc(x.node_id)}</td><td>${x.connects}</td></tr>`);
      this.rows('insLongestTbl', d.longest, 5, x=>`<tr>`
        + `<td style="font-family:var(--mono);font-size:.72rem">${esc(x.device)}</td>`
        + `<td>${esc(x.protocol)}</td><td>${this.fmtDur(x.duration_secs)}</td>`
        + `<td>${x.mb ?? 0}</td><td class="mobile-hide">${esc(x.day||'')}</td></tr>`);
    } catch(e) { toast('User insights: '+e.message,'error'); }
  },
};

// ── VIEW: TAP STREAM (B-24) ──────────────────────────────────────────
// Reads admin/api.php?action=tap-stream-summary, aggregated from
// tap_events (ingested via public/api.php's track-taps-batch).
views.tapstream = {
  init() { this.load(); },
  rows(tbody, list, cols, cells) {
    const el = $(tbody); if (!el) return;
    el.innerHTML = (list && list.length)
      ? list.map(cells).join('')
      : `<tr><td colspan="${cols}" class="tbl-empty">No data</td></tr>`;
  },
  async load() {
    try {
      const d = await api.get('tap-stream-summary');
      const t = d.totals || {};
      $('tapTotalTaps').textContent = t.total_taps ?? '—';
      $('tapDevices').textContent   = t.devices ?? '—';
      $('tapDaysSub').textContent   = `last ${d.days ?? 7}d`;
      this.rows('tapScreenTbl', d.by_screen, 2, x=>`<tr><td>${esc(x.screen)}</td><td>${x.taps}</td></tr>`);
      this.rows('tapElementTbl', d.by_element, 3, x=>`<tr><td>${esc(x.screen)}</td><td>${esc(x.element)}</td><td>${x.taps}</td></tr>`);
    } catch(e) { toast('Tap stream: '+e.message,'error'); }
  },
};

// ── VIEW: SEO RANKS ──────────────────────────────────────────────────
// Keyword position tracker. Reads admin/api.php?action=seo-ranks, renders a
// position-over-time chart (Y inverted — 1 at top), a summary table, and a
// form to log a snapshot (POST seo-rank-record). Manual entry now; a Google
// Search Console feed can populate the same table later.
views.seoranks = {
  chart: null,
  data: [],
  init() { this.load(); const d=$('seoDate'); if(d&&!d.value) d.value=new Date().toISOString().slice(0,10); },
  async load() {
    try {
      const d = await api.get('seo-ranks');
      this.data = d.keywords || [];
      this.renderTable();
      this.renderChart();
      this.renderInputs();
      this.renderGsc(d.gsc || {});
      $('seoKwCount').textContent = this.data.length + ' tracked · Iran intent';
    } catch(e) { toast('SEO ranks: '+e.message,'error'); }
  },
  renderGsc(g) {
    const st = $('gscStatus'), site = $('gscSite');
    if (site && !site.value) site.value = g.site_url || 'https://setalink.no/';
    $('gscSetup').style.display = g.key_present ? 'none' : 'block';
    if (!g.key_present) { st.textContent = 'not connected'; st.style.color='#f59e0b'; }
    else { st.textContent = 'connected' + (g.last_sync ? ' · last sync '+g.last_sync : ' · never synced'); st.style.color='var(--muted)'; }
  },
  async saveGscConfig() {
    const u = ($('gscSite').value||'').trim(); if(!u) return;
    try { await api.post({action:'seo-rank-gsc-config', site_url:u}); $('gscMsg').textContent='Property saved.'; }
    catch(e){ toast('Save failed: '+e.message,'error'); }
  },
  async syncGsc() {
    $('gscMsg').textContent = 'Syncing…';
    try {
      const r = await api.post({action:'seo-rank-gsc-sync'});
      $('gscMsg').textContent = `Synced ${r.snapshots} snapshots for ${r.keywords_hit} keyword(s) · ${r.window}`;
      toast('Search Console synced','success');
      // Suggest high-impression queries we don't track yet.
      const u = r.top_untracked||[];
      $('gscUntracked').innerHTML = u.length
        ? '<div style="font-size:.78rem;color:var(--muted)">Top queries you rank for but don\'t track yet (impressions) — click to add:</div>'
          + u.map(x=>`<button type="button" class="btn btn-ghost gsc-add" data-q="${esc(x.query)}" style="margin:.25rem .3rem 0 0;font-size:.75rem" dir="auto">${esc(x.query)} <span style="color:var(--muted-2)">${x.impressions}</span></button>`).join('')
        : '';
      document.querySelectorAll('.gsc-add').forEach(b=>b.addEventListener('click',()=>{ $('seoNewKw').value=b.dataset.q; this.addKeyword(); }));
      this.load();
    } catch(e){ $('gscMsg').textContent=''; toast('Sync failed: '+e.message,'error'); }
  },
  renderTable() {
    const fmtPos = p => p==null ? '<span style="color:var(--muted-2)">—</span>' : '#'+ (Number.isInteger(p)?p:p.toFixed(1));
    $('seoRankTbl').innerHTML = this.data.length ? this.data.map(k=>{
      let dcell = '<span style="color:var(--muted-2)">—</span>';
      if (k.delta!=null && k.delta!==0) {
        const up = k.delta>0;
        dcell = `<span class="badge ${up?'badge-ok':'badge-danger'}">${up?'▲':'▼'} ${Math.abs(k.delta)}</span>`;
      } else if (k.delta===0) dcell = '<span class="badge badge-info">0</span>';
      return `<tr>
        <td dir="auto" style="font-weight:600">${esc(k.keyword)}</td>
        <td>${fmtPos(k.latest)}</td><td>${dcell}</td>
        <td>${fmtPos(k.best)}</td><td>${k.points||0}</td>
        <td class="mobile-hide" style="font-size:.75rem;color:var(--muted)">${esc(k.last_at||'never')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="tbl-empty">No keywords tracked</td></tr>';
  },
  renderChart() {
    if (typeof Chart==='undefined') return;
    if (this.chart) { try{this.chart.destroy();}catch(e){} this.chart=null; }
    // Union of all measurement dates → shared X axis.
    const dates = [...new Set(this.data.flatMap(k=>(k.history||[]).map(h=>h.captured_at.slice(0,10))))].sort();
    if (!dates.length) { return; }
    const palette = ['#00e87a','#3399ff','#f59e0b','#e0559e','#8b5cf6','#22d3ee','#ef4444','#a3e635','#fb923c','#e879f9'];
    const measured = this.data.filter(k=>(k.history||[]).length);
    const sets = measured.map((k,i)=>{
      const byDay = {}; (k.history||[]).forEach(h=>{ byDay[h.captured_at.slice(0,10)]=h.position; });
      return { label:k.keyword, data:dates.map(d=>byDay[d] ?? null), spanGaps:true,
               borderColor:palette[i%palette.length], backgroundColor:palette[i%palette.length],
               tension:.25, borderWidth:2, pointRadius:3 };
    });
    this.chart = new Chart($('seoChart'), {
      type:'line',
      data:{ labels:dates, datasets:sets },
      options:{ responsive:true, maintainAspectRatio:false,
        scales:{ y:{ reverse:true, title:{display:true,text:'Google position (1 = top)'},
                     ticks:{precision:0}, suggestedMin:1 } },
        plugins:{ legend:{ labels:{ boxWidth:12, font:{size:10} } } } }
    });
  },
  renderInputs() {
    $('seoInputGrid').innerHTML = this.data.map(k=>`
      <label style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;background:var(--panel-2,rgba(255,255,255,.03));padding:.4rem .6rem;border-radius:6px">
        <span dir="auto" style="font-size:.8rem">${esc(k.keyword)}</span>
        <input type="number" min="1" max="100" step="1" class="input seo-pos" data-kw="${esc(k.keyword)}" data-lang="${esc(k.lang||'fa')}" placeholder="${k.latest??'#'}" style="width:70px">
      </label>`).join('');
  },
  addKeyword() {
    const v = ($('seoNewKw').value||'').trim();
    if (!v) return;
    if (!this.data.some(k=>k.keyword===v)) this.data.push({keyword:v, lang:'fa', latest:null, history:[]});
    $('seoNewKw').value='';
    this.renderInputs();
  },
  async save() {
    const entries = [...document.querySelectorAll('.seo-pos')].map(el=>({
      keyword: el.dataset.kw, lang: el.dataset.lang, position: el.value.trim()
    })).filter(e=>e.position!=='');
    if (!entries.length) { $('seoSaveMsg').textContent='Enter at least one position.'; return; }
    const captured_at = ($('seoDate').value||'') + ' 12:00:00';
    try {
      const r = await api.post({action:'seo-rank-record', entries, captured_at, source:'manual'});
      $('seoSaveMsg').textContent = `Saved ${r.recorded} position(s).`;
      toast('Snapshot saved','success');
      this.load();
    } catch(e){ toast('Save failed: '+e.message,'error'); }
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
    $('devPlatform').onchange = ()=>this.renderDevices();
    $('devSource').onchange = ()=>this.renderDevices();
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
      const online   = rows.filter(r=>r.status==='online').length;
      const free     = rows.filter(r=>r.plan==='free').length;
      const premium  = rows.filter(r=>r.plan==='premium').length;
      const blocked  = rows.filter(r=>r.blocked).length;
      const iosCount        = rows.filter(r=>(r.platform||'').toLowerCase()==='ios').length;
      const appleReview     = rows.filter(r=>r.registration_source==='apple_review').length;
      const neverConnected  = rows.filter(r=>!r.ever_connected).length;
      $('devTotal').textContent        = rows.length;
      $('devOnline').textContent       = online;
      $('devFree').textContent         = free;
      $('devPremium').textContent      = premium;
      $('devBlocked').textContent      = blocked;
      $('devIos').textContent          = iosCount;
      $('devAndroid').textContent      = rows.length - iosCount;
      $('devAppleReview').textContent  = appleReview;
      $('devNeverConnected').textContent = neverConnected;
      this.renderDevices();
    } catch(e) { toast('Devices: '+e.message,'error'); }
  },
  renderDevices() {
    const q        = ($('devSearch').value||'').toLowerCase();
    const plan     = $('devPlan').value;
    const status   = $('devStatus').value;
    const platform = $('devPlatform').value;
    const source   = $('devSource').value;
    let rows = this.devData;
    if (q)              rows = rows.filter(r=>((r.user_id||'')+(r.device_id_short||'')+(r.country||'')+(r.app_version||'')+(r.device_id||'')+(r.model||'')+(r.platform||'')).toLowerCase().includes(q));
    if (plan)           rows = rows.filter(r=>r.plan===plan);
    if (status==='online')  rows = rows.filter(r=>r.status==='online');
    if (status==='offline') rows = rows.filter(r=>r.status!=='online');
    if (status==='blocked') rows = rows.filter(r=>r.blocked);
    if (platform==='ios')     rows = rows.filter(r=>(r.platform||'').toLowerCase()==='ios');
    if (platform==='android') rows = rows.filter(r=>(r.platform||'').toLowerCase()!=='ios');
    if (source==='apple_review')   rows = rows.filter(r=>r.registration_source==='apple_review');
    if (source==='testflight')     rows = rows.filter(r=>r.registration_source==='testflight');
    if (source==='never_connected')rows = rows.filter(r=>!r.ever_connected);
    if (source==='inactive_30')    rows = rows.filter(r=>(r.days_inactive||0)>=30);
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
          // Sessions column — shows count + session traffic; Apple Review badge when 0
          const sessCount = r.session_count || 0;
          const sessBytesHtml = r.session_bytes > 0
            ? `<div style="font-size:.6rem;color:var(--muted-2)">${fmtBytes(r.session_bytes)}</div>` : '';
          const sessHtml = sessCount > 0
            ? `<div style="font-size:.75rem;font-weight:600;color:var(--ok)">${sessCount}</div>${sessBytesHtml}${r.last_session_at?`<div style="font-size:.58rem;color:var(--muted-2)">${fmtRelative(r.last_session_at)}</div>`:''}`
            : (r.registration_source==='apple_review'
                ? '<span class="badge badge-warn" style="font-size:.58rem" title="Apple Review bot — never connected">🔍 Review</span>'
                : '<span style="color:var(--muted-2);font-size:.7rem">0</span>');
          // Source badge shown in User ID cell
          const srcBadge = r.registration_source==='apple_review'
            ? '<span class="badge badge-warn" style="font-size:.58rem;margin-left:.1rem" title="Apple App Review bot — fresh install each run">🔍 Review</span>'
            : r.registration_source==='testflight'
              ? '<span class="badge badge-info" style="font-size:.58rem;margin-left:.1rem">🧪 TF</span>'
              : '';
          // First Seen / Last Seen combined cell
          const daysAgo = r.days_inactive != null
            ? (r.days_inactive < 1 ? 'today' : `${r.days_inactive}d ago`)
            : '—';
          const seenHtml = `<div style="font-size:.65rem;color:var(--muted-2)">first: ${esc((r.created_at||'').substring(0,10))}</div>`
            + `<div style="font-size:.65rem;color:var(--muted-2)">last: ${fmtRelative(r.last_seen)}</div>`
            + (r.days_inactive>=7?`<div style="font-size:.6rem;color:var(--warn)">${daysAgo}</div>`:'');
          return `<tr style="cursor:pointer" onclick="devDetail('${esc(r.device_id)}')" title="Click for device details">
            <td>
              <div style="font-family:var(--mono);font-size:.72rem;color:var(--text);font-weight:600">${esc(uid)}</div>
              <div style="display:flex;gap:.25rem;align-items:center;margin:.18rem 0;flex-wrap:wrap">
                ${platformBadge(r.platform)}${srcBadge}
                ${r.app_version?`<span class="badge badge-muted" style="font-family:var(--mono);font-size:.62rem" title="App version">${esc(r.app_version)}</span>`:''}
              </div>
              <div style="font-size:.6rem;color:var(--muted-2);font-family:var(--mono)" title="Device fingerprint">FP: ${esc(r.device_id_short||'')}</div>
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
            <td class="mobile-hide">${sessHtml}</td>
            <td class="mobile-hide">${rxtxHtml}</td>
            <td class="mobile-hide">${connHtml}</td>
            <td class="mobile-hide" style="font-size:.7rem">${failBadge}</td>
            <td class="mobile-hide" style="font-size:.75rem">${srcCtry}<div style="font-size:.6rem;color:var(--muted-2);font-family:var(--mono)">${srcIp}</div></td>
            <td class="mobile-hide">${seenHtml}</td>
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
    this.loadRealRedemptions();
  },
  async loadRealRedemptions() {
    try {
      const d = await api.get('real-redemptions');
      const s = d.settings || {};
      $('realRates').textContent =
        `${s.real_per_gb} REAL/GB · min ${s.redeem_min_real} REAL · cap ${fmtBytes(s.redeem_daily_cap_bytes||0)}/day`;
      const es = d.ecosystem_status || {};
      const okBadge  = (ok) => `<span style="color:${ok?'#22c55e':'#f59e0b'}">${ok?'✓':'✗'}</span>`;
      $('realEcoStatus').innerHTML =
        `Shahnameh ecosystem link (B-2): ` +
        `${okBadge(!!es.link_secret_configured)} real_link_secret &nbsp; ` +
        `${okBadge(!!es.api_key_configured)} real_api_key &nbsp; ` +
        `real_api_url: <span class="mono" style="font-size:.75rem">${esc(es.api_url || '(not set)')}</span>`;
      const rows = d.redemptions || [];
      $('realTbl').innerHTML = !rows.length
        ? '<tr><td colspan="10" class="tbl-empty">No redemptions yet</td></tr>'
        : rows.map(r=>`<tr>
            <td>${r.id}</td>
            <td class="mono mobile-hide" style="font-size:.65rem;color:var(--muted-2)">${esc((r.device_id||'').substring(0,14)+'…')}</td>
            <td class="mono" style="font-size:.7rem">${esc(r.real_account||'—')}</td>
            <td>${r.real_amount}</td>
            <td>${fmtBytes(r.quota_bytes||0)}</td>
            <td style="font-size:.7rem">${r.kind==='referral_grant'?'🎁 grant':'redeem'}</td>
            <td class="mono mobile-hide" style="font-size:.68rem">${esc((r.tx_ref||'—').substring(0,14)+'…')}</td>
            <td><span class="badge ${r.status==='credited'?'badge-ok':r.status==='rejected'?'badge-danger':'badge-warn'}">${esc(r.status)}</span></td>
            <td class="mobile-hide" style="font-size:.72rem;color:var(--muted-2)">${fmtRelative(r.created_at)}</td>
            <td>
              ${r.status==='pending'?`
                <button class="btn btn-sm btn-primary" onclick="realReview(${r.id},'approve')">Approve</button>
                <button class="btn btn-sm btn-danger"  onclick="realReview(${r.id},'reject')">Reject</button>`
              : '—'}
            </td>
          </tr>`).join('');
    } catch(e) { /* panel is informational — never block the payments view */ }
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
    $('devProfileBtn').style.display = '';
    $('devProfileBtn').onclick = ()=>devOpenProfile(did);
    const kv = (k,v) => `<div style="display:flex;justify-content:space-between;gap:1rem;padding:.28rem 0;border-bottom:1px solid var(--border);font-size:.76rem"><span style="color:var(--muted-2)">${k}</span><span style="text-align:right;font-family:var(--mono)">${v||'—'}</span></div>`;
    const gb = n => fmtBytes(n||0);
    const isIos = (dev.platform||'').toLowerCase() === 'ios';
    const devRows = [
      kv('Platform', platformBadge(dev.platform)),
      kv('Model', esc((dev.manufacturer?dev.manufacturer+' ':'')+(dev.model||''))),
      isIos
        ? kv('iOS', '<span style="color:var(--muted-2)">updates via TestFlight / App Store</span>')
        : kv('Android', esc(dev.android_version ? `${dev.android_version} (SDK ${dev.sdk_version||'?'})` : (dev.sdk_version?`SDK ${dev.sdk_version}`:''))),
      isIos
        ? kv('ABI', '<span style="color:var(--muted-2)">N/A — native iOS binary (arm64)</span>')
        : kv('ABI', esc(dev.abi||'') || '<span style="color:var(--muted-2)">unknown — fills on next app launch</span>'),
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
      kv('Quota', isIos
        ? `${gb(dev.quota_bytes_total)} (${esc(dev.plan)}) <span style="color:var(--muted-2);font-size:.7rem">· traffic not tracked on iOS proxy</span>`
        : `${dev.quota_bytes_used>0?gb(dev.quota_bytes_used):'0 B'} / ${gb(dev.quota_bytes_total)} (${esc(dev.plan)})`),
      kv('Referral code', esc(dev.referral_code)),
      kv('First seen', esc(dev.created_at)),
      kv('Last seen', `${esc(dev.last_seen)} (${fmtRelative(dev.last_seen)})`),
    ].join('');
    const allSess = d.sessions || [];
    const sumRecv = allSess.reduce((a,s)=>a+(s.bytes_recv||0),0);
    const sumSent = allSess.reduce((a,s)=>a+(s.bytes_sent||0),0);
    const sessTraffic = (sumRecv+sumSent) > 0
      ? `<span style="font-family:var(--mono);color:var(--ok)">↓${fmtBytes(sumRecv)} ↑${fmtBytes(sumSent)}</span> across ${allSess.length} session(s)`
      : (isIos ? `<span style="color:var(--muted-2)">per-session bytes aren't tracked on iOS — see the Quota row above for total plan usage</span>`
               : `<span style="color:var(--muted-2)">no per-session traffic reported yet</span>`);
    const sess = allSess.slice(0,10).map(s=>{
      const hasBytes = (s.bytes_recv||0)+(s.bytes_sent||0) > 0;
      const idle = !hasBytes && (s.duration_secs||0) > 0;
      const trafficCell = hasBytes
        ? `<span style="font-family:var(--mono)">↓${fmtBytes(s.bytes_recv)} ↑${fmtBytes(s.bytes_sent)}</span>`
        : (isIos ? `<span style="color:var(--muted-2)" title="iOS proxy — byte counting not available">not tracked (iOS)</span>`
                 : (idle ? `<span style="color:var(--muted-2)" title="connected but no measured traffic">idle</span>`
                         : `<span style="color:var(--muted-2)">—</span>`));
      return `<tr>
        <td style="font-size:.68rem">${fmtRelative(s.ended_at)}</td>
        <td style="font-size:.68rem">${protoBadge(s.protocol)}</td>
        <td style="font-size:.68rem">${trafficCell}</td>
        <td style="font-size:.68rem">${Math.round((s.duration_secs||0)/60)}m</td>
        <td style="font-size:.68rem">${probeBadge(s.probe_result)}</td>
        <td style="font-size:.65rem;color:var(--muted-2)">${esc(s.error_reason||'')}</td>
        <td style="font-size:.68rem">${s.via_vpn?'<span title="report sent through the tunnel">via VPN</span>':esc(s.client_ip||'—')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="tbl-empty">No sessions reported</td></tr>';
    // Ad diagnostics (Khabat, 2026-07-19): raw per-event timeline so this
    // device's banner behaviour can be read directly — "does it load, does
    // it show, does anyone click, does it earn, is it no-fill or something
    // else". Deliberately raw (not the curated activity narrative elsewhere).
    const kindColor = { loaded:'var(--ok)', impression:'#60a5fa', click:'#d4af37',
                         no_fill:'#f59e0b', error:'var(--danger)', request:'var(--muted-2)' };
    const adRows = (d.ad_events || []).map(e => {
      const time = (e.created_at || '').slice(11, 16) || '—';
      return `<tr>
        <td style="font-size:.68rem;font-family:var(--mono)">${esc(time)}</td>
        <td style="font-size:.68rem;font-family:var(--mono)">${esc(e.slot || '—')}</td>
        <td style="font-size:.68rem;color:${kindColor[e.kind] || 'var(--muted-2)'}">${esc(e.kind)}</td>
        <td style="font-size:.65rem;color:var(--muted-2)">${esc(e.detail || '')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="tbl-empty">No banner ad events reported</td></tr>';
    $('devDetailBody').innerHTML = `
      ${devRows}
      <div style="margin-top:.9rem;font-size:.72rem;font-weight:600;color:var(--muted)">RECENT SESSIONS <span style="font-weight:400;color:var(--muted-2)">— this device only</span></div>
      <div style="font-size:.7rem;margin:.25rem 0 .1rem">Session traffic: ${sessTraffic}</div>
      <table class="tbl" style="margin-top:.3rem"><thead><tr>
        <th>When</th><th>Protocol</th><th>Traffic</th><th>Duration</th><th>Probe</th><th>Error</th><th>Reported from</th>
      </tr></thead><tbody>${sess}</tbody></table>
      <div style="margin-top:.9rem;font-size:.72rem;font-weight:600;color:var(--muted)">AD DIAGNOSTICS <span style="font-weight:400;color:var(--muted-2)">— banner requests/loads/impressions/clicks, this device only</span></div>
      <table class="tbl" style="margin-top:.3rem"><thead><tr>
        <th>When</th><th>Slot</th><th>Event</th><th>Detail</th>
      </tr></thead><tbody>${adRows}</tbody></table>
      <p style="margin-top:.7rem;font-size:.68rem;color:var(--muted-2)">Per-device app breakdown (Instagram/Telegram…) is not collected yet —
      all clients share one xray identity. The combined view for all users is on the Devices page.</p>`;
  } catch(e) {
    $('devDetailBody').innerHTML = `<p style="font-size:.8rem;color:var(--danger)">${esc(e.message)}</p>`;
  }
};
window.devOpenProfile = function(did) {
  closeModal();
  $('profileSearch').value = did;
  navigate('profile');
  setTimeout(()=>views.profile.lookup(), 100);
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
window.realReview = async function(rid, action) {
  try {
    await api.post({action:'real-redemption-'+action, redemption_id:rid});
    toast(`Redemption ${action}d`,'ok');
    views.devices.loadRealRedemptions();
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

// ── VIEW: TUNNEL LOGS ────────────────────────────────────────────────
// Reads uploaded PacketTunnelProvider diagnostic bundles (data/tunnel-logs)
// via admin api action=tunnel-logs. The .meta.json carries the structured
// fields (step = last stage reached, server, protocol, success, error).
views.tunnellogs = {
  files: [],
  async init() {
    this.load();
    $('tlRefreshBtn').onclick = ()=>this.load();
    const debouncedLoad = debounce(()=>this.load(), 350);
    $('tlDevice').oninput = debouncedLoad;
    $('tlPlatform').onchange = ()=>this.load();
    $('tlStatus').onchange   = ()=>this.load();
    $('tlStage').onchange    = ()=>this.load();
    $('tlAppVer').oninput    = debouncedLoad;
  },
  async load() {
    const dev  = ($('tlDevice').value||'').trim();
    const plat = ($('tlPlatform').value||'').trim();
    const stat = ($('tlStatus').value||'').trim();
    const stg  = ($('tlStage').value||'').trim();
    const ver  = ($('tlAppVer').value||'').trim();
    $('tlList').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
    try {
      const params = {};
      if (dev)  params.device_id   = dev;
      if (plat) params.platform    = plat;
      if (stat) params.status      = stat;
      if (stg)  params.stage       = stg;
      if (ver)  params.app_version = ver;
      const d = await api.get('tunnel-logs', params);
      this.files = Array.isArray(d.files) ? d.files : [];
      this.render();
    } catch(e) {
      $('tlList').innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`;
      toast('Tunnel logs: '+e.message,'error');
    }
  },
  render() {
    $('tlCount').textContent = this.files.length + ' bundles';
    if (!this.files.length) {
      $('tlList').innerHTML = '<div class="panel-empty">No tunnel logs match the current filters.</div>';
      return;
    }
    const rows = this.files.map(f=>{
      const m = f.meta || {};
      const ok = m.success===true;
      const badge = ok
        ? '<span class="log-sev sev-info">OK</span>'
        : '<span class="log-sev sev-err">FAIL</span>';
      const stage = esc(m.step||'?');
      const proto = esc([m.protocol,m.security].filter(Boolean).join('/')||'—');
      const server = esc(m.server||'—');
      const err = esc((m.error||'').substring(0,80));
      const appVer = esc(m.app_version||'');
      // iOS badge: has build number in parentheses
      const isIos = f.build != null;
      const platBadge = isIos
        ? '<span style="font-size:.65rem;color:#60a5fa">🍎</span>'
        : '<span style="font-size:.65rem;color:#4ade80">🤖</span>';
      const buildBadge = isIos && f.build ? `<span class="badge badge-muted" style="font-size:.6rem">b${f.build}</span>` : '';
      return `<div class="log-line" style="cursor:pointer;gap:.5rem" onclick="views.tunnellogs.open('${esc(f.stem)}')">
        <span class="log-ts">${esc(f.mtime)}</span>
        ${badge}
        ${platBadge}
        <span class="log-body"><b>${esc(f.device_id)}</b>${buildBadge} · stage=<b>${stage}</b> · ${appVer} · ${server}${err?` · <span style="color:var(--bad,#e66)">${err}</span>`:''}</span>
      </div>`;
    }).join('');
    $('tlList').innerHTML = rows;
  },
  // Parse raw log lines into a structured timeline of key events.
  // Each entry: { ts, hms, label, detail, status }
  // status: 'ok' | 'fail' | 'warn' | 'neutral'
  buildTimeline(lines) {
    // Extract [YYYY-MM-DDTHH:MM:SSZ] prefix from a log line.
    const tsRe = /^\[(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})Z)\]/;

    // Event matchers: first match wins per line.
    // Each entry: { re, label, detail? (fn line→string), status, dedup? }
    const MATCHERS = [
      { re: /STATE:\s*start\b/,
        label: 'Tunnel started', status: 'neutral' },
      { re: /xray-core started/,
        label: 'xray-core started',
        detail: l => { const m = l.match(/started in ([\d.]+s)/); return m?.[1]||''; },
        status: 'ok' },
      // HEV bridge — new format (build 40+) and old format (build 38-39)
      { re: /HEV-START:.*socketpair.*OK|HEV:\s*socketpair ok/i,
        label: 'HEV bridge started (SOCK_DGRAM)',
        detail: l => { const m = l.match(/hevFd=(\d+)\s+bridgeFd=(\d+)/i); return m?`hevFd=${m[1]} bridgeFd=${m[2]}`:''; },
        status: 'ok', dedup: 'hev-bridge' },
      { re: /HEV-START:.*FAILED|HEV:\s*socketpair failed/i,
        label: 'HEV bridge FAILED',
        detail: l => { const m = l.match(/errno=(\d+)/); return m?`errno=${m[1]} (EPROTOTYPE — SOCK_DGRAM not tried yet?)`:''; },
        status: 'fail', terminal: true, dedup: 'hev-bridge' },
      { re: /setTunnelNetworkSettings OK/,
        label: 'Routes installed',
        status: 'ok' },
      { re: /NetSettings: DNS=/,
        label: 'DNS configured',
        detail: l => { const m = l.match(/DNS=\[([^\]]+)\]/); return m?.[1]||''; },
        status: 'ok' },
      { re: /HEV:\s*(?:rx relay|tx relay|tunnel thread) started/,
        label: 'HEV relay threads running',
        status: 'ok', dedup: 'hev-relay' },
      { re: /S5-PROBE:.*OPEN/,
        label: 'xray SOCKS5 port open',
        status: 'ok' },
      { re: /S5-PROBE:.*CLOSED|S5-PROBE:.*REFUSED/,
        label: 'xray SOCKS5 port CLOSED',
        detail: l => { const m = l.match(/errno=(\d+)/); return m?`errno=${m[1]}`:''; },
        status: 'fail' },
      { re: /FIRST-PKT-OUT:/,
        label: 'First outbound packet',
        detail: l => l.replace(/.*FIRST-PKT-OUT:\s*/,'').trim(),
        status: 'ok' },
      { re: /FIRST-PKT-DROP:/,
        label: 'First packet DROPPED at S3',
        detail: l => l.replace(/.*FIRST-PKT-DROP:\s*/,'').trim(),
        status: 'fail' },
      { re: /FIRST-PKT-IN:/,
        label: 'First inbound packet',
        detail: l => l.replace(/.*FIRST-PKT-IN:\s*/,'').trim(),
        status: 'ok' },
      // Probe results
      { re: /Probe RX\[1\]:.*IP-direct OK/,
        label: 'IP-direct probe OK',
        detail: l => { const m = l.match(/elapsed=([\d.]+s)/); return m?.[1]||''; },
        status: 'ok' },
      { re: /Probe RX\[1\]:.*IP-direct FAIL/,
        label: 'IP-direct probe failed',
        detail: l => { const m = l.match(/FAIL — (.+?) elapsed/); return m?.[1]?.substring(0,60)||''; },
        status: 'warn' },
      { re: /Probe RX\[2\]:.*DNS\+proxy OK/,
        label: 'DNS+proxy probe OK',
        detail: l => { const m = l.match(/elapsed=([\d.]+s)/); return m?.[1]||''; },
        status: 'ok' },
      { re: /Probe RX\[2\]:.*DNS\+proxy FAIL/,
        label: 'DNS+proxy probe failed',
        detail: l => { const m = l.match(/FAIL — (.+?) elapsed/); return m?.[1]?.substring(0,60)||''; },
        status: 'fail' },
      { re: /Probe RX\[3\]:.*SOCKS5 OK/,
        label: 'SOCKS5 relay probe OK',
        detail: l => { const m = l.match(/elapsed=([\d.]+s)/); return m?.[1]||''; },
        status: 'ok' },
      { re: /Probe RX\[3\]:.*SOCKS5 FAIL/,
        label: 'SOCKS5 relay probe failed',
        detail: l => { const m = l.match(/FAIL — (.+?) elapsed/); return m?.[1]?.substring(0,60)||''; },
        status: 'warn' },
      // Final states — connected_verified (build 42+) shown as green; legacy "connected" as warn
      { re: /STATE:\s*connected_verified/,
        label: 'Connected ✓ (all probes verified)',
        detail: l => { const m = l.match(/connected_verified \((.+?)\)/); return m?.[1]||''; },
        status: 'ok', dedup: 'final-ok' },
      { re: /STATE:\s*connected\b/,
        label: 'Connected (legacy — probes not fully verified)',
        detail: l => { const m = l.match(/connected \((.+?)\)/); return m?.[1]||''; },
        status: 'warn', dedup: 'final-ok' },
      { re: /STATE:\s*failed/,
        label: 'FAILED',
        detail: l => { const m = l.match(/failed — (.+)/); return m?.[1]?.substring(0,80)||''; },
        status: 'fail', terminal: true },
      // Post-connect watchdog (#1 — connected but no traffic) — see build 42+
      { re: /WATCHDOG-FAIL:/,
        label: 'Post-connect watchdog fired',
        detail: l => l.replace(/.*WATCHDOG-FAIL:\s*/,'').trim().substring(0,80),
        status: 'fail', terminal: true },
      // Device / network context matchers — visible in logs from build 42+
      { re: /AppGroup:.*IPC=OK/,
        label: 'App Group IPC verified',
        status: 'ok' },
      { re: /AppGroup:.*IPC=FAIL/,
        label: 'App Group IPC BROKEN',
        detail: 'Extension cannot write to shared UserDefaults — all IPC with main app is broken',
        status: 'fail' },
      { re: /Device:.*lowPower=true/,
        label: 'Low Power Mode active',
        detail: 'iOS Low Power Mode may throttle background VPN extension processing (#17)',
        status: 'warn' },
      { re: /NetSettings:.*IPv6=.*claim\+drop/,
        label: 'IPv6 claim+drop applied',
        detail: 'fd00::2/64 claimed, no handler → fast-fails IPv6, forces Happy Eyeballs to IPv4 (#3)',
        status: 'ok' },
      { re: /NETCHANGE:.*path=unsatisfied/,
        label: 'Network path lost',
        detail: l => { const m = l.match(/interfaces=\[([^\]]*)\]/); return m?.[1]||''; },
        status: 'warn' },
      { re: /NETCHANGE:.*IPv6-only/,
        label: 'IPv6-only network detected',
        detail: 'Device is on IPv6-only path — VPN server must support IPv6 (#18)',
        status: 'warn' },
      { re: /NETCHANGE:.*path=satisfied.*interfaces=\[wifi/,
        label: 'Network switched to WiFi',
        status: 'neutral' },
      { re: /NETCHANGE:.*path=satisfied.*interfaces=\[cellular/,
        label: 'Network switched to Cellular',
        status: 'neutral' },
    ];

    const events = [];
    const seen   = new Set();   // dedup keys
    let t0 = null;              // epoch ms of first timestamped line

    // Pass 1: extract events in log order.
    for (const rawLine of lines) {
      const line = String(rawLine);
      const tsMatch = line.match(tsRe);
      const hms  = tsMatch?.[2] || null;
      const iso  = tsMatch?.[1] || null;
      const epMs = iso ? Date.parse(iso) : null;
      if (epMs && !t0) t0 = epMs;

      for (const m of MATCHERS) {
        if (!m.re.test(line)) continue;
        const key = m.dedup || m.label;
        if (seen.has(key)) break;
        seen.add(key);
        events.push({
          hms,
          offsetMs: (epMs && t0) ? (epMs - t0) : null,
          label:    m.label,
          detail:   m.detail ? m.detail(line) : '',
          status:   m.status,
          terminal: !!m.terminal,
        });
        break;
      }
    }

    // Pass 2: synthesise "No inbound packets" if outbound fired but inbound didn't.
    // Detect from PIPE/PIPE-FINAL lines: S7 hev←SOCKS5 (lib) : 0 pkts
    const hasTx     = events.some(e => e.label === 'First outbound packet');
    const hasRx     = events.some(e => e.label === 'First inbound packet');
    const hasPipe   = lines.some(l => /\[PIPE/.test(l));
    const pipeZeroS7 = lines.some(l => /\[PIPE/.test(l) && /S7 hev[^:]*:\s*0 pkts/.test(l));
    const connected  = events.some(e => e.label === 'Connected');

    if (hasTx && !hasRx && (hasPipe || !connected)) {
      const lastPipeTs = (() => {
        for (let i = lines.length - 1; i >= 0; i--) {
          if (/\[PIPE/.test(lines[i])) {
            const m = String(lines[i]).match(tsRe);
            return { hms: m?.[2]||null, epMs: m?.[1] ? Date.parse(m[1]) : null };
          }
        }
        return { hms: null, epMs: null };
      })();
      events.push({
        hms:      lastPipeTs.hms,
        offsetMs: (lastPipeTs.epMs && t0) ? (lastPipeTs.epMs - t0) : null,
        label:    'No inbound packets received',
        detail:   pipeZeroS7 ? 'S7=0 confirmed in pipeline stats — hev→xray→internet path broken' : 'FIRST-PKT-IN never logged',
        status:   'fail',
        terminal: false,
      });
    }

    return events;
  },

  renderTimeline(events) {
    if (!events.length) return '';
    const dot = s => {
      const c = s==='ok'?'#22c55e':s==='fail'?'#ef4444':s==='warn'?'#f59e0b':'#4b5563';
      const icon = s==='ok'?'✓':s==='fail'?'✗':s==='warn'?'⚠':' ';
      return `<span style="display:inline-flex;align-items:center;justify-content:center;
        width:1.1rem;height:1.1rem;border-radius:50%;background:${c};
        color:#fff;font-size:.6rem;font-weight:700;flex-shrink:0">${icon}</span>`;
    };
    const rows = events.map((e, i) => {
      const isLast = i === events.length - 1;
      const tsCell = e.hms
        ? `<span class="mono" style="color:var(--muted);font-size:.68rem;min-width:4.5rem;flex-shrink:0">${esc(e.hms)}</span>`
        : `<span style="min-width:4.5rem;flex-shrink:0"></span>`;
      const labelColor = e.status==='ok'?'inherit':e.status==='fail'?'var(--bad,#ef4444)':e.status==='warn'?'#f59e0b':'var(--muted)';
      const detail = e.detail ? `<span style="color:var(--muted);font-size:.68rem;margin-left:.4rem">${esc(e.detail)}</span>` : '';
      // Vertical connector line below every row except the last.
      const connector = !isLast
        ? `<div style="width:1.1rem;display:flex;justify-content:center;flex-shrink:0">
             <div style="width:1px;height:.75rem;background:var(--border,#2a3550)"></div>
           </div>`
        : '';
      return `<div style="display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:.5rem;padding:.15rem 0">
          ${tsCell}
          ${dot(e.status)}
          <span style="color:${labelColor};font-size:.78rem;font-weight:${e.status!=='neutral'?600:400}">${esc(e.label)}</span>
          ${detail}
        </div>
        <div style="display:flex;gap:.5rem">
          <div style="min-width:4.5rem;flex-shrink:0"></div>
          ${connector}
        </div>
      </div>`;
    }).join('');
    const overallOk  = events.some(e => e.label === 'Connected');
    const overallFail = events.some(e => e.status === 'fail' && e.terminal);
    const summaryColor = overallOk ? '#22c55e' : overallFail ? '#ef4444' : '#f59e0b';
    const summaryText  = overallOk ? '✅ Connected' : overallFail ? '❌ Failed' : '⚠️ Partial';
    return `<div style="margin-bottom:.75rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <span style="font-size:.72rem;font-weight:600;letter-spacing:.06em;color:var(--muted);text-transform:uppercase">Connection Timeline</span>
        <span style="font-size:.75rem;font-weight:700;color:${summaryColor}">${summaryText}</span>
      </div>
      <div style="background:var(--bg-2,#0f1626);border:1px solid var(--border,#2a3550);border-radius:6px;padding:.6rem .8rem">
        ${rows}
      </div>
    </div>`;
  },

  async open(stem) {
    $('tlDetailStem').textContent = stem;
    $('tlDetail').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
    try {
      const d = await api.get('tunnel-logs', {stem});
      const m = d.meta || {};
      const lines = d.lines || [];

      // ── Connection Timeline ──────────────────────────────────────────
      const timelineHtml = this.renderTimeline(this.buildTimeline(lines));

      // ── Meta table ───────────────────────────────────────────────────
      const metaRows = [
        ['Device', m.device_id], ['App version', m.app_version],
        ['Stage reached (step)', m.step], ['Success', String(m.success)],
        ['Final error', m.error], ['Server', m.server],
        ['Protocol', m.protocol], ['Network', m.network], ['Security', m.security],
        ['Server name (SNI)', m.server_name], ['Flow', m.flow],
        ['libxray version', m.libxray_version],
        ['config valid', String(m.config_valid)], ['config len', m.config_length],
        ['config sha256', m.config_sha256], ['country', m.country],
      ].filter(r=>r[1]!==undefined && r[1]!=='' && r[1]!==null)
       .map(r=>`<tr><td style="color:var(--muted);padding:.1rem .6rem .1rem 0;white-space:nowrap">${esc(r[0])}</td><td><b>${esc(String(r[1]))}</b></td></tr>`).join('');

      // ── Raw log ──────────────────────────────────────────────────────
      const logHtml = lines.map(l=>{
        const line = String(l);
        const sev = /FAIL|✗|error|⚠️/i.test(line)?'err':/✓|OK|connected/i.test(line)?'info':'';
        return `<div class="log-line"><span class="log-body${sev==='err'?'" style="color:var(--bad,#e66)':''}">${esc(line)}</span></div>`;
      }).join('');

      const cfgHtml = d.config
        ? `<details style="margin-top:.6rem"><summary style="cursor:pointer;color:var(--muted)">Sanitized xray config</summary><pre class="raw-detail shown" style="white-space:pre-wrap">${esc(d.config)}</pre></details>`
        : '';

      $('tlDetail').innerHTML =
        `${timelineHtml}
         <details open>
           <summary style="cursor:pointer;font-size:.72rem;color:var(--muted);margin-bottom:.4rem">Meta fields</summary>
           <table style="margin-bottom:.8rem;border-collapse:collapse">${metaRows}</table>
         </details>
         <details>
           <summary style="cursor:pointer;font-size:.72rem;color:var(--muted);margin:.3rem 0">Raw log (${lines.length} lines)</summary>
           <div style="border-top:1px solid var(--border,#333);padding-top:.4rem;margin-top:.3rem">${logHtml||'<div class="panel-empty">empty</div>'}</div>
         </details>
         ${cfgHtml}`;
    } catch(e) {
      $('tlDetail').innerHTML = `<div class="panel-empty">${esc(e.message)}</div>`;
    }
  }
};

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
      // Adaptive flags
      $('rcFailoverMax').value       = rc.failover_max_nodes ?? 2;
      $('rcTelemetryEnabled').checked = rc.telemetry_enabled !== false;
      this.renderRcTags('rcNodesDisabled', rc.nodes_disabled||[]);
      $('rcExtraLogPlatform').value  = rc.extra_logging_platform || '';
      $('rcExtraLogNode').value      = rc.extra_logging_node || '';
      $('rcRollout').value           = JSON.stringify(rc.rollout||{}, null, 2);
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
    const key = elId==='rcSniPriorities'?'sni_priorities':elId==='rcNodesDisabled'?'nodes_disabled':'kill_switches';
    if (this.rcData[key]) { this.rcData[key].splice(idx,1); this.renderRcTags(elId, this.rcData[key]); }
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
  },
  addNodeDis() {
    const v = $('rcNodeDisInput').value.trim();
    if (!v) return;
    if (!this.rcData.nodes_disabled) this.rcData.nodes_disabled = [];
    this.rcData.nodes_disabled.push(v);
    $('rcNodeDisInput').value='';
    this.renderRcTags('rcNodesDisabled', this.rcData.nodes_disabled);
  },
  removeNodeDis(idx) {
    this.rcData.nodes_disabled.splice(idx,1);
    this.renderRcTags('rcNodesDisabled', this.rcData.nodes_disabled);
  }
};
$('rcSniAdd').onclick        = ()=>views.config.addSni();
$('rcKsAdd').onclick         = ()=>views.config.addKs();
$('rcNodeDisAdd').onclick    = ()=>views.config.addNodeDis();
$('rcNodeDisInput').onkeydown = e=>{ if(e.key==='Enter'){e.preventDefault();views.config.addNodeDis();} };
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
$('cfgSaveAdaptive').onclick = async()=>{
  let rollout = {};
  try { rollout = JSON.parse($('rcRollout').value||'{}'); } catch { toast('Rollout JSON is invalid','error'); return; }
  const rc = views.config.rcData;
  try {
    await api.post({action:'save-remote-config',
      rc_failover_max_nodes:    parseInt($('rcFailoverMax').value)||2,
      rc_telemetry_enabled:     $('rcTelemetryEnabled').checked ? '1' : '0',
      rc_nodes_disabled:        rc.nodes_disabled || [],
      rc_extra_logging_platform: $('rcExtraLogPlatform').value || '',
      rc_extra_logging_node:    $('rcExtraLogNode').value || '',
      rc_rollout:               JSON.stringify(rollout),
      rc_version: (+(rc.version||1)+1),
    });
    $('adaptiveSaveMsg').textContent = '✓ saved';
    setTimeout(()=>{ $('adaptiveSaveMsg').textContent=''; }, 3000);
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

// ── VIEW: USER PROFILE ───────────────────────────────────────────────
views.profile = {
  _devId: null, _tlOffset: 0, _tlLimit: 30, _tlFilter: '', _tlTotal: 0,

  init() {
    $('profileSearchBtn').onclick = () => this.lookup();
    $('profileSearch').onkeydown  = e => { if (e.key === 'Enter') this.lookup(); };
    $('profTlFilter').onchange = () => this._loadTimeline(0, $('profTlFilter').value);
    $('profTlPrev').onclick = () => this._loadTimeline(Math.max(0, this._tlOffset - this._tlLimit), this._tlFilter);
    $('profTlNext').onclick = () => this._loadTimeline(this._tlOffset + this._tlLimit, this._tlFilter);
  },

  async lookup() {
    const q = $('profileSearch').value.trim();
    if (!q) return;
    const st = $('profileSearchStatus');
    st.textContent = 'Loading…';
    $('profileCard').hidden = true;
    $('profileEmpty').hidden = true;
    try {
      const d = await api.get('user-profile', { device_id: q });
      this.render(d);
      $('profileCard').hidden = false;
      st.textContent = '';
    } catch(e) {
      st.textContent = e.message || 'Not found';
      $('profileEmpty').hidden = false;
    }
  },

  render(d) {
    const I = d.identity, W = d.wallet, F = d.freedom, C = d.clan, CH = d.chat;
    this._devId = I.device_id;
    this._tlOffset = d.tl_offset ?? 0;
    this._tlFilter = '';

    // ── Identity header ──
    $('profAvatar').textContent = I.avatar_emoji || '👤';
    const name = I.handle ? `@${I.handle}` : (I.user_id || I.device_id.slice(0,12)+'…');
    $('profTitle').textContent = name;
    $('profPlanBadge').textContent = (I.plan||'free').toUpperCase();
    $('profPlanBadge').className = 'badge ' + (I.plan === 'premium' ? 'badge-ok' : 'badge-muted');
    $('profCountryBadge').textContent = (I.country||'?') + (I.country_name ? ' '+I.country_name : '');
    $('profCountryBadge').className = 'badge badge-muted';
    $('profBlockedBadge').style.display = I.blocked ? '' : 'none';

    // ── Identity grid ──
    $('profRealId').textContent     = I.linked_real_account || '— not linked';
    $('profUserId').textContent     = I.user_id || '—';
    $('profHandle').textContent     = I.handle || '—';
    $('profPersona').textContent    = I.persona ? { king:'👑 King', queen:'👸 Queen', warrior:'⚔️ Warrior' }[I.persona] || I.persona : '—';
    $('profPlatform').textContent   = { android:'🤖 Android', ios:'🍎 iOS' }[I.platform] || I.platform || '—';
    $('profAppVersion').textContent = I.app_version || '—';
    $('profCreated').textContent    = I.created_at ? I.created_at.slice(0,10) : '—';
    $('profLastSeen').textContent   = I.last_seen ? relTime(I.last_seen) : '—';

    // ── Wallet ──
    $('profGbFree').textContent     = W.quota_free_gb != null ? W.quota_free_gb + ' GB' : '—';
    $('profGbUsed').textContent     = W.quota_used_gb != null ? `${W.quota_used_gb} / ${W.quota_total_gb} GB used` : '';
    $('profGbLifetime').textContent = W.lifetime_gb   != null ? W.lifetime_gb + ' GB' : '—';
    $('profRealBal').textContent    = W.real_balance  != null ? W.real_balance  : '— (Shahnameh)';
    $('profTonBal').textContent     = W.ton_balance   != null ? W.ton_balance   : '— (TON wallet)';
    $('profWalletPlan').textContent = (W.plan || I.plan || 'free').replace(/^\w/, c=>c.toUpperCase());
    $('profPlanExpiry').textContent = W.plan_expiry ? 'Expires ' + W.plan_expiry.slice(0,10) : '';

    // ── Freedom ──
    $('profFreedomList').innerHTML = kvRow('Sessions', fmtNum(F.total_sessions))
      + kvRow('Data', F.total_gb + ' GB')
      + kvRow('Success rate', F.success_rate_pct + '%')
      + kvRow('Last connected', F.last_session_at ? relTime(F.last_session_at) : '—');
    $('profTopProtocol').textContent = F.top_protocol ? '🔗 Preferred: ' + F.top_protocol : '';

    // ── Community ──
    const rankLabel = { king:'👑 King', pahlavan:'🛡️ Pahlavan', warrior:'⚔️ Warrior' }[C.rank] || C.rank || '⚔️ Warrior';
    $('profClanRank').textContent = rankLabel;
    $('profClanList').innerHTML = kvRow('Total invites', C.invite_count)
      + kvRow('Active (7d)', C.active_invites)
      + kvRow('Messages', fmtNum((CH.messages_sent||0)+(CH.messages_received||0)))
      + kvRow('Referred by', C.referred_by ? (C.referred_by.user_id || C.referred_by.device_id.slice(0,10)+'…') : '— organic');
    $('profClanReferrals').textContent = C.referrals?.length
      ? 'Invited: ' + C.referrals.slice(0,5).map(r=>r.user_id||r.device_id.slice(0,8)+'…').join(', ') + (C.referrals.length>5?` +${C.referrals.length-5} more`:'')
      : 'No referrals yet';

    // ── Shahnameh ──
    const badge = $('profShahnamehBadge');
    if (I.linked_real_account) {
      badge.textContent = '✓ LINKED';
      badge.style.cssText = 'margin-left:.5rem;font-size:.65rem;background:var(--ok-dim,#1a3a2a);color:var(--ok,#4ade80)';
      $('profShahnamehList').innerHTML =
          kvRow('REAL_ID',      I.linked_real_account)
        + kvRow('Linked at',    I.real_linked_at ? I.real_linked_at.slice(0,10) : '?')
        + kvRow('Persona',      I.persona || '—')
        + kvRow('Hero',         '— (Shahnameh backend)')
        + kvRow('Chapter',      '— (Shahnameh backend)')
        + kvRow('Level',        '— (Shahnameh backend)')
        + kvRow('Clan',         '— (Shahnameh backend)')
        + kvRow('XP',           '— (Shahnameh backend)')
        + kvRow('REAL Earned',  '— (Shahnameh backend)');
    } else {
      badge.textContent = 'NOT LINKED';
      badge.style.cssText = 'margin-left:.5rem;font-size:.65rem';
      $('profShahnamehList').innerHTML = kvRow('Status', 'Gate not passed')
        + kvRow('Hero','—') + kvRow('Chapter','—') + kvRow('Level','—')
        + kvRow('Clan','—') + kvRow('XP','—') + kvRow('REAL Earned','—');
    }

    // ── Activity (initial page) ──
    this._renderTimeline(d.timeline, d.tl_total ?? d.timeline?.length ?? 0);
  },

  _renderTimeline(rows, total) {
    const tbody = document.querySelector('#profTimeline tbody');
    tbody.innerHTML = (rows||[]).map(e =>
      `<tr><td style="white-space:nowrap;font-size:.78rem">${esc(e.ts?.slice(0,16)||'?')}</td>` +
      `<td style="font-size:1rem">${e.icon||''}</td>` +
      `<td style="font-size:.82rem">${esc(e.label||'')}</td>` +
      `<td style="font-size:.78rem;color:var(--text-muted)">${esc(String(e.detail||''))}</td></tr>`
    ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">No events</td></tr>';

    this._tlTotal = total;
    const from = total > 0 ? this._tlOffset + 1 : 0;
    const to   = Math.min(this._tlOffset + this._tlLimit, total);
    $('profTlInfo').textContent  = total > 0 ? `${from}–${to} of ${total}` : 'No events';
    $('profTlPrev').disabled = this._tlOffset <= 0;
    $('profTlNext').disabled = to >= total;
  },

  async _loadTimeline(offset, filter) {
    this._tlOffset = offset;
    this._tlFilter = filter;
    try {
      const d = await api.get('user-profile', {
        device_id: this._devId,
        tl_offset: offset,
        tl_limit:  this._tlLimit,
        tl_filter: filter || '',
      });
      this._renderTimeline(d.timeline, d.tl_total ?? d.timeline?.length ?? 0);
    } catch(e) { toast('Timeline: ' + e.message, 'error'); }
  },
};
function kvRow(k,v){ return `<div style="display:flex;justify-content:space-between;font-size:.82rem;padding:.2rem 0;border-bottom:1px solid var(--border-subtle)"><span style="color:var(--text-muted)">${esc(k)}</span><span style="font-weight:500">${esc(String(v))}</span></div>`; }
function relTime(ts){ if(!ts)return'—'; const d=Math.round((Date.now()-new Date(ts+' UTC').getTime())/60000); if(d<2)return'just now'; if(d<60)return d+'m ago'; if(d<1440)return Math.round(d/60)+'h ago'; return Math.round(d/1440)+'d ago'; }
// ── VIEW: HAKIM ADMIN ────────────────────────────────────────────────
// Every field reads hakim-bot's actual running state (systemctl, hakim.db)
// via the hakim-status API action — never a plausible invented status.
// See ADMIN_NOC_ROADMAP.md § 8.0/§ 8.11.
views.hakim = {
  init() { this.load(); },
  async load() {
    try {
      const d = await api.get('hakim-status');
      const dot = $('hakimStatusDot');
      dot.className = 'dot ' + (d.bot_status === 'active' ? 'dot-ok' : d.bot_status === 'unknown' ? 'dot-unk' : 'dot-bad');
      $('hakimStatusText').textContent = d.bot_status === 'active' ? 'Online' : d.bot_status === 'unknown' ? 'Unknown' : 'Offline';
      $('hakimModel').textContent = d.provider ? `${d.provider} (${d.model || '?'})` : '—';
      $('hakimActiveFlag').textContent = d.bot_active === null ? '—' : (d.bot_active ? 'true' : 'false');
      $('hakimLastUpdate').textContent = d.config_updated_at || '—';
      $('hakimReqTotal').textContent = d.messages_in ?? '—';
      $('hakimUserCount').textContent = d.user_count ?? '—';
      if (d.requests_logged > 0) {
        $('hakimSuccessRate').textContent = d.success_rate != null ? `${d.success_rate}%` : '—';
        $('hakimAvgLatency').textContent = d.avg_latency_ms != null ? `${d.avg_latency_ms} ms` : '—';
        $('hakimReqNote').textContent = `Based on ${d.requests_logged} instrumented request(s) since the last bot restart.`;
      } else {
        $('hakimSuccessRate').textContent = 'No data yet';
        $('hakimAvgLatency').textContent = 'No data yet';
        $('hakimReqNote').textContent = 'Instrumentation was added 2026-07-17 but hakim-bot has not been restarted since — success rate and latency need a restart to start collecting.';
      }
      $('hakimErrorCount').textContent = `${(d.recent_errors||[]).length} shown`;
      $('hakimErrorList').innerHTML = (d.recent_errors||[]).length
        ? d.recent_errors.map(e => `
          <div style="padding:.4rem .6rem;border-bottom:1px solid var(--border);font-size:.75rem">
            <span style="color:var(--muted-2)">${esc(e.ts)}</span> —
            <span style="color:var(--danger)">${esc(e.error||'unknown')}</span>
            (provider: ${esc(e.provider)}${e.fallback_used ? ', fallback' : ''})
          </div>`).join('')
        : `<div class="panel-empty">No errors logged${d.requests_logged>0?'':' — no instrumented requests yet'}.</div>`;
      $('hakimKnowledge').textContent = d.knowledge_summary || '—';
    } catch(e) { toast('Hakim: '+e.message,'error'); }
  },
};
$('hakimTestBtn')?.addEventListener('click', async () => {
  const q = $('hakimTestQuestion').value.trim();
  if (!q) return;
  const resultEl = $('hakimTestResult');
  resultEl.textContent = 'Asking Hakim… (real API call, a few seconds)';
  try {
    const d = await api.get('hakim-test-query', {question: q});
    resultEl.textContent = d.answer || '(empty response)';
  } catch(e) {
    resultEl.textContent = 'Error: ' + e.message;
  }
});

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

// ── Global user search (topbar) — live results on partial IDs ───────
(() => {
  const inp = $('gSearch'), drop = $('gSearchDrop'), wrap = $('gSearchWrap');
  if (!inp) return;
  let items = [], sel = -1, seq = 0;
  const close = () => { drop.hidden = true; drop.innerHTML = ''; sel = -1; items = []; };
  const pick = i => {
    const r = items[i];
    if (!r) return;
    close(); inp.blur();
    devDetail(r.device_id);
  };
  const render = () => {
    drop.innerHTML = items.length
      ? items.map((r, i) => {
          const uid = r.user_id || r.device_id.substring(0, 16);
          return `<div class="gsearch-item${i === sel ? ' sel' : ''}" data-i="${i}">
            <span class="dot ${r.is_online ? 'dot-ok' : 'dot-unk'}"></span>
            <span class="gsearch-uid">${esc(uid)}</span>
            <span class="gsearch-meta">${countryFlag(r.country || '')} ${esc(r.platform || '?')} · ${esc(r.plan || '')} · ${fmtRelative(r.last_seen)}</span>
          </div>`;
        }).join('')
      : '<div class="gsearch-empty">No users match</div>';
    drop.hidden = false;
    drop.querySelectorAll('.gsearch-item').forEach(el => {
      // mousedown (not click) so the input's blur can't race the selection
      el.onmousedown = e => { e.preventDefault(); pick(+el.dataset.i); };
    });
  };
  const run = debounce(async () => {
    const q = inp.value.trim();
    if (q.length < 2) { close(); return; }
    const mySeq = ++seq;
    try {
      const d = await api.get('user-search', {q});
      if (mySeq !== seq) return; // a newer keystroke's response wins
      items = d.results || []; sel = items.length ? 0 : -1; render();
    } catch (_) { /* keep quiet while typing */ }
  }, 150);
  inp.oninput = run;
  inp.onfocus = () => { if (inp.value.trim().length >= 2) run(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown')    { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter')   { if (sel >= 0) pick(sel); }
    else if (e.key === 'Escape')  { close(); inp.blur(); }
  };
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
})();

// ── Boot ─────────────────────────────────────────────────────────────
navigate(INIT_PAGE);
</script>
</body>
</html>
