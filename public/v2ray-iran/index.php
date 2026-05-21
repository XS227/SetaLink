<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
$dl_link   = '/download/setalink-latest.apk';
$title     = 'V2Ray Iran Alternative — SetaLink | VLESS Reality Android VPN';
$desc      = 'SetaLink is a modern V2Ray alternative for Iran. Uses VLESS+Reality (Xray-core), AI protocol selection, DNS-over-HTTPS, and 1 GB free data. No config files needed.';
$keywords  = 'V2Ray Iran, Xray Iran, VLESS Reality Iran, V2Ray alternative, Xray Android, Reality protocol VPN, anti-censorship V2Ray';
$canonical = 'https://setalink.no/v2ray-iran/';
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<?php include __DIR__ . '/../includes/_head.php'; ?>
</head>
<body dir="ltr">
<div class="page-wrap">

<nav class="nav">
  <a href="/" class="nav-logo">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="32" height="32" alt="SetaLink">
    <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
  </a>
  <div class="nav-actions">
    <a href="/fa/" style="font-size:.82rem;color:var(--text-2);text-decoration:none">فارسی</a>
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      Download APK
    </a>
  </div>
</nav>

<section class="hero">
  <div class="hero-glow"></div>
  <div class="hero-ring">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-128.png" class="hero-logo" width="112" height="112" alt="SetaLink — V2Ray alternative for Iran">
  </div>
  <div class="hero-badge"><span class="dot-live"></span>Server Online — Norway &amp; Turkey</div>
  <h1>
    V2Ray Iran —<br>
    <span class="text-gradient">The Modern Alternative</span>
  </h1>
  <p class="hero-sub">
    SetaLink runs Xray-core with VLESS+Reality — the protocol that replaced V2Ray for censored regions. No config files, no JSON, no servers to set up. AI picks the best route. 1 GB free.
  </p>
  <div class="hero-btns">
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      Download Free APK
    </a>
    <a href="/iran-vpn/" class="btn btn-secondary">Why it works in Iran →</a>
  </div>
</section>

<div class="divider"></div>

<section class="section">
  <div class="section-label">V2RAY vs SETALINK</div>
  <h2 class="section-title">How SetaLink Improves on V2Ray</h2>
  <div class="why-grid">
    <div class="why-card">
      <div class="why-card-title">WHAT V2RAY REQUIRES</div>
      <ul class="why-list">
        <li>Find and copy a VLESS/VMess link from a public source</li>
        <li>Manually configure a V2Ray client app</li>
        <li>Test if the server is blocked in your region</li>
        <li>Find new links when the server gets blocked</li>
        <li>No validation that internet actually works through the tunnel</li>
      </ul>
    </div>
    <div class="why-card">
      <div class="why-card-title">WHAT SETALINK DOES</div>
      <ul class="why-list">
        <li>Install APK — server credentials are pre-configured</li>
        <li>AI tests VLESS+Reality, XHTTP, and WebSocket in parallel</li>
        <li>Validates real internet delivery via HTTP probe, not just TCP</li>
        <li>Remote Config pushes new SNIs and protocol priorities automatically</li>
        <li>DNS-over-HTTPS prevents ISP from poisoning DNS inside the tunnel</li>
      </ul>
    </div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="faq">
  <div class="faq-section">
    <div class="section-label">FAQ</div>
    <h2 class="section-title">V2Ray Iran — Technical Questions</h2>
  </div>
  <div class="faq-list">
    <?php
    $faqs = [
      ['Is SetaLink based on V2Ray or Xray?',
       'SetaLink uses Xray-core — the actively maintained fork of V2Ray with support for VLESS+Reality, XHTTP, and other modern protocols. The Xray project added Reality in 2023, which is now the most censorship-resistant transport available. V2Ray itself has not been updated with Reality support.'],
      ['What is the difference between VLESS+Reality and V2Ray VMess?',
       'VMess is an older V2Ray protocol that uses a custom encryption format that is detectable by sophisticated DPI. VLESS+Reality is a newer VLESS protocol combined with the Reality transport, which uses actual TLS 1.3 with a real certificate from a legitimate domain — making it look like normal HTTPS traffic to any observer.'],
      ['Do I need to run my own V2Ray server?',
       'No. SetaLink is a managed service — the servers are operated by SetaLink. You just download the APK and connect. No server setup, no buying VPS, no managing Xray config files. The 1 GB free package starts immediately on install.'],
      ['How does SetaLink handle blocked V2Ray subscriptions?',
       'SetaLink does not use subscription links. Server credentials are managed through the app\'s Remote Config system. When a protocol or SNI is blocked, updated routing rules are pushed to all devices automatically — no action required from the user.'],
    ];
    foreach ($faqs as $i => [$q, $a]): ?>
    <div class="faq-item">
      <button class="faq-q" aria-expanded="false">
        <?= htmlspecialchars($q) ?>
        <svg class="faq-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="faq-a"><?= htmlspecialchars($a) ?></div>
    </div>
    <?php endforeach; ?>
  </div>
</section>

<div class="divider"></div>

<section class="section" style="text-align:center;padding-bottom:80px">
  <h2 class="section-title" style="margin-bottom:16px">No config files. No servers. Just connect.</h2>
  <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary" style="font-size:1.05rem;padding:.8rem 2rem">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
    Download SetaLink APK
  </a>
  <p style="margin-top:16px;font-size:.8rem;color:var(--text-3)">1 GB free · No account · Android only</p>
  <p style="margin-top:8px;font-size:.8rem;color:var(--text-3)">
    Also see: <a href="/iran-vpn/" style="color:var(--gold)">Iran VPN guide</a> ·
    <a href="/fa/" style="color:var(--gold)">فارسی</a>
  </p>
</section>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="SetaLink" style="border-radius:7px">
      <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
    </div>
    <nav class="footer-links">
      <a href="/">Home</a>
      <a href="/iran-vpn/">Iran VPN</a>
      <a href="/fa/">فارسی</a>
      <a href="/faq.php">FAQ</a>
      <a href="<?= htmlspecialchars($dl_link) ?>">Download APK</a>
    </nav>
    <p class="footer-copy">&copy; <?= date('Y') ?> SetaLink VPN</p>
  </div>
</footer>

</div>
<script src="/js/main.js" defer></script>
</body>
</html>
