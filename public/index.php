<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · Smart VPN for Iran</title>
  <meta name="description" content="SetaLink — the first smart VPN app built for Iran. VLESS+Reality, AI routing, bilingual. Coming to Android soon.">
  <meta name="robots" content="noindex,nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/main.css">
  <style>
    /* ── App announcement section ── */
    .app-announce{background:linear-gradient(135deg,rgba(0,232,122,.06) 0%,rgba(51,153,255,.06) 100%);border:1px solid rgba(0,232,122,.2);border-radius:20px;padding:48px 40px;text-align:center;margin:0 auto;max-width:680px}
    .app-announce .badge{display:inline-flex;align-items:center;gap:8px;background:rgba(0,232,122,.12);border:1px solid rgba(0,232,122,.3);border-radius:100px;padding:5px 14px;font-size:.75rem;letter-spacing:.8px;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:24px}
    .app-announce h2{font-size:2rem;font-weight:800;line-height:1.15;margin-bottom:16px}
    .app-announce p{color:var(--text2);font-size:1rem;line-height:1.7;margin-bottom:32px;max-width:500px;margin-left:auto;margin-right:auto}
    .app-store-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px}
    .store-btn{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 22px;font-size:.9rem;font-weight:600;color:var(--text);text-decoration:none;transition:.2s}
    .store-btn:hover{border-color:var(--accent);color:var(--accent)}
    .store-btn .store-icon{font-size:1.4rem}
    .store-note{font-size:.8rem;color:var(--text2);margin-top:8px}

    /* ── Features grid ── */
    .features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-top:40px}
    .feat-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px}
    .feat-icon{font-size:2rem;margin-bottom:16px}
    .feat-card h3{font-size:1rem;font-weight:700;margin-bottom:8px;color:var(--text)}
    .feat-card p{font-size:.875rem;color:var(--text2);line-height:1.6}

    /* ── Pricing ── */
    .pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-top:40px}
    .price-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px;text-align:center}
    .price-card.featured{border-color:var(--accent);background:linear-gradient(135deg,rgba(0,232,122,.06),transparent)}
    .price-label{font-size:.7rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text2);margin-bottom:12px}
    .price-label.accent{color:var(--accent)}
    .price-amount{font-size:2.2rem;font-weight:800;color:var(--text);line-height:1}
    .price-period{font-size:.8rem;color:var(--text2);margin-bottom:20px}
    .price-features{list-style:none;padding:0;margin:0 0 24px;text-align:left;display:flex;flex-direction:column;gap:8px}
    .price-features li{font-size:.875rem;color:var(--text2);padding-left:20px;position:relative}
    .price-features li::before{content:"✓";position:absolute;left:0;color:var(--accent)}
    .price-cta{display:block;padding:11px 0;border-radius:10px;font-size:.9rem;font-weight:700;text-decoration:none;transition:.2s}
    .price-cta.outline{border:1px solid var(--border);color:var(--text)}
    .price-cta.outline:hover{border-color:var(--accent);color:var(--accent)}
    .price-cta.solid{background:var(--accent);color:#000}
    .price-cta.solid:hover{opacity:.9}

    /* ── Community ── */
    .community-row{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;margin-top:32px}
    .community-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px 28px;display:flex;align-items:center;gap:16px;min-width:240px;flex:1;max-width:340px;text-decoration:none;transition:.2s}
    .community-card:hover{border-color:var(--accent)}
    .community-icon{font-size:2rem;flex-shrink:0}
    .community-info h3{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:4px}
    .community-info p{font-size:.8rem;color:var(--text2)}
  </style>
</head>
<body dir="ltr">

<!-- ── NAVIGATION ── -->
<nav class="nav">
  <div class="nav-logo">
    <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#00e87a" opacity=".15"/>
      <path d="M14 5C9.03 5 5 9.03 5 14s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" stroke="#00e87a" stroke-width="1.6" fill="none"/>
      <path d="M10 14c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z" fill="#00e87a"/>
      <path d="M14 5v4M14 19v4M5 14h4M19 14h4" stroke="#00e87a" stroke-width="1.4" stroke-linecap="round"/>
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
    <span data-t="hero.h1a">Your VPN.</span>
    <br>
    <span class="highlight" data-t="hero.h1b">Built for Iran.</span>
  </h1>
  <p data-t="hero.sub">
    SetaLink is a smart VPN app designed from the ground up for Iran — VLESS+Reality protocols, AI-assisted routing, no logs, bilingual. Now in beta for Android.
  </p>
  <div class="hero-btns">
    <a href="#app" class="btn btn-primary" data-t="hero.cta1">Get the App</a>
    <a href="#features" class="btn btn-secondary" data-t="hero.cta2">See Features</a>
  </div>
</section>

<div class="divider"></div>

<!-- ── APP ANNOUNCEMENT ── -->
<section class="section" id="app">
  <div class="app-announce">
    <div class="badge">
      <span class="dot-live"></span>
      <span data-t="app.badge">Android Beta · Available Now</span>
    </div>
    <h2 data-t="app.h2">The SetaLink App is Here</h2>
    <p data-t="app.sub">No more importing configs into third-party apps. SetaLink is a complete VPN app — connect in one tap, switch servers instantly, and let AI pick the fastest route.</p>
    <div class="app-store-btns">
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="store-btn">
        <span class="store-icon">📱</span>
        <span>
          <span style="font-size:.7rem;display:block;color:var(--text2)" data-t="app.android.pre">Join Beta</span>
          <span data-t="app.android.label">Android APK</span>
        </span>
      </a>
      <a href="#" class="store-btn" style="opacity:.5;cursor:not-allowed">
        <span class="store-icon">🍎</span>
        <span>
          <span style="font-size:.7rem;display:block;color:var(--text2)" data-t="app.ios.pre">Coming Soon</span>
          <span data-t="app.ios.label">iOS App</span>
        </span>
      </a>
    </div>
    <div class="store-note" data-t="app.note">Contact us on Telegram to join the Android beta · iOS coming Q3 2026</div>
  </div>
</section>

<div class="divider"></div>

<!-- ── FEATURES ── -->
<section class="section" id="features">
  <div class="section-label" data-t="feat.label">FEATURES</div>
  <h2 data-t="feat.h2">Built Different</h2>
  <p class="sub" data-t="feat.sub">Every detail designed for users behind Iran's firewall.</p>

  <div class="features-grid">
    <div class="feat-card">
      <div class="feat-icon">🔒</div>
      <h3 data-t="feat.f1.h">VLESS + Reality</h3>
      <p data-t="feat.f1.p">The hardest-to-block protocol available. Traffic looks identical to normal HTTPS — no VPN fingerprint to detect.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">🤖</div>
      <h3 data-t="feat.f2.h">AI Smart Routing</h3>
      <p data-t="feat.f2.p">AI engine monitors latency and blocking patterns, auto-switches protocols and servers to keep you connected.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">⚡</div>
      <h3 data-t="feat.f3.h">One-Tap Connect</h3>
      <p data-t="feat.f3.p">No config files, no QR codes, no setup. Install, tap connect — that's it. Reconnects automatically on network changes.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">🌐</div>
      <h3 data-t="feat.f4.h">Bilingual</h3>
      <p data-t="feat.f4.p">Full Persian and English support with proper RTL layout. The first VPN app that feels native for Iranian users.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">🛡</div>
      <h3 data-t="feat.f5.h">Zero Logs</h3>
      <p data-t="feat.f5.p">We never store connection logs, your IP, or traffic data. Privacy is not a feature — it's the foundation.</p>
    </div>
    <div class="feat-card">
      <div class="feat-icon">📊</div>
      <h3 data-t="feat.f6.h">Live Stats</h3>
      <p data-t="feat.f6.p">Real-time upload/download speed, ping, session timer, and traffic history — all visible at a glance.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ── TRANSPORT STATUS ── -->
<section class="section" id="transports">
  <div class="section-label" data-t="transports.label">TRANSPORTS</div>
  <h2 data-t="transports.h2">Available Connections</h2>
  <p class="sub" data-t="transports.sub">Four tunneling methods. The app switches automatically — or you can pick manually.</p>

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
    <span data-t="transports.notice">Status dots show whether this server's transports are reachable from your location. The app handles switching automatically.</span>
  </div>
</section>

<div class="divider"></div>

<!-- ── PRICING ── -->
<section class="section" id="pricing">
  <div class="section-label" data-t="pricing.label">PRICING</div>
  <h2 data-t="pricing.h2">Simple Plans</h2>
  <p class="sub" data-t="pricing.sub">Start free. Upgrade when you need more.</p>

  <div class="pricing-grid">
    <div class="price-card">
      <div class="price-label" data-t="plan.free.label">FREE</div>
      <div class="price-amount">$0</div>
      <div class="price-period" data-t="plan.free.period">Always free</div>
      <ul class="price-features">
        <li data-t="plan.free.f1">10 GB / month</li>
        <li data-t="plan.free.f2">5 server locations</li>
        <li data-t="plan.free.f3">All protocols</li>
        <li data-t="plan.free.f4">Standard speed</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta outline" data-t="plan.free.cta">Get Started Free</a>
    </div>

    <div class="price-card featured">
      <div class="price-label accent" data-t="plan.premium.label">PREMIUM</div>
      <div class="price-amount">$3</div>
      <div class="price-period" data-t="plan.premium.period">per month</div>
      <ul class="price-features">
        <li data-t="plan.premium.f1">Unlimited data</li>
        <li data-t="plan.premium.f2">50+ server locations</li>
        <li data-t="plan.premium.f3">All protocols + AI routing</li>
        <li data-t="plan.premium.f4">Maximum speed</li>
        <li data-t="plan.premium.f5">Priority support</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta solid" data-t="plan.premium.cta">Get Premium</a>
    </div>

    <div class="price-card">
      <div class="price-label" data-t="plan.team.label">TEAM</div>
      <div class="price-amount">$8</div>
      <div class="price-period" data-t="plan.team.period">5 users / month</div>
      <ul class="price-features">
        <li data-t="plan.team.f1">Everything in Premium</li>
        <li data-t="plan.team.f2">5 simultaneous users</li>
        <li data-t="plan.team.f3">Shared admin panel</li>
        <li data-t="plan.team.f4">Dedicated account manager</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta outline" data-t="plan.team.cta">Contact for Team</a>
    </div>
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
        <span data-t="faq.q1">How do I get the app?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a1">Message us on Telegram to receive the Android APK and your account credentials. iOS is coming in Q3 2026.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q2">Which protocol should I use?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a2">The app picks the best protocol automatically. If you want to choose manually, start with Reality — it's the hardest to detect. Then try XHTTP, HTTPUpgrade, WebSocket.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q3">Is my data private?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a3">Yes. We never log your IP address, connection times, or browsing data. The VPN tunnel itself uses VLESS+Reality which is end-to-end encrypted.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q4">The VPN connects but pages don't load?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a4">Try a different transport from the server screen. Your ISP may be blocking that specific protocol. Reality and XHTTP are usually the most resilient.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q5">Can I still use v2rayNG / Hiddify?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a5">Yes. Contact us on Telegram and we'll send you a VLESS subscription link compatible with v2rayNG (Android), Streisand (iOS), and Hiddify (all platforms).</p>
      </div>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ── COMMUNITY ── -->
<section class="section" id="community" style="text-align:center">
  <div class="section-label" data-t="comm.label">COMMUNITY</div>
  <h2 data-t="comm.h2">Stay Connected</h2>
  <p class="sub" data-t="comm.sub">Join our channels for updates, new servers, and support.</p>

  <div class="community-row">
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="community-card">
      <div class="community-icon">✈️</div>
      <div class="community-info">
        <h3 data-t="comm.tg.h">Telegram Support</h3>
        <p data-t="comm.tg.p">Get your account, report issues, ask questions.</p>
      </div>
    </a>
    <a href="https://t.me/SetaLinkChannel" target="_blank" rel="noopener" class="community-card">
      <div class="community-icon">📢</div>
      <div class="community-info">
        <h3 data-t="comm.ch.h">Announcements Channel</h3>
        <p data-t="comm.ch.p">Server updates, new features, downtime alerts.</p>
      </div>
    </a>
  </div>
</section>

<footer>
  <span data-t="footer">© 2026 SetaLink · Smart VPN for Iran</span>
</footer>

<script src="/js/main.js"></script>
</body>
</html>
