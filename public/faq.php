<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · FAQ &amp; Help</title>
  <meta name="description" content="SetaLink FAQ — How the invite system works, protocols, privacy, remote config, Iran vs Turkey routing, and the full roadmap.">
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
    <span>Seta<span class="brand-link">Link</span></span>
  </a>
  <div class="nav-actions">
    <!-- Lion & Sun Flag language toggle -->
    <button class="btn-lang" id="btn-lang" aria-label="Toggle language">
      <svg viewBox="0 0 30 20" width="30" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="30" height="6.67" fill="#239F23"/>
        <rect y="6.67" width="30" height="6.67" fill="#F5F0E8"/>
        <rect y="13.33" width="30" height="6.67" fill="#C8102E"/>
        <line x1="15" y1="5.5"  x2="15" y2="3.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="15" y1="14.5" x2="15" y2="16.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="9.5"  y1="10" x2="7.5"  y2="10" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="20.5" y1="10" x2="22.5" y2="10" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="11.2" y1="6.8"  x2="9.8"  y2="5.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="18.8" y1="6.8"  x2="20.2" y2="5.5"  stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="11.2" y1="13.2" x2="9.8"  y2="14.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <line x1="18.8" y1="13.2" x2="20.2" y2="14.5" stroke="#C9A42A" stroke-width=".7" stroke-linecap="round"/>
        <ellipse cx="15" cy="10.5" rx="3.2" ry="2.2" fill="#C9A42A" opacity=".92"/>
        <circle cx="17.2" cy="8.8" r="1.9" fill="#C9A42A" opacity=".92"/>
        <circle cx="15" cy="10.5" r="0" fill="none"/>
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
     PAGE HEADER
════════════════════════════════════════════ -->
<div class="page-header">
  <div class="eyebrow" data-t="faq.eyebrow">FAQ &amp; HELP</div>
  <h1 data-t="faq.h1">How does SetaLink work?</h1>
  <p data-t="faq.h1sub">Everything about the invite system, protocols, privacy, and the technical details behind the app.</p>
</div>

<!-- ════════════════════════════════════════════
     FAQ CONTENT
════════════════════════════════════════════ -->
<div class="faq-page-wrap">

  <!-- ── Getting Started ── -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.start">Getting Started</div>
    <div class="faq-list">

      <!-- Q1 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q1">How does the invite/referral system work?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a1">After installing SetaLink, open the app and navigate to the menu — you will find your unique referral code. Share this code with anyone. When a new user installs the app and enters your code during onboarding, both of you receive 512 MB of additional data. There is no limit to how many people you can invite. The more you share, the larger your combined data pool grows — and this also benefits the overall network by reducing per-user infrastructure cost.</p>
        </div>
      </div>

      <!-- Q2 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q2">What is the emergency starter package?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a2">Every new SetaLink installation automatically receives 1 GB of data — no account, no login, no credit card required. This is the emergency starter package. It is designed so that anyone who urgently needs internet access during censorship events can install the APK and connect immediately. The quota is tied to the device, not a user account. You can grow beyond 1 GB by inviting friends or contacting us on Telegram.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Connection & Protocols ── -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.conn">Connection &amp; Protocols</div>
    <div class="faq-list">

      <!-- Q3 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q3">Why does my connection sometimes fail even though it says "Connected"?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a3">SetaLink enforces a strict validation policy: a TCP handshake alone is never accepted as a successful connection. After connecting, the app sends an actual HTTP or HTTPS request to a known endpoint and checks that real data is returned. This is a deliberate design choice — in heavily censored environments, it is common for a connection to succeed at the TCP level but fail at the application level, giving users a false sense of security. If the app rejects a connection, it automatically moves on to the next server profile. If all profiles fail, it reports a clear error rather than pretending you are online.</p>
        </div>
      </div>

      <!-- Q4 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q4">Is my traffic logged or monitored?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a4">No. SetaLink does not store IP addresses, connection timestamps, session durations, traffic volumes, or browsing data. The VPN tunnel uses VLESS with the Reality transport layer — traffic is encrypted end-to-end using TLS 1.3 with perfect forward secrecy. Even if our servers were seized, there would be no connection logs to hand over. The only data associated with a device is its anonymous device ID and remaining quota. No Telegram username, no email, no personal identifier is required.</p>
        </div>
      </div>

      <!-- Q5 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q5">Why does the app use multiple protocols (Reality, XHTTP, WebSocket)?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a5">Different censorship systems block different things. Reality disguises VPN traffic as normal HTTPS traffic by impersonating real websites at the TLS fingerprint level — it is the hardest to detect but requires direct TCP access. XHTTP runs over HTTP/2, making it useful when deep packet inspection is active. WebSocket over TLS is widely compatible and works through many corporate and ISP proxies. Having all three means the app can fall back intelligently: if one is blocked, another is tried automatically. This layered approach is the reason SetaLink maintains connectivity in environments where single-protocol VPNs fail.</p>
        </div>
      </div>

      <!-- Q6 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q6">What is the AI Protocol Optimizer?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a6">Before establishing a final connection, the app tests multiple protocol and server combinations in parallel using a lightweight probe. Each probe checks not only whether a TCP connection can be made, but also whether actual internet data is returned (see question 3). The combination that returns valid data fastest wins. The result is that you always connect via the fastest working path for your current network, your location, and your ISP — without any manual configuration. This decision logic runs on every new connection, not just once at install time.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Technical & Platform ── -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.tech">Technical &amp; Platform</div>
    <div class="faq-list">

      <!-- Q7 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q7">Why is SetaLink Android-only?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a7">Android allows direct APK distribution outside of the Play Store. This means the SetaLink app can be downloaded from our website or shared over Telegram without passing through a corporate app store gatekeeper that can remove or block the app. iOS requires App Store submission and Apple can revoke distribution at any time — a single regulatory complaint can make the app disappear for millions of users overnight. Android-first is a deliberate resilience decision: it keeps the distribution channel itself free from censorship. A direct APK download link cannot be "removed from the store."</p>
        </div>
      </div>

      <!-- Q8 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q8">What is Remote Config and how does it work?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a8">Remote Config is a server-side mechanism that allows the SetaLink admin to update protocol priority rules, server lists, SNI domains, and routing weights without requiring users to update the app. When censorship patterns change — for example, if a specific SNI gets blocked or a new protocol becomes available — the server pushes an updated config that the app downloads on next launch or connection attempt. This means your app stays effective even as censorship evolves, without waiting for a new APK release to be distributed.</p>
        </div>
      </div>

      <!-- Q9 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q9">How does SetaLink work differently in Turkey vs. Iran?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a9">Turkey and Iran use fundamentally different censorship approaches. Iran's system blocks at the IP and SNI level — certain server IP ranges and domain names are blocked entirely, so the app must use SNIs that are not on the blocklist (for example, impersonating domains that Iranian authorities allow). Turkey's system tends to rely more on DNS-based blocking, making SNI filtering less comprehensive, but it blocks specific ports more aggressively. SetaLink's adaptive routing learns which configuration works from which region and prioritises accordingly via Remote Config. Nodes in Norway serve Iran-optimised routing, while Turkey-region nodes use different SNI and port priorities.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Roadmap ── -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.road">Roadmap</div>
    <div class="faq-list">

      <!-- Q10 -->
      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.q10">What is the future roadmap?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.a10">SetaLink is actively developed. The immediate priorities are: (1) expanding server capacity in Norway and Turkey as the user base grows, (2) launching the Premium tier with unlimited data and priority routing, (3) building a community funding model so users can co-fund new server regions. Longer-term plans include: adding more geographic nodes based on demand, an optional account system for multi-device sync, and publishing the protocol selection and validation logic as open source so the community can audit and contribute. All updates are announced on the Telegram group at @SetaLink3.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Contact Strip ── -->
  <div class="contact-strip">
    <h2 data-t="faq.help.h">Still have questions?</h2>
    <p data-t="faq.help.p">We answer every message. Real people, no bots — usually within a few hours.</p>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-primary">
      <!-- Telegram icon -->
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
      <span data-t="faq.help.cta">Message on Telegram</span>
    </a>
  </div>

</div><!-- /faq-page-wrap -->

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

  var STRINGS = {
    en: {
      'nav.lang.label': 'فارسی',
      'nav.download':   'Download APK',

      'faq.eyebrow': 'FAQ & HELP',
      'faq.h1':      'How does SetaLink work?',
      'faq.h1sub':   'Everything about the invite system, protocols, privacy, and the technical details behind the app.',

      'faq.cat.start': 'Getting Started',
      'faq.q1': 'How does the invite/referral system work?',
      'faq.a1': 'After installing SetaLink, open the app and navigate to the menu — you will find your unique referral code. Share this code with anyone. When a new user installs the app and enters your code, both of you receive 512 MB of additional data. There is no limit to how many people you can invite.',
      'faq.q2': 'What is the emergency starter package?',
      'faq.a2': 'Every new SetaLink installation automatically receives 1 GB of data — no account, no login, no credit card required. It is designed so that anyone who urgently needs internet access can install the APK and connect immediately.',

      'faq.cat.conn': 'Connection & Protocols',
      'faq.q3': 'Why does my connection sometimes fail even though it says "Connected"?',
      'faq.a3': 'SetaLink validates actual internet access, not just a TCP handshake. After connecting, the app sends an HTTP or HTTPS request and checks that real data is returned. If the tunnel connects but fails at the application level, the app rejects it and tries the next server profile automatically.',
      'faq.q4': 'Is my traffic logged or monitored?',
      'faq.a4': 'No. SetaLink does not store IP addresses, connection timestamps, session durations, or browsing data. Traffic is encrypted end-to-end with VLESS+Reality using TLS 1.3. No personal identifier is required.',
      'faq.q5': 'Why does the app use multiple protocols (Reality, XHTTP, WebSocket)?',
      'faq.a5': 'Different censorship systems block different things. Reality disguises VPN traffic as normal HTTPS at the TLS fingerprint level. XHTTP runs over HTTP/2. WebSocket over TLS is widely compatible. Having all three lets the app fall back intelligently when one is blocked.',
      'faq.q6': 'What is the AI Protocol Optimizer?',
      'faq.a6': 'Before connecting, the app tests multiple protocol and server combinations in parallel. Each probe checks whether real internet data is returned. The fastest working combination wins. This runs on every new connection — not just once at install.',

      'faq.cat.tech': 'Technical & Platform',
      'faq.q7': 'Why is SetaLink Android-only?',
      'faq.a7': 'Android allows direct APK distribution without a corporate gatekeeper. iOS App Store approval can be revoked by Apple at any time. Android-first keeps the distribution channel itself free from censorship — a direct APK download link cannot be removed from a store.',
      'faq.q8': 'What is Remote Config and how does it work?',
      'faq.a8': 'Remote Config lets the admin update protocol priorities, server lists, SNI domains, and routing weights without requiring an app update. When censorship patterns change, the server pushes an updated config the app downloads automatically.',
      'faq.q9': 'How does SetaLink work differently in Turkey vs. Iran?',
      'faq.a9': 'Iran blocks at the IP and SNI level — certain domains and IP ranges are blocked entirely. Turkey relies more on DNS-based blocking with aggressive port filtering. SetaLink\'s adaptive routing learns which configuration works per region and prioritises accordingly via Remote Config. Norway nodes use Iran-optimised routing; Turkey nodes use different SNI and port priorities.',

      'faq.cat.road': 'Roadmap',
      'faq.q10': 'What is the future roadmap?',
      'faq.a10': 'Immediate priorities: expand server capacity in Norway and Turkey, launch the Premium unlimited-data tier, and build a community funding model for new regions. Longer-term: additional geographic nodes, optional account system for multi-device sync, and open-sourcing the protocol selection and validation logic. All updates at @SetaLink3.',

      'faq.help.h':   'Still have questions?',
      'faq.help.p':   'We answer every message. Real people, no bots — usually within a few hours.',
      'faq.help.cta': 'Message on Telegram',

      'footer.tagline': 'AI-powered VPN for censored regions',
      'footer.note':    'Android only — APK direct download, no Google Play required.',
      'footer.l1': 'Download',
      'footer.l2': 'FAQ',
      'footer.l3': 'Telegram',
      'footer.l4': 'GitHub',
      'footer.copy':  '© 2026 SETAEI. All rights reserved.',
      'footer.built': 'Built in Norway & Turkey',
    },

    fa: {
      'nav.lang.label': 'English',
      'nav.download':   'دانلود APK',

      'faq.eyebrow': 'سوالات متداول',
      'faq.h1':      'ستالینک چطور کار میکند؟',
      'faq.h1sub':   'همه چیز درباره سیستم دعوت، پروتکلها، حریم خصوصی و جزئیات فنی برنامه.',

      'faq.cat.start': 'شروع کار',
      'faq.q1': 'سیستم دعوت چطور کار میکند؟',
      'faq.a1': 'بعد از نصب ستالینک، منوی برنامه را باز کنید — کد معرف منحصربهفرد شما آنجاست. آن را با هر کسی به اشتراک بگذارید. وقتی کاربر جدیدی کد شما را وارد میکند، هر دو ۵۱۲ مگابایت دریافت میکنید. محدودیتی در تعداد دعوتها وجود ندارد.',
      'faq.q2': 'بسته اضطراری رایگان چیست؟',
      'faq.a2': 'هر نصب جدید ستالینک بهطور خودکار ۱ گیگابایت داده دریافت میکند — بدون حساب، بدون ورود، بدون کارت بانکی. برای کسانی طراحی شده که فوری به اینترنت نیاز دارند.',

      'faq.cat.conn': 'اتصال و پروتکلها',
      'faq.q3': 'چرا اتصال گاهی حتی با نمایش "Connected" رد میشود؟',
      'faq.a3': 'ستالینک دسترسی واقعی به اینترنت را اعتبارسنجی میکند. اگر تونل وصل شود ولی درخواست HTTP نتواند داده واقعی برگرداند، اتصال رد شده و پروفایل بعدی امتحان میشود.',
      'faq.q4': 'آیا ترافیک من لاگ یا نظارت میشود؟',
      'faq.a4': 'خیر. آدرس IP، زمان اتصال، مدت جلسه یا دادههای مروری ذخیره نمیشوند. ترافیک توسط VLESS+Reality با TLS 1.3 رمزنگاری میشود. هیچ شناسه شخصی نیاز نیست.',
      'faq.q5': 'چرا برنامه از چند پروتکل استفاده میکند؟',
      'faq.a5': 'سیستمهای سانسور چیزهای مختلف را مسدود میکنند. Reality ترافیک VPN را از HTTPS معمولی غیرقابل تشخیص میکند. XHTTP روی HTTP/2 کار میکند. WebSocket سازگاری گسترده دارد. داشتن هر سه امکان fallback هوشمند را فراهم میکند.',
      'faq.q6': 'بهینهساز پروتکل هوش مصنوعی چیست؟',
      'faq.a6': 'قبل از اتصال، برنامه ترکیبهای مختلف پروتکل و سرور را بهصورت موازی آزمایش میکند. سریعترین ترکیبی که داده واقعی برمیگرداند برنده میشود. این فرآیند در هر اتصال جدید اجرا میشود.',

      'faq.cat.tech': 'فنی و پلتفرم',
      'faq.q7': 'چرا فقط اندروید؟',
      'faq.a7': 'اندروید توزیع مستقیم APK را بدون فروشگاه مجاز میکند. تاییدیه App Store اپل میتواند هر لحظه لغو شود. اندروید-اول یعنی کانال توزیع خودش از سانسور آزاد است.',
      'faq.q8': 'Remote Config چیست و چطور کار میکند؟',
      'faq.a8': 'Remote Config به مدیر اجازه میدهد اولویتهای پروتکل، لیست سرورها و SNIها را بدون بهروزرسانی اپ تغییر دهد. وقتی الگوهای سانسور تغییر میکنند، کانفیگ جدید بهطور خودکار دانلود میشود.',
      'faq.q9': 'ستالینک در ترکیه و ایران چه تفاوتی دارد؟',
      'faq.a9': 'ایران در سطح IP و SNI مسدود میکند. ترکیه بیشتر از مسدودسازی DNS و فیلتر پورت استفاده میکند. مسیریابی انطباقی ستالینک از طریق Remote Config بهینهسازی منطقهای را انجام میدهد.',

      'faq.cat.road': 'نقشه راه',
      'faq.q10': 'نقشه راه آینده چیست؟',
      'faq.a10': 'اولویتهای فوری: گسترش ظرفیت سرور، راهاندازی تیر پریمیوم نامحدود، مدل تامین مالی جامعه. بلندمدت: نودهای جغرافیایی بیشتر، سیستم حساب اختیاری، و متن باز کردن منطق انتخاب پروتکل.',

      'faq.help.h':   'هنوز سوال دارید؟',
      'faq.help.p':   'هر پیامی را پاسخ میدهیم. افراد واقعی، بدون ربات — معمولاً ظرف چند ساعت.',
      'faq.help.cta': 'پیام در تلگرام',

      'footer.tagline': 'VPN هوشمند برای مناطق سانسور شده',
      'footer.note':    'فقط اندروید — دانلود مستقیم APK، بدون گوگل پلی.',
      'footer.l1': 'دانلود',
      'footer.l2': 'سوالات',
      'footer.l3': 'تلگرام',
      'footer.l4': 'گیتهاب',
      'footer.copy':  '© ۲۰۲۶ SETAEI. حقوق محفوظ است.',
      'footer.built': 'ساخته شده در نروژ و ترکیه',
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
