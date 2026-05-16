<?php
// SetaLink public landing page
// Reads no user data — purely static content with server status check
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · Free VPN for Iran</title>
  <meta name="description" content="Fast, private VPN for Iran. Multiple anti-censorship transport protocols. Free accounts available.">
  <meta name="robots" content="noindex,nofollow">

  <!-- Google Fonts: Inter (EN) + Vazirmatn (FA) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/css/main.css">
</head>
<body dir="ltr">

<!-- ── NAVIGATION ── -->
<nav class="nav">
  <div class="nav-logo">
    <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#4f9cf9" opacity=".15"/>
      <path d="M14 5C9.03 5 5 9.03 5 14s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" stroke="#4f9cf9" stroke-width="1.6" fill="none"/>
      <path d="M10 14c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z" fill="#4f9cf9"/>
      <path d="M14 5v4M14 19v4M5 14h4M19 14h4" stroke="#4f9cf9" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    Seta<span class="dot">Link</span>
  </div>
  <div class="nav-actions">
    <button class="btn-lang" id="btn-lang" data-t="nav.lang">فارسی</button>
  </div>
</nav>

<!-- ── HERO ── -->
<section class="hero">
  <div class="hero-badge">
    <span class="dot-live"></span>
    <span data-t="hero.badge">Server Online</span>
  </div>
  <h1>
    <span data-t="hero.h1a">Bypass Internet</span>
    <br>
    <span class="highlight" data-t="hero.h1b">Censorship</span>
  </h1>
  <p data-t="hero.sub">
    Fast, private VPN for Iran. Multiple transport protocols designed to stay connected when everything else is blocked.
  </p>
  <div class="hero-btns">
    <a href="#contact" class="btn btn-primary" data-t="hero.cta1">Get Started</a>
    <a href="#howto" class="btn btn-secondary" data-t="hero.cta2">How it works</a>
  </div>
</section>

<div class="divider"></div>

<!-- ── DOWNLOAD APPS ── -->
<section class="section" id="download">
  <div class="section-label" data-t="dl.label">APPS</div>
  <h2 data-t="dl.h2">Download &amp; Connect</h2>
  <p class="sub" data-t="dl.sub">Use one of these free apps to import your VPN profile.</p>

  <div class="app-grid">
    <a href="https://github.com/2dust/v2rayNG/releases" target="_blank" rel="noopener" class="app-card">
      <div class="app-card-top">
        <div class="app-icon">📱</div>
        <div>
          <div class="app-name">v2rayNG</div>
          <div class="app-meta" data-t="app.v2ray.meta">Android · Recommended</div>
        </div>
      </div>
      <span class="app-badge">RECOMMENDED</span>
      <div class="app-meta" data-t="app.v2ray.desc">Most compatible with all VLESS transports</div>
    </a>

    <a href="https://apps.apple.com/app/streisand/id6450534064" target="_blank" rel="noopener" class="app-card">
      <div class="app-card-top">
        <div class="app-icon">🍎</div>
        <div>
          <div class="app-name">Streisand</div>
          <div class="app-meta" data-t="app.streisand.meta">iOS / macOS</div>
        </div>
      </div>
      <div class="app-meta" data-t="app.streisand.desc">Clean iOS client, supports VLESS Reality</div>
    </a>

    <a href="https://github.com/hiddify/hiddify-app/releases/latest" target="_blank" rel="noopener" class="app-card">
      <div class="app-card-top">
        <div class="app-icon">🔒</div>
        <div>
          <div class="app-name">Hiddify</div>
          <div class="app-meta" data-t="app.hiddify.meta">Android / Windows</div>
        </div>
      </div>
      <div class="app-meta" data-t="app.hiddify.desc">All-in-one, great for beginners</div>
    </a>

    <a href="https://github.com/2dust/v2rayNG/releases/latest" target="_blank" rel="noopener" class="app-card">
      <div class="app-card-top">
        <div class="app-icon">⚡</div>
        <div>
          <div class="app-name">v2rayNG APK</div>
          <div class="app-meta" data-t="app.v2rayng.meta">Android (stable)</div>
        </div>
      </div>
      <div class="app-meta" data-t="app.v2rayng.desc">Widely used, very stable</div>
    </a>
  </div>
</section>

<div class="divider"></div>

<!-- ── HOW TO CONNECT ── -->
<section class="section" id="howto">
  <div class="section-label" data-t="howto.label">SETUP GUIDE</div>
  <h2 data-t="howto.h2">Connect in 3 steps</h2>
  <p class="sub" data-t="howto.sub">Your VPN profile is ready. Just follow these steps.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-content">
        <h3 data-t="s1.h">Download an app</h3>
        <p data-t="s1.p">Install v2rayNG, Hiddify, or Streisand from the links above.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-content">
        <h3 data-t="s2.h">Import your profile</h3>
        <p data-t="s2.p">Open the app and paste your VLESS link, or scan the QR code sent to you.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-content">
        <h3 data-t="s3.h">Connect and browse</h3>
        <p data-t="s3.p">Tap connect. If one profile is blocked, try another transport — try Reality or XHTTP first.</p>
      </div>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ── TRANSPORT STATUS ── -->
<section class="section" id="transports">
  <div class="section-label" data-t="transports.label">TRANSPORTS</div>
  <h2 data-t="transports.h2">Available Connections</h2>
  <p class="sub" data-t="transports.sub">Four different tunneling methods. If one is blocked by your ISP, switch to another.</p>

  <div class="transports-grid">
    <div class="transport-card">
      <div class="transport-header">
        <div class="transport-name">Reality</div>
        <div class="status-dot" title="Online"></div>
      </div>
      <div class="transport-desc" data-t="tr.reality.desc">
        Hardest to detect. Direct TCP, looks like normal HTTPS traffic.
      </div>
      <div class="transport-tag">TCP:8443 · TLS Reality</div>
    </div>

    <div class="transport-card">
      <div class="transport-header">
        <div class="transport-name">XHTTP</div>
        <div class="status-dot" id="status-xhttp" title="Checking..."></div>
      </div>
      <div class="transport-desc" data-t="tr.xhttp.desc">
        HTTP/2 stream. Resistant to deep packet inspection.
      </div>
      <div class="transport-tag">443 · HTTP/2 · /xhttp</div>
    </div>

    <div class="transport-card">
      <div class="transport-header">
        <div class="transport-name">HTTPUpgrade</div>
        <div class="status-dot" id="status-httpup" title="Checking..."></div>
      </div>
      <div class="transport-desc" data-t="tr.httpup.desc">
        HTTP Upgrade tunnel. Reliable fallback.
      </div>
      <div class="transport-tag">443 · TLS · /httpup</div>
    </div>

    <div class="transport-card">
      <div class="transport-header">
        <div class="transport-name">WebSocket</div>
        <div class="status-dot" id="status-ws" title="Checking..."></div>
      </div>
      <div class="transport-desc" data-t="tr.ws.desc">
        WebSocket over TLS. Widely compatible.
      </div>
      <div class="transport-tag">443 · TLS · /ws</div>
    </div>
  </div>

  <div class="notice">
    <span class="icon">ℹ️</span>
    <span>Status dots show whether this server's transports are reachable from your location. A green dot means the connection path is open. If a transport shows offline, switch to a different one.</span>
  </div>
</section>

<div class="divider"></div>

<!-- ── FAQ ── -->
<section class="section" id="faq">
  <div class="section-label" data-t="faq.label">FAQ</div>
  <h2 data-t="faq.h2">Common Questions</h2>

  <div class="faq-list" style="margin-top:32px">

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q1">Which profile should I try first?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a1">Start with REALITY — it's the hardest to detect. If that's blocked, try XHTTP, then HTTPUpgrade, then WebSocket.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q2">The VPN connects but pages don't load?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a2">Try a different transport. Your ISP may be blocking that protocol specifically. Reality and XHTTP are usually the most resilient.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q3">How do I get a profile link?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a3">Contact us via Telegram. We'll send you a personal VLESS link and QR code for all transports.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q4">Is it free?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a4">Yes, for now. Free 7-day and 30-day accounts are available. Contact us on Telegram to get access.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q5">What is VLESS / what client should I use?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a5">VLESS is a modern VPN protocol used by Xray-core. Use v2rayNG (Android) or Hiddify (all platforms). These apps support all our transport types.</p>
      </div>
    </div>

  </div>
</section>

<div class="divider"></div>

<!-- ── CONTACT ── -->
<section class="contact-section" id="contact">
  <div class="section-label" data-t="contact.label">CONTACT</div>
  <h2 data-t="contact.h2">Get Your Free Account</h2>
  <p style="color:var(--text2);margin-top:10px" data-t="contact.sub">
    Message us on Telegram to get your personal VPN profile link and QR code.
  </p>

  <div class="contact-card">
    <div class="tg-icon">✈️</div>
    <h3>Telegram</h3>
    <p data-t="contact.note">We reply within a few hours. Free accounts available.</p>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-primary">
      <span data-t="contact.cta">Message on Telegram</span>
    </a>
  </div>
</section>

<footer>
  <span data-t="footer">© 2026 SetaLink · Free VPN for Iran</span>
</footer>

<script src="/js/main.js"></script>
</body>
</html>
