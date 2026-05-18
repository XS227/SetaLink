<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · Free Internet for Everyone</title>
  <meta name="description" content="SetaLink — AI-powered VPN for censored regions. Android-only. 1 GB free on install. No account needed. VLESS+Reality, real internet validation.">
  <meta name="robots" content="noindex,nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="icon" type="image/x-icon" href="/assets/logo/shirokhorshid/favicon.ico">
  <link rel="stylesheet" href="/css/main.css">
</head>
<body dir="ltr">

<!-- ════════════════════════════════════════════
     NAVIGATION
════════════════════════════════════════════ -->
<nav class="nav">
  <a href="/" class="nav-logo" style="text-decoration:none">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="30" height="30" alt="SetaLink">
    <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
  </a>
  <div class="nav-actions">
    <!-- Lion & Sun Flag language toggle -->
    <button class="btn-lang" id="btn-lang" aria-label="Toggle language">
      <!-- Pre-1979 Iranian flag — Lion and Sun -->
      <svg viewBox="0 0 30 20" width="30" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="30" height="6.67" fill="#239F23"/>
        <rect y="6.67" width="30" height="6.67" fill="#F5F0E8"/>
        <rect y="13.33" width="30" height="6.67" fill="#C8102E"/>
        <!-- Stylized sun rays -->
        <line x1="15" y1="5.5" x2="15" y2="3.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="15" y1="14.5" x2="15" y2="16.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="9.5" y1="10" x2="7.5" y2="10"   stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="20.5" y1="10" x2="22.5" y2="10" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="11.2" y1="6.8"  x2="9.8"  y2="5.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="18.8" y1="6.8"  x2="20.2" y2="5.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="11.2" y1="13.2" x2="9.8"  y2="14.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="18.8" y1="13.2" x2="20.2" y2="14.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <!-- Lion body (stylized) -->
        <ellipse cx="15" cy="10.5" rx="3.2" ry="2.2" fill="#C9A42A" opacity=".92"/>
        <!-- Lion head -->
        <circle cx="17.2" cy="8.8" r="1.9" fill="#C9A42A" opacity=".92"/>
        <!-- Mane rays around head -->
        <circle cx="15" cy="10.5" rx="3.6" ry="2.6" fill="none" stroke="#C9A42A" stroke-width=".5" opacity=".55"/>
        <!-- Sun disk center -->
        <circle cx="15" cy="10" r="1.3" fill="none" stroke="#C9A42A" stroke-width=".6" opacity=".7"/>
      </svg>
      <span class="btn-lang-text" data-t="nav.lang.label">فارسی</span>
    </button>
    <a href="/download/setalink-latest.apk" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      <span data-t="nav.download">Download APK</span>
    </a>
  </div>
</nav>

<!-- ════════════════════════════════════════════
     HERO
════════════════════════════════════════════ -->
<section class="hero">
  <!-- Glow ring + logo -->
  <div class="hero-ring">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-128.png"
         width="100" height="100" alt="SetaLink logo">
  </div>

  <div class="hero-badge">
    <span class="dot-live"></span>
    <span data-t="hero.badge">Server Online &mdash; Norway/Turkey nodes</span>
  </div>

  <h1>
    <span data-t="hero.h1">Free Internet<br><span class="text-gradient">for Everyone</span></span>
  </h1>

  <p class="hero-sub" data-t="hero.sub">
    AI-powered VPN built for censored regions. Android-only. No servers needed to start.
  </p>

  <div class="hero-btns">
    <a href="/download/setalink-latest.apk" class="btn btn-primary">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      <span data-t="hero.cta1">Download APK</span>
    </a>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-secondary">
      <!-- Telegram icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
      <span data-t="hero.cta2">Join Telegram</span>
    </a>
  </div>

  <div class="hero-status">
    <span class="dot-live"></span>
    <span data-t="hero.status">Server Online &mdash; Norway/Turkey nodes active</span>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     HOW IT WORKS
════════════════════════════════════════════ -->
<section class="section" id="how">
  <div class="section-label" data-t="how.label">HOW IT WORKS</div>
  <h2 class="section-title" data-t="how.title">Three Steps to Free Internet</h2>
  <p class="section-sub" data-t="how.sub">No account, no credit card, no configuration. Install and connect.</p>

  <div class="steps-grid">
    <!-- Step 1 -->
    <div class="step-card">
      <div class="step-num">1</div>
      <h3 data-t="how.s1.h">Get Emergency Access</h3>
      <p data-t="how.s1.p">Install the APK — you instantly receive a 1 GB starter pack. No account, no login, no credit card. Open the app, tap Connect.</p>
    </div>
    <!-- Step 2 -->
    <div class="step-card">
      <div class="step-num">2</div>
      <h3 data-t="how.s2.h">Invite &amp; Grow</h3>
      <p data-t="how.s2.p">Share your referral code with friends. Each person who joins adds 512 MB to both of you. The more you share, the more you get.</p>
    </div>
    <!-- Step 3 -->
    <div class="step-card">
      <div class="step-num">3</div>
      <h3 data-t="how.s3.h">AI Picks Best Route</h3>
      <p data-t="how.s3.p">The AI optimizer tests Reality, XHTTP, and WebSocket on every connection. It picks the fastest protocol that actually reaches the internet from your location.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     SMART AI SECTION
════════════════════════════════════════════ -->
<section class="section" id="ai">
  <div class="ai-section">
    <div class="section-label" data-t="ai.label">INTELLIGENT ROUTING</div>
    <h2 class="section-title" data-t="ai.title">Not Just a Tunnel</h2>
    <p class="section-sub" data-t="ai.sub">SetaLink actively validates your connection and picks the best path — every single time.</p>

    <div class="ai-grid">
      <div class="ai-feat">
        <div class="ai-icon">&#x1F9E0;</div>
        <div>
          <h4 data-t="ai.f1.h">AI Protocol Optimizer</h4>
          <p data-t="ai.f1.p">Tests Reality, XHTTP, and WebSocket in parallel. Picks the fastest working protocol for your current network — not the last one that worked, the one that works now.</p>
        </div>
      </div>
      <div class="ai-feat">
        <div class="ai-icon">&#x2705;</div>
        <div>
          <h4 data-t="ai.f2.h">Real Internet Validation</h4>
          <p data-t="ai.f2.p">TCP-connected is not enough. The app sends an actual HTTP/HTTPS request and verifies real data is received before declaring you connected. No fake "connected" states.</p>
        </div>
      </div>
      <div class="ai-feat">
        <div class="ai-icon">&#x1F5FA;</div>
        <div>
          <h4 data-t="ai.f3.h">Adaptive Routing</h4>
          <p data-t="ai.f3.p">Learns which SNIs work from your region. Turkey and Iran have different blocking patterns — the app adapts and remembers what works where.</p>
        </div>
      </div>
      <div class="ai-feat">
        <div class="ai-icon">&#x1F4E1;</div>
        <div>
          <h4 data-t="ai.f4.h">Remote Config</h4>
          <p data-t="ai.f4.p">Admin can push protocol priority updates without requiring an app update. When censorship patterns change, the server updates your routing rules automatically.</p>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     WHY SETALINK
════════════════════════════════════════════ -->
<section class="section" id="why">
  <div class="section-label" data-t="why.label">WHY SETALINK</div>
  <h2 class="section-title" data-t="why.title">Built for Real Censorship</h2>
  <p class="section-sub" data-t="why.sub">Not another generic VPN wrapped in a new UI. Built from scratch for the realities of Iran and Turkey.</p>

  <div class="why-grid">
    <!-- Technical -->
    <div class="why-col">
      <div class="why-col-title" data-t="why.tech.label">TECHNICAL EXCELLENCE</div>
      <ul class="why-list">
        <li data-t="why.tech.1">VLESS + Reality — the most censorship-resistant protocol available, traffic indistinguishable from HTTPS</li>
        <li data-t="why.tech.2">XHTTP and WebSocket fallback transports via nginx edge, tested continuously</li>
        <li data-t="why.tech.3">No logs, no account registration required to get started</li>
        <li data-t="why.tech.4">Open to community review — no black-box security claims</li>
      </ul>
    </div>
    <!-- Community -->
    <div class="why-col">
      <div class="why-col-title" data-t="why.comm.label">COMMUNITY MODEL</div>
      <ul class="why-list">
        <li data-t="why.comm.1">The more users join, the lower the infrastructure cost per user — a true shared network</li>
        <li data-t="why.comm.2">Referral bonuses for both inviter and invitee — growth benefits everyone</li>
        <li data-t="why.comm.3">Community-backed growth model — not a VC-funded black box</li>
        <li data-t="why.comm.4">Future: user-funded server expansion — vote on new regions</li>
      </ul>
    </div>
  </div>
</section>

<!-- ════════════════════════════════════════════
     NETWORK GROWS STRONGER BANNER
════════════════════════════════════════════ -->
<div class="banner">
  <p class="banner-quote" data-t="banner.q">"As the network grows, infrastructure cost per user decreases."</p>
  <p class="banner-sub"   data-t="banner.s">Every new user makes the network stronger and cheaper for everyone.</p>
</div>

<!-- ════════════════════════════════════════════
     PRICING
════════════════════════════════════════════ -->
<section class="section" id="pricing">
  <div class="section-label" data-t="pricing.label">ACCESS TIERS</div>
  <h2 class="section-title" data-t="pricing.title">Start Free. Grow Together.</h2>
  <p class="section-sub" data-t="pricing.sub">1 GB on install, more via referrals, unlimited coming soon.</p>

  <div class="pricing-grid">
    <!-- Free Emergency -->
    <div class="price-card">
      <div class="price-eyebrow" data-t="plan.free.eyebrow">FREE EMERGENCY</div>
      <div class="price-title"   data-t="plan.free.title">Starter Pack</div>
      <div class="price-desc"    data-t="plan.free.desc">Auto-activated on install. No account, no login, no credit card.</div>
      <ul class="price-features">
        <li data-t="plan.free.f1">1 GB starter quota</li>
        <li data-t="plan.free.f2">Auto-activated on install</li>
        <li data-t="plan.free.f3">AI protocol selection</li>
        <li data-t="plan.free.f4">No account needed</li>
      </ul>
      <a href="/download/setalink-latest.apk" class="price-cta price-cta-solid" data-t="plan.free.cta">Download APK</a>
    </div>

    <!-- Community -->
    <div class="price-card featured">
      <div class="price-eyebrow" data-t="plan.comm.eyebrow">INVITE-BASED</div>
      <div class="price-title"   data-t="plan.comm.title">Community</div>
      <div class="price-desc"    data-t="plan.comm.desc">Share your referral link. Every friend adds data for both of you.</div>
      <ul class="price-features">
        <li data-t="plan.comm.f1">+512 MB per friend invited</li>
        <li data-t="plan.comm.f2">Shared infrastructure benefits</li>
        <li data-t="plan.comm.f3">Priority protocol access</li>
        <li data-t="plan.comm.f4">Growing with the network</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta price-cta-solid" data-t="plan.comm.cta">Get Invite Link</a>
    </div>

    <!-- Premium coming soon -->
    <div class="price-card dimmed">
      <div class="price-eyebrow" data-t="plan.prem.eyebrow">COMING SOON</div>
      <div class="price-title"   data-t="plan.prem.title">Premium</div>
      <div class="price-desc"    data-t="plan.prem.desc">Unlimited data, priority nodes, dedicated support.</div>
      <ul class="price-features">
        <li data-t="plan.prem.f1">Unlimited data</li>
        <li data-t="plan.prem.f2">Priority nodes</li>
        <li data-t="plan.prem.f3">Dedicated support</li>
        <li data-t="plan.prem.f4">Early access features</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta price-cta-outline" data-t="plan.prem.cta">Join Waitlist</a>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     BUILT BY SETAEI
════════════════════════════════════════════ -->
<section class="section" id="setaei">
  <div class="built-section">
    <div class="section-label" style="margin-bottom:18px" data-t="setaei.label">THE MAKER</div>
    <h2 class="section-title" data-t="setaei.title">Built by SETAEI</h2>
    <p style="font-size:.9rem;color:var(--text2);margin-bottom:6px" data-t="setaei.subtitle">Independent AI + Infrastructure Initiative</p>
    <p class="built-desc" data-t="setaei.desc">
      SETAEI is an independent technology initiative focused on resilient connectivity and privacy-first infrastructure.
      Built across Norway and Turkey, SetaLink is our first public project &mdash; a real VPN for real censorship.
    </p>
    <div class="built-chips">
      <span class="chip chip-green" data-t="setaei.chip1">Norway/Turkey Operations</span>
      <span class="chip chip-gold"  data-t="setaei.chip2">AI-Driven</span>
      <span class="chip"            data-t="setaei.chip3">Privacy-First</span>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     SUPPORT THE PROJECT
════════════════════════════════════════════ -->
<section class="section" id="support">
  <div class="section-label" data-t="supp.label">SUPPORT THE NETWORK</div>
  <h2 class="section-title" data-t="supp.title">Keep the Servers Running</h2>
  <p class="section-sub" data-t="supp.sub">Infrastructure costs: VPS, bandwidth, development. Your support directly expands server capacity and keeps SetaLink free.</p>

  <div class="support-grid">
    <div class="support-card">
      <div class="support-tier" data-t="supp.t1.tier">TIER 1</div>
      <div class="support-name" data-t="supp.t1.name">Community Supporter</div>
      <p class="support-desc"   data-t="supp.t1.desc">Help cover server bills. Small contributions go a long way when pooled.</p>
    </div>
    <div class="support-card">
      <div class="support-tier" data-t="supp.t2.tier">TIER 2</div>
      <div class="support-name" data-t="supp.t2.name">Infrastructure Backer</div>
      <p class="support-desc"   data-t="supp.t2.desc">Fund a full VPS slot. Your name in the supporters list, priority support.</p>
    </div>
    <div class="support-card">
      <div class="support-tier" data-t="supp.t3.tier">TIER 3</div>
      <div class="support-name" data-t="supp.t3.name">Network Partner</div>
      <p class="support-desc"   data-t="supp.t3.desc">Sponsor a new server region. Direct input on expansion roadmap.</p>
    </div>
  </div>

  <div style="text-align:center">
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-gold">
      <!-- Telegram icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
      <span data-t="supp.cta">Contact on Telegram</span>
    </a>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     TELEGRAM + GITHUB
════════════════════════════════════════════ -->
<section class="section" id="community">
  <div class="section-label" data-t="comm.label">CONNECT</div>
  <h2 class="section-title" data-t="comm.title">Join the Network</h2>

  <div class="community-row">
    <!-- Telegram -->
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="community-card tg">
      <div class="community-logo tg-logo">
        <!-- Telegram SVG -->
        <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff" aria-hidden="true">
          <path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
        </svg>
      </div>
      <div class="community-info">
        <h3 data-t="comm.tg.h">Join the Community</h3>
        <p data-t="comm.tg.p">Support, updates, referral codes. Real people, no bots.</p>
        <div class="community-handle">@SetaLink3</div>
        <span class="btn btn-sm btn-secondary" style="display:inline-flex;margin-top:4px" data-t="comm.tg.btn">Join Group</span>
      </div>
    </a>

    <!-- GitHub -->
    <a href="https://github.com/setaei" target="_blank" rel="noopener" class="community-card gh">
      <div class="community-logo gh-logo">
        <!-- GitHub SVG -->
        <svg viewBox="0 0 24 24" width="28" height="28" fill="#e8e6f0" aria-hidden="true">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </div>
      <div class="community-info">
        <h3 data-t="comm.gh.h">Open Source</h3>
        <p data-t="comm.gh.p">Review the code, audit our security claims, contribute.</p>
        <div class="community-handle">github.com/setaei</div>
        <span class="btn btn-sm btn-secondary" style="display:inline-flex;margin-top:4px" data-t="comm.gh.btn">View Code</span>
      </div>
    </a>
  </div>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     FAQ (short version)
════════════════════════════════════════════ -->
<section class="section" id="faq">
  <div class="section-label" data-t="faq.label">FAQ</div>
  <h2 class="section-title" data-t="faq.title">Common Questions</h2>

  <div class="faq-list" style="max-width:720px">

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q1">How does the invite system work?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a1">Open the app and find your referral code in the menu. Share it with friends. When they install SetaLink and enter your code, both of you receive 512 MB of additional data. There is no limit to how many people you can invite.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q2">Why does the app sometimes reject a "Connected" state?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a2">SetaLink validates actual internet access, not just a TCP handshake. If the tunnel connects but cannot reach real websites — a sign of partial censorship or a misconfigured server — the app rejects that connection and tries the next profile automatically.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q3">Is my traffic logged or monitored?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a3">No. SetaLink does not log your IP address, browsing activity, connection times, or traffic data. VLESS+Reality encrypts all traffic end-to-end. We cannot see what you do online even if required to.</p>
      </div>
    </div>

    <div class="faq-item">
      <button class="faq-q">
        <span data-t="faq.q4">Why Android only?</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-a">
        <p data-t="faq.a4">Android allows direct APK distribution — no app store approval needed, which means no censorship of the distribution channel itself. iOS requires App Store approval, which can be revoked. Android-first is a security and reliability decision, not a technical limitation.</p>
      </div>
    </div>

  </div>

  <a href="/faq" class="faq-more-link" data-t="faq.more">Read all 10 FAQs</a>
</section>

<div class="divider"></div>

<!-- ════════════════════════════════════════════
     FOOTER
════════════════════════════════════════════ -->
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="footer-logo">
        <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="SetaLink">
        <span>Seta<span style="color:var(--gold)">Link</span> by SETAEI</span>
      </div>
      <div class="footer-tagline" data-t="footer.tagline">AI-powered VPN for censored regions</div>
      <div class="footer-note"    data-t="footer.note">Android only &mdash; APK direct download, no Google Play required.</div>
    </div>
    <div class="footer-links">
      <a href="/download/setalink-latest.apk" data-t="footer.l1">Download</a>
      <a href="/faq"                          data-t="footer.l2">FAQ</a>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" data-t="footer.l3">Telegram</a>
      <a href="https://github.com/setaei" target="_blank" rel="noopener" data-t="footer.l4">GitHub</a>
    </div>
  </div>
  <div class="footer-copy">
    <span data-t="footer.copy">&copy; 2026 SETAEI. All rights reserved.</span>
    <span data-t="footer.built">Built in Norway &amp; Turkey</span>
  </div>
</footer>

<script>
(function () {
  'use strict';

  /* ── TRANSLATIONS ── */
  var STRINGS = {
    en: {
      'nav.lang.label': 'فارسی',
      'nav.download': 'Download APK',

      'hero.badge':  'Server Online — Norway/Turkey nodes',
      'hero.h1':     'Free Internet\n<span class="text-gradient">for Everyone</span>',
      'hero.sub':    'AI-powered VPN built for censored regions. Android-only. No servers needed to start.',
      'hero.cta1':   'Download APK',
      'hero.cta2':   'Join Telegram',
      'hero.status': 'Server Online — Norway/Turkey nodes active',

      'how.label': 'HOW IT WORKS',
      'how.title': 'Three Steps to Free Internet',
      'how.sub':   'No account, no credit card, no configuration. Install and connect.',
      'how.s1.h':  'Get Emergency Access',
      'how.s1.p':  'Install the APK — you instantly receive a 1 GB starter pack. No account, no login, no credit card. Open the app, tap Connect.',
      'how.s2.h':  'Invite & Grow',
      'how.s2.p':  'Share your referral code with friends. Each person who joins adds 512 MB to both of you. The more you share, the more you get.',
      'how.s3.h':  'AI Picks Best Route',
      'how.s3.p':  'The AI optimizer tests Reality, XHTTP, and WebSocket on every connection. It picks the fastest protocol that actually reaches the internet from your location.',

      'ai.label': 'INTELLIGENT ROUTING',
      'ai.title': 'Not Just a Tunnel',
      'ai.sub':   'SetaLink actively validates your connection and picks the best path — every single time.',
      'ai.f1.h':  'AI Protocol Optimizer',
      'ai.f1.p':  'Tests Reality, XHTTP, and WebSocket in parallel. Picks the fastest working protocol for your current network.',
      'ai.f2.h':  'Real Internet Validation',
      'ai.f2.p':  'TCP-connected is not enough. The app verifies real data is received before declaring you connected. No fake connected states.',
      'ai.f3.h':  'Adaptive Routing',
      'ai.f3.p':  'Learns which SNIs work from your region. Turkey and Iran have different blocking patterns — the app adapts.',
      'ai.f4.h':  'Remote Config',
      'ai.f4.p':  'Admin can push protocol priority updates without requiring an app update. Routing rules update automatically.',

      'why.label':   'WHY SETALINK',
      'why.title':   'Built for Real Censorship',
      'why.sub':     'Not another generic VPN. Built from scratch for the realities of Iran and Turkey.',
      'why.tech.label': 'TECHNICAL EXCELLENCE',
      'why.tech.1':  'VLESS + Reality — the most censorship-resistant protocol available',
      'why.tech.2':  'XHTTP and WebSocket fallback transports via nginx edge',
      'why.tech.3':  'No logs, no account registration required to get started',
      'why.tech.4':  'Open to community review — no black-box security claims',
      'why.comm.label': 'COMMUNITY MODEL',
      'why.comm.1':  'The more users join, the lower the infrastructure cost per user',
      'why.comm.2':  'Referral bonuses for both inviter and invitee — growth benefits everyone',
      'why.comm.3':  'Community-backed growth model — not a VC-funded black box',
      'why.comm.4':  'Future: user-funded server expansion — vote on new regions',

      'banner.q': '“As the network grows, infrastructure cost per user decreases.”',
      'banner.s': 'Every new user makes the network stronger and cheaper for everyone.',

      'pricing.label': 'ACCESS TIERS',
      'pricing.title': 'Start Free. Grow Together.',
      'pricing.sub':   '1 GB on install, more via referrals, unlimited coming soon.',

      'plan.free.eyebrow': 'FREE EMERGENCY',
      'plan.free.title':   'Starter Pack',
      'plan.free.desc':    'Auto-activated on install. No account, no login, no credit card.',
      'plan.free.f1':      '1 GB starter quota',
      'plan.free.f2':      'Auto-activated on install',
      'plan.free.f3':      'AI protocol selection',
      'plan.free.f4':      'No account needed',
      'plan.free.cta':     'Download APK',

      'plan.comm.eyebrow': 'INVITE-BASED',
      'plan.comm.title':   'Community',
      'plan.comm.desc':    'Share your referral link. Every friend adds data for both of you.',
      'plan.comm.f1':      '+512 MB per friend invited',
      'plan.comm.f2':      'Shared infrastructure benefits',
      'plan.comm.f3':      'Priority protocol access',
      'plan.comm.f4':      'Growing with the network',
      'plan.comm.cta':     'Get Invite Link',

      'plan.prem.eyebrow': 'COMING SOON',
      'plan.prem.title':   'Premium',
      'plan.prem.desc':    'Unlimited data, priority nodes, dedicated support.',
      'plan.prem.f1':      'Unlimited data',
      'plan.prem.f2':      'Priority nodes',
      'plan.prem.f3':      'Dedicated support',
      'plan.prem.f4':      'Early access features',
      'plan.prem.cta':     'Join Waitlist',

      'setaei.label':    'THE MAKER',
      'setaei.title':    'Built by SETAEI',
      'setaei.subtitle': 'Independent AI + Infrastructure Initiative',
      'setaei.desc':     'SETAEI is an independent technology initiative focused on resilient connectivity and privacy-first infrastructure. Built across Norway and Turkey, SetaLink is our first public project — a real VPN for real censorship.',
      'setaei.chip1':    'Norway/Turkey Operations',
      'setaei.chip2':    'AI-Driven',
      'setaei.chip3':    'Privacy-First',

      'supp.label': 'SUPPORT THE NETWORK',
      'supp.title': 'Keep the Servers Running',
      'supp.sub':   'Infrastructure costs: VPS, bandwidth, development. Your support directly expands server capacity.',
      'supp.t1.tier': 'TIER 1',
      'supp.t1.name': 'Community Supporter',
      'supp.t1.desc': 'Help cover server bills. Small contributions go a long way when pooled.',
      'supp.t2.tier': 'TIER 2',
      'supp.t2.name': 'Infrastructure Backer',
      'supp.t2.desc': 'Fund a full VPS slot. Your name in the supporters list, priority support.',
      'supp.t3.tier': 'TIER 3',
      'supp.t3.name': 'Network Partner',
      'supp.t3.desc': 'Sponsor a new server region. Direct input on expansion roadmap.',
      'supp.cta':     'Contact on Telegram',

      'comm.label': 'CONNECT',
      'comm.title': 'Join the Network',
      'comm.tg.h':  'Join the Community',
      'comm.tg.p':  'Support, updates, referral codes. Real people, no bots.',
      'comm.tg.btn':'Join Group',
      'comm.gh.h':  'Open Source',
      'comm.gh.p':  'Review the code, audit our security claims, contribute.',
      'comm.gh.btn':'View Code',

      'faq.label': 'FAQ',
      'faq.title': 'Common Questions',
      'faq.q1':    'How does the invite system work?',
      'faq.a1':    'Open the app and find your referral code in the menu. Share it with friends. When they install SetaLink and enter your code, both of you receive 512 MB of additional data. There is no limit to how many people you can invite.',
      'faq.q2':    'Why does the app sometimes reject a "Connected" state?',
      'faq.a2':    'SetaLink validates actual internet access, not just a TCP handshake. If the tunnel connects but cannot reach real websites, the app rejects that connection and tries the next profile automatically.',
      'faq.q3':    'Is my traffic logged or monitored?',
      'faq.a3':    'No. SetaLink does not log your IP address, browsing activity, connection times, or traffic data. VLESS+Reality encrypts all traffic end-to-end.',
      'faq.q4':    'Why Android only?',
      'faq.a4':    'Android allows direct APK distribution — no app store approval, no censorship of the distribution channel. iOS App Store approval can be revoked at any time. Android-first is a deliberate reliability decision.',
      'faq.more':  'Read all 10 FAQs',

      'footer.tagline': 'AI-powered VPN for censored regions',
      'footer.note':    'Android only — APK direct download, no Google Play required.',
      'footer.l1':      'Download',
      'footer.l2':      'FAQ',
      'footer.l3':      'Telegram',
      'footer.l4':      'GitHub',
      'footer.copy':    '© 2026 SETAEI. All rights reserved.',
      'footer.built':   'Built in Norway & Turkey',
    },

    fa: {
      'nav.lang.label': 'English',
      'nav.download': 'دانلود APK',

      'hero.badge':  'سرور فعال — نروژ و ترکیه',
      'hero.sub':    'VPN هوشمند برای مناطق سانسور شده. فقط اندروید.',
      'hero.cta1':   'دانلود APK',
      'hero.cta2':   'پیوستن به تلگرام',
      'hero.status': 'سرور فعال — نودهای نروژ و ترکیه',

      'how.label': 'نحوه کار',
      'how.title': 'سه قدم تا اینترنت آزاد',
      'how.sub':   'بدون حساب کاربری، بدون کارت بانکی، بدون تنظیمات.',
      'how.s1.h':  'دسترسی اضطراری',
      'how.s1.p':  'نصب APK — فوری یک بسته ۱ گیگابایتی دریافت میکنید. بدون حساب.',
      'how.s2.h':  'دعوت و رشد',
      'how.s2.p':  'کد معرف خود را با دوستان به اشتراک بگذارید. هر نفر ۵۱۲ مگابایت به هر دو اضافه میکند.',
      'how.s3.h':  'هوش مصنوعی بهترین مسیر را مییابد',
      'how.s3.p':  'بهینهساز هوش مصنوعی Reality، XHTTP و WebSocket را بررسی میکند و سریعترین پروتکل را انتخاب میکند.',

      'ai.label': 'مسیریابی هوشمند',
      'ai.title': 'فقط یک تونل نیست',
      'ai.sub':   'ستالینک اتصال شما را بهطور فعال اعتبارسنجی میکند.',
      'ai.f1.h':  'بهینهساز پروتکل هوش مصنوعی',
      'ai.f1.p':  'Reality، XHTTP و WebSocket را موازی آزمایش میکند و سریعترین را انتخاب میکند.',
      'ai.f2.h':  'اعتبارسنجی اینترنت واقعی',
      'ai.f2.p':  'اتصال TCP کافی نیست. برنامه داده واقعی را تایید میکند قبل اعلام اتصال.',
      'ai.f3.h':  'مسیریابی انطباقی',
      'ai.f3.p':  'یاد میگیرد کدام SNIها از منطقه شما کار میکنند.',
      'ai.f4.h':  'پیکربندی راه دور',
      'ai.f4.p':  'مدیر میتواند بدون بهروزرسانی اپ، اولویت پروتکل را بهروز کند.',

      'why.label':   'چرا ستالینک',
      'why.title':   'ساخته شده برای سانسور واقعی',
      'why.sub':     'نه یک VPN عادی دیگر. از صفر برای ایران و ترکیه ساخته شده.',
      'why.tech.label': 'برتری فنی',
      'why.tech.1':  'VLESS + Reality — مقاومترین پروتکل موجود در برابر سانسور',
      'why.tech.2':  'ترانسپورتهای جایگزین XHTTP و WebSocket',
      'why.tech.3':  'بدون لاگ، بدون ثبت‌نام',
      'why.tech.4':  'قابل بررسی توسط جامعه',
      'why.comm.label': 'مدل جامعه',
      'why.comm.1':  'هرچه کاربران بیشتر، هزینه زیرساخت کمتر',
      'why.comm.2':  'پاداش معرفی برای دعوتکننده و دعوتشونده',
      'why.comm.3':  'مدل رشد مبتنی بر جامعه',
      'why.comm.4':  'آینده: گسترش سرور توسط کاربران',

      'banner.q': '«هرچه شبکه بزرگتر شود، هزینه زیرساخت به ازای هر کاربر کاهش مییابد.»',
      'banner.s': 'هر کاربر جدید شبکه را قویتر و ارزانتر میکند.',

      'pricing.label': 'سطح دسترسی',
      'pricing.title': 'رایگان شروع کنید.',
      'pricing.sub':   '۱ گیگابایت با نصب، بیشتر با دعوت.',

      'plan.free.eyebrow': 'اضطراری رایگان',
      'plan.free.title':   'بسته استارتر',
      'plan.free.desc':    'با نصب فعال میشود. بدون حساب.',
      'plan.free.f1':      '۱ گیگابایت سهمیه',
      'plan.free.f2':      'فعالسازی خودکار',
      'plan.free.f3':      'انتخاب پروتکل هوشمند',
      'plan.free.f4':      'بدون حساب کاربری',
      'plan.free.cta':     'دانلود APK',

      'plan.comm.eyebrow': 'مبتنی بر دعوت',
      'plan.comm.title':   'جامعه',
      'plan.comm.desc':    'لینک معرفی خود را به اشتراک بگذارید.',
      'plan.comm.f1':      '۵۱۲ مگابایت به ازای هر دوست',
      'plan.comm.f2':      'سود زیرساخت مشترک',
      'plan.comm.f3':      'دسترسی اولویته به پروتکل',
      'plan.comm.f4':      'رشد با شبکه',
      'plan.comm.cta':     'دریافت لینک دعوت',

      'plan.prem.eyebrow': 'به زودی',
      'plan.prem.title':   'پریمیوم',
      'plan.prem.desc':    'داده نامحدود، نودهای اولویتی، پشتیبانی اختصاصی.',
      'plan.prem.f1':      'داده نامحدود',
      'plan.prem.f2':      'نودهای اولویتی',
      'plan.prem.f3':      'پشتیبانی اختصاصی',
      'plan.prem.f4':      'دسترسی زودهنگام',
      'plan.prem.cta':     'پیوستن به لیست انتظار',

      'setaei.label':    'سازنده',
      'setaei.title':    'ساخته شده توسط SETAEI',
      'setaei.subtitle': 'ابتکار مستقل هوش مصنوعی + زیرساخت',
      'setaei.desc':     'SETAEI یک ابتکار فناوری مستقل است. ستالینک اولین پروژه عمومی ماست — یک VPN واقعی برای سانسور واقعی.',
      'setaei.chip1':    'نروژ / ترکیه',
      'setaei.chip2':    'مبتنی بر AI',
      'setaei.chip3':    'حریم خصوصی اول',

      'supp.label': 'حمایت شبکه',
      'supp.title': 'سرورها را فعال نگه دارید',
      'supp.sub':   'هزینه زیرساخت: VPS، پهنای باند، توسعه. حمایت شما مستقیماً ظرفیت سرور را افزایش میدهد.',
      'supp.t1.tier': 'سطح ۱',
      'supp.t1.name': 'حامی جامعه',
      'supp.t1.desc': 'کمک به پوشش هزینه سرورها.',
      'supp.t2.tier': 'سطح ۲',
      'supp.t2.name': 'حامی زیرساخت',
      'supp.t2.desc': 'تامین یک VPS کامل. نام شما در لیست حامیان.',
      'supp.t3.tier': 'سطح ۳',
      'supp.t3.name': 'شریک شبکه',
      'supp.t3.desc': 'اسپانسر یک منطقه سرور جدید.',
      'supp.cta':     'تماس در تلگرام',

      'comm.label': 'ارتباط',
      'comm.title': 'به شبکه بپیوندید',
      'comm.tg.h':  'پیوستن به جامعه',
      'comm.tg.p':  'پشتیبانی، بهروزرسانی، کدهای معرفی. افراد واقعی، بدون ربات.',
      'comm.tg.btn':'پیوستن به گروه',
      'comm.gh.h':  'متن باز',
      'comm.gh.p':  'بررسی کد، ممیزی ادعاهای امنیتی، مشارکت.',
      'comm.gh.btn':'مشاهده کد',

      'faq.label': 'سوالات متداول',
      'faq.title': 'سوالات رایج',
      'faq.q1':    'سیستم دعوت چطور کار میکند؟',
      'faq.a1':    'در منوی اپ، کد معرفی خود را پیدا کنید. با دوستان به اشتراک بگذارید. هر نفر ۵۱۲ مگابایت به هر دو اضافه میکند.',
      'faq.q2':    'چرا اپ گاهی وضعیت Connected را رد میکند؟',
      'faq.a2':    'ستالینک دسترسی واقعی به اینترنت را تایید میکند. اگر تونل وصل شود ولی به سایت واقعی نرسد، اتصال رد میشود.',
      'faq.q3':    'آیا ترافیک من لاگ یا نظارت میشود؟',
      'faq.a3':    'خیر. آدرس IP، فعالیت مروری، یا دادههای ترافیک لاگ نمیشود. VLESS+Reality همه ترافیک را رمزنگاری میکند.',
      'faq.q4':    'چرا فقط اندروید؟',
      'faq.a4':    'اندروید اجازه توزیع مستقیم APK را میدهد. یعنی هیچ تایید فروشگاه اپ نیاز نیست و کانال توزیع هم سانسور نمیشود.',
      'faq.more':  'مشاهده همه ۱۰ سوال متداول',

      'footer.tagline': 'VPN هوشمند برای مناطق سانسور شده',
      'footer.note':    'فقط اندروید — دانلود مستقیم APK، بدون گوگل پلی.',
      'footer.l1':      'دانلود',
      'footer.l2':      'سوالات',
      'footer.l3':      'تلگرام',
      'footer.l4':      'گیتهاب',
      'footer.copy':    '© ۲۰۲۶ SETAEI. حقوق محفوظ است.',
      'footer.built':   'ساخته شده در نروژ و ترکیه',
    }
  };

  var lang = localStorage.getItem('sl-lang') || 'en';

  function applyLang(l) {
    lang = l;
    localStorage.setItem('sl-lang', l);
    document.documentElement.setAttribute('lang', l);
    document.body.setAttribute('dir', l === 'fa' ? 'rtl' : 'ltr');
    var s = STRINGS[l];
    document.querySelectorAll('[data-t]').forEach(function(el) {
      var key = el.dataset.t;
      if (s[key] !== undefined) el.textContent = s[key];
    });
  }

  function initLangToggle() {
    var btn = document.getElementById('btn-lang');
    if (!btn) return;
    btn.addEventListener('click', function() { applyLang(lang === 'en' ? 'fa' : 'en'); });
  }

  function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(function(item) {
      var btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function(o) { o.classList.remove('open'); });
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    initLangToggle();
    initFAQ();
    applyLang(lang);
  });
})();
</script>
</body>
</html>
