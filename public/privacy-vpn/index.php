<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
$dl_link   = '/download/setalink-latest.apk';
$title     = 'Anti-Censorship VPN — SetaLink | Bypass DPI, DNS-over-HTTPS, VLESS Reality';
$desc      = 'SetaLink: purpose-built anti-censorship VPN using VLESS+Reality, DNS-over-HTTPS, and AI routing. Bypasses Deep Packet Inspection. Free for journalists, students, and activists.';
$keywords  = 'anti-censorship VPN, bypass DPI, deep packet inspection bypass, DNS over HTTPS VPN, privacy VPN, journalist VPN, Reality protocol, free anti-censorship';
$canonical = 'https://setalink.no/privacy-vpn/';
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
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-128.png" class="hero-logo" width="112" height="112" alt="Anti-censorship VPN">
  </div>
  <div class="hero-badge"><span class="dot-live"></span>Live — Norway &amp; Turkey nodes</div>
  <h1>
    Built to Bypass<br>
    <span class="text-gradient">Censorship</span>
  </h1>
  <p class="hero-sub">
    Not a consumer VPN. SetaLink was engineered for regions with active Deep Packet Inspection. VLESS+Reality. DNS-over-HTTPS through the tunnel. Real HTTP probe validation. 1 GB free.
  </p>
  <div class="hero-btns">
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      Download Free APK
    </a>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-secondary">Community</a>
  </div>
</section>

<div class="divider"></div>

<section class="section">
  <div class="section-label">TECHNICAL APPROACH</div>
  <h2 class="section-title">How SetaLink Defeats Censorship</h2>
  <p class="section-sub">Three layers of anti-censorship protection working together.</p>

  <div class="bento-grid">
    <div class="bento-cell">
      <div class="bento-icon green">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <h4>Layer 1: Undetectable Transport</h4>
      <p>VLESS+Reality uses TLS 1.3 with real certificates from legitimate domains. Deep Packet Inspection sees a normal HTTPS connection — not a VPN. This defeats fingerprinting-based blocking used in Iran, China, and Turkey.</p>
    </div>
    <div class="bento-cell">
      <div class="bento-icon gold">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/><path d="M3.6 9h16.8M3.6 15h16.8"/></svg>
      </div>
      <h4>Layer 2: Encrypted DNS</h4>
      <p>DNS queries travel through the encrypted VPN tunnel via DNS-over-HTTPS (1.1.1.1, 8.8.8.8, 9.9.9.9). ISP DNS poisoning — a widely used censorship technique — cannot intercept or redirect your domain lookups.</p>
    </div>
    <div class="bento-cell">
      <div class="bento-icon blue">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4"/></svg>
      </div>
      <h4>Layer 3: Real Validation</h4>
      <p>TCP-connected is not enough. SetaLink sends a real HTTP/HTTPS request through the tunnel and verifies data is received before declaring connection success. Fake "connected" states that deliver no real internet are rejected.</p>
    </div>
    <div class="bento-cell">
      <div class="bento-icon red">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h4>Automatic Adaptation</h4>
      <p>When a blocking pattern changes, Remote Config pushes new SNI priorities and protocol orders to all devices — no app update required. Typically within minutes of a new blocking event being detected.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="faq">
  <div class="faq-section">
    <div class="section-label">FAQ</div>
    <h2 class="section-title">Anti-Censorship VPN — Technical FAQ</h2>
  </div>
  <div class="faq-list">
    <?php
    $faqs = [
      ['What is Deep Packet Inspection (DPI) and how does SetaLink bypass it?',
       'DPI is a network analysis technique where ISPs or governments inspect the contents and patterns of network packets — not just IP addresses and ports. VPN protocols like WireGuard, OpenVPN, and Shadowsocks have identifiable packet structures and TLS fingerprints. VLESS+Reality generates traffic that looks identical to a TLS 1.3 connection to a legitimate domain, defeating DPI pattern matching.'],
      ['How is DNS-over-HTTPS better than regular DNS?',
       'Standard DNS queries are sent in plaintext to your ISP\'s resolver, which can modify (poison) the response to redirect blocked domains to fake IPs or return NXDOMAIN. DoH encrypts DNS queries and sends them as HTTPS requests through the VPN tunnel directly to trusted resolvers (1.1.1.1, 8.8.8.8). Your ISP cannot see or alter these queries.'],
      ['What is the difference between TCP validation and real internet validation?',
       'Most VPNs declare connection success after a TCP handshake with the VPN server succeeds. But a TCP connection to the server doesn\'t mean internet traffic is actually routing through it — NAT may be broken, the server may not be forwarding packets, or the connection may be throttled. SetaLink performs an HTTP GET request through the tunnel and verifies a data response before declaring success.'],
      ['Who is SetaLink designed for?',
       'SetaLink targets users in heavily censored regions — primarily Iran and Turkey — where standard VPN protocols fail. It\'s useful for anyone who needs reliable internet access: journalists, students, researchers, activists, or anyone who values unrestricted access to information.'],
      ['Is SetaLink open source?',
       'The Xray-core engine used by SetaLink is open source. The SetaLink Android application is available on GitHub for community review. The server-side configuration and admin infrastructure are proprietary, but no security claims are made that rely on secrecy.'],
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
  <h2 class="section-title" style="margin-bottom:16px">Free. No account. One tap to connect.</h2>
  <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary" style="font-size:1.05rem;padding:.8rem 2rem">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
    Download SetaLink APK
  </a>
  <p style="margin-top:16px;font-size:.8rem;color:var(--text-3)">
    Also see: <a href="/iran-vpn/" style="color:var(--gold)">Iran VPN</a> ·
    <a href="/v2ray-iran/" style="color:var(--gold)">V2Ray Iran</a> ·
    <a href="/fa/" style="color:var(--gold)">فارسی</a> ·
    <a href="/tr/" style="color:var(--gold)">Türkçe</a>
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
      <a href="/v2ray-iran/">V2Ray Iran</a>
      <a href="/fa/">فارسی</a>
      <a href="/tr/">Türkçe</a>
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
