<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SetaLink · Help & FAQ</title>
  <meta name="description" content="SetaLink FAQ and help guide. How to get the app, which protocol to use, troubleshooting, privacy policy and more.">
  <meta name="robots" content="noindex,nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/main.css">
  <style>
    .page-header{padding:80px 0 48px;text-align:center}
    .page-header .eyebrow{font-size:.75rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
    .page-header h1{font-size:2.5rem;font-weight:800;line-height:1.15;margin-bottom:16px}
    .page-header p{color:var(--text2);font-size:1rem;max-width:520px;margin:0 auto;line-height:1.7}

    .faq-page{max-width:760px;margin:0 auto;padding:0 24px 80px}

    .faq-category{margin-bottom:56px}
    .faq-cat-title{font-size:1rem;font-weight:700;color:var(--accent);letter-spacing:.5px;text-transform:uppercase;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)}

    /* help card for troubleshooting steps */
    .help-steps{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;margin-top:12px;display:none}
    .faq-item.open .help-steps{display:block}
    .help-step{display:flex;gap:14px;margin-bottom:16px}
    .help-step:last-child{margin-bottom:0}
    .help-step-num{width:26px;height:26px;border-radius:50%;background:rgba(0,232,122,.12);border:1px solid rgba(0,232,122,.3);color:var(--accent);font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
    .help-step-body h4{font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:4px}
    .help-step-body p{font-size:.85rem;color:var(--text2);line-height:1.6}

    .contact-strip{background:linear-gradient(135deg,rgba(0,232,122,.06),rgba(51,153,255,.06));border:1px solid rgba(0,232,122,.2);border-radius:20px;padding:40px;text-align:center;margin-top:48px}
    .contact-strip h2{font-size:1.5rem;font-weight:800;margin-bottom:12px}
    .contact-strip p{color:var(--text2);margin-bottom:24px;font-size:.95rem}
    .contact-strip .btn{display:inline-flex;align-items:center;gap:8px}
  </style>
</head>
<body dir="ltr">

<!-- ── NAV ── -->
<nav class="nav">
  <div class="nav-logo">
    <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px;color:inherit">
      <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="28" height="28" rx="7" fill="#00e87a" opacity=".15"/>
        <path d="M14 5C9.03 5 5 9.03 5 14s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" stroke="#00e87a" stroke-width="1.6" fill="none"/>
        <path d="M10 14c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z" fill="#00e87a"/>
        <path d="M14 5v4M14 19v4M5 14h4M19 14h4" stroke="#00e87a" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      Seta<span class="dot">Link</span>
    </a>
  </div>
  <div class="nav-actions">
    <button class="btn-lang" id="btn-lang" data-t="nav.lang">فارسی</button>
  </div>
</nav>

<!-- ── PAGE HEADER ── -->
<div class="page-header">
  <div class="eyebrow" data-t="faq.eyebrow">Help & FAQ</div>
  <h1 data-t="faq.h1">How can we help?</h1>
  <p data-t="faq.h1sub">Everything you need to know about SetaLink — getting started, troubleshooting, privacy, and more.</p>
</div>

<!-- ── FAQ CONTENT ── -->
<div class="faq-page">

  <!-- Getting Started -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.start">Getting Started</div>
    <div class="faq-list">

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.start.q1">How do I get the SetaLink app?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.start.a1">Message us on Telegram at @SetaLink3. We'll send you the Android APK file and create your account. iOS support is coming in Q3 2026. Once the app stores are live, you'll be able to download directly.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.start.q2">What do I need to run the app?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.start.a2">Android 8.0 (API 26) or higher. The app requires VPN permission — which it will ask for on first connect. No root access needed. File size is around 40 MB.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.start.q3">How do I install an APK from Telegram?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.start.a3">1. Download the APK from our Telegram message. 2. Open your phone's Settings → Security → allow "Install unknown apps" for your file manager or browser. 3. Open the downloaded APK file and tap Install. 4. Open SetaLink, log in, and tap Connect.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.start.q4">Is it free?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.start.a4">Yes — a free tier with 10 GB/month is available. Premium plans ($3/month) offer unlimited data and more server locations. Contact us on Telegram to get started.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Connection & Protocols -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.conn">Connection & Protocols</div>
    <div class="faq-list">

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.conn.q1">Which protocol should I use?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.conn.a1">The app selects the best protocol automatically using AI routing. If you prefer to choose manually: Reality is hardest to detect and block. XHTTP works well against DPI. HTTPUpgrade and WebSocket are reliable fallbacks. You can switch from the Servers screen.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.conn.q2">What is VLESS + Reality?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.conn.a2">VLESS is a modern, lightweight VPN protocol built on Xray-core. Reality is a transport layer that makes VPN traffic indistinguishable from normal HTTPS traffic by mimicking real websites like google.com or apple.com. Together they form the most DPI-resistant combination available.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.conn.q3">The app says "Connected" but sites won't load</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.conn.a3">Try these steps in order: 1. Go to Servers → tap a different server. 2. Change protocol — swipe a server card to see transport options. 3. Toggle airplane mode off/on to reset your network stack. 4. If still stuck, message us on Telegram with your protocol and ISP name.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.conn.q4">Can I use SetaLink with v2rayNG or Hiddify?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.conn.a4">Yes. Ask us for a VLESS subscription link and you can import it into v2rayNG (Android), Streisand (iOS/macOS), or Hiddify (all platforms). The SetaLink app is recommended as it handles everything automatically, but the subscription link works if you prefer those clients.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Privacy & Security -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.priv">Privacy & Security</div>
    <div class="faq-list">

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.priv.q1">Do you log my activity?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.priv.a1">No. We do not log IP addresses, connection timestamps, session duration, or any browsing data. The only data associated with your account is your Telegram username and plan expiry. We have no ability to reconstruct what sites you visited.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.priv.q2">Is the VPN tunnel encrypted?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.priv.a2">Yes. VLESS+Reality uses TLS 1.3 with perfect forward secrecy. Your traffic is encrypted between your device and our server. We cannot see the content of your browsing even if we wanted to.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.priv.q3">Does the Kill Switch really cut internet?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.priv.a3">Yes. When Kill Switch is enabled in Settings, if the VPN tunnel drops, all internet traffic is blocked until the VPN reconnects. This prevents your real IP from leaking during a dropout. You can toggle it off if you prefer to fall back to your regular connection.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Account & Billing -->
  <div class="faq-category">
    <div class="faq-cat-title" data-t="faq.cat.acct">Account & Billing</div>
    <div class="faq-list">

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.acct.q1">How do I upgrade to Premium?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.acct.a1">Message us on Telegram. We support payment via Crypto (USDT/TON), and will add card payment soon. Premium gives you unlimited data, 50+ server locations, and maximum speed.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.acct.q2">My account expired — how do I renew?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.acct.a2">Message @SetaLink3 on Telegram with your username. We'll renew your account within a few hours. Free tier users get 10 GB/month automatically — just let us know if it ran out early.</p>
        </div>
      </div>

      <div class="faq-item">
        <button class="faq-q">
          <span data-t="faq.acct.q3">Can I use the app on multiple devices?</span>
          <span class="faq-icon">+</span>
        </button>
        <div class="faq-a">
          <p data-t="faq.acct.a3">Free and Premium accounts allow 1 simultaneous connection. The Team plan ($8/mo) supports 5 simultaneous users — perfect for families or small organizations.</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Contact strip -->
  <div class="contact-strip">
    <h2 data-t="faq.help.h">Still need help?</h2>
    <p data-t="faq.help.p">We're on Telegram and reply within a few hours. No bots — a real person handles every message.</p>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-primary">
      <span>✈️</span>
      <span data-t="faq.help.cta">Message on Telegram</span>
    </a>
  </div>

</div>

<footer>
  <span data-t="footer">© 2026 SetaLink · Smart VPN for Iran</span>
</footer>

<script>
// Inline lang strings for FAQ page
(function () {
  'use strict';
  const STRINGS = {
    en: {
      'nav.lang': 'فارسی',
      'faq.eyebrow': 'Help & FAQ',
      'faq.h1': 'How can we help?',
      'faq.h1sub': 'Everything you need to know about SetaLink — getting started, troubleshooting, privacy, and more.',
      'faq.cat.start': 'Getting Started',
      'faq.start.q1': 'How do I get the SetaLink app?',
      'faq.start.a1': 'Message us on Telegram at @SetaLink3. We\'ll send you the Android APK file and create your account. iOS support is coming in Q3 2026.',
      'faq.start.q2': 'What do I need to run the app?',
      'faq.start.a2': 'Android 8.0 (API 26) or higher. The app requires VPN permission — which it will ask for on first connect. No root access needed.',
      'faq.start.q3': 'How do I install an APK from Telegram?',
      'faq.start.a3': '1. Download the APK from our Telegram message. 2. Allow "Install unknown apps" in Settings → Security. 3. Open the downloaded APK and tap Install. 4. Open SetaLink, log in, and tap Connect.',
      'faq.start.q4': 'Is it free?',
      'faq.start.a4': 'Yes — a free tier with 10 GB/month is available. Premium plans ($3/month) offer unlimited data and more server locations.',
      'faq.cat.conn': 'Connection & Protocols',
      'faq.conn.q1': 'Which protocol should I use?',
      'faq.conn.a1': 'The app selects the best protocol automatically. If you prefer manually: Reality is hardest to block, XHTTP works well against DPI, HTTPUpgrade and WebSocket are reliable fallbacks.',
      'faq.conn.q2': 'What is VLESS + Reality?',
      'faq.conn.a2': 'VLESS is a modern protocol built on Xray-core. Reality makes VPN traffic indistinguishable from HTTPS by mimicking real websites. Together they form the most DPI-resistant combination available.',
      'faq.conn.q3': 'The app says "Connected" but sites won\'t load',
      'faq.conn.a3': 'Try: 1. Switch to a different server. 2. Change the protocol from the server screen. 3. Toggle airplane mode off/on. 4. Message us with your ISP name if still stuck.',
      'faq.conn.q4': 'Can I use SetaLink with v2rayNG or Hiddify?',
      'faq.conn.a4': 'Yes. Ask us for a VLESS subscription link compatible with v2rayNG, Streisand, and Hiddify.',
      'faq.cat.priv': 'Privacy & Security',
      'faq.priv.q1': 'Do you log my activity?',
      'faq.priv.a1': 'No. We do not log IP addresses, connection timestamps, session duration, or browsing data. The only data we hold is your Telegram username and plan expiry.',
      'faq.priv.q2': 'Is the VPN tunnel encrypted?',
      'faq.priv.a2': 'Yes. VLESS+Reality uses TLS 1.3 with perfect forward secrecy. Your traffic is encrypted between your device and our server.',
      'faq.priv.q3': 'Does the Kill Switch really cut internet?',
      'faq.priv.a3': 'Yes. When Kill Switch is on, if the VPN drops, all internet is blocked until it reconnects. This prevents your real IP from leaking during dropouts.',
      'faq.cat.acct': 'Account & Billing',
      'faq.acct.q1': 'How do I upgrade to Premium?',
      'faq.acct.a1': 'Message us on Telegram. We support USDT/TON crypto payment, with card payment coming soon.',
      'faq.acct.q2': 'My account expired — how do I renew?',
      'faq.acct.a2': 'Message @SetaLink3 on Telegram with your username. We\'ll renew within a few hours.',
      'faq.acct.q3': 'Can I use the app on multiple devices?',
      'faq.acct.a3': 'Free and Premium: 1 simultaneous connection. Team plan ($8/mo): 5 simultaneous users.',
      'faq.help.h': 'Still need help?',
      'faq.help.p': 'We\'re on Telegram and reply within a few hours. No bots — a real person handles every message.',
      'faq.help.cta': 'Message on Telegram',
      'footer': '© 2026 SetaLink · Smart VPN for Iran',
    },
    fa: {
      'nav.lang': 'English',
      'faq.eyebrow': 'راهنما و سوالات متداول',
      'faq.h1': 'چطور می‌توانیم کمک کنیم؟',
      'faq.h1sub': 'همه چیزی که باید درباره ستالینک بدانید — شروع کار، رفع اشکال، حریم خصوصی و بیشتر.',
      'faq.cat.start': 'شروع کار',
      'faq.start.q1': 'چطور اپ ستالینک را دریافت کنم؟',
      'faq.start.a1': 'در تلگرام به @SetaLink3 پیام بدهید. APK اندروید را برای شما ارسال می‌کنیم و حساب شما را ایجاد می‌کنیم. پشتیبانی iOS در سه‌ماهه سوم ۲۰۲۶ می‌آید.',
      'faq.start.q2': 'برای اجرای اپ به چه چیزی نیاز دارم؟',
      'faq.start.a2': 'اندروید ۸.۰ (API 26) یا بالاتر. اپ مجوز VPN می‌خواهد که در اولین اتصال درخواست می‌کند. نیاز به روت ندارد.',
      'faq.start.q3': 'چطور APK از تلگرام نصب کنم؟',
      'faq.start.a3': '۱. APK را از پیام تلگرام دانلود کنید. ۲. در تنظیمات → امنیت، نصب از منابع ناشناس را فعال کنید. ۳. فایل APK را باز کرده و نصب را بزنید. ۴. ستالینک را باز کنید، وارد شوید و Connect بزنید.',
      'faq.start.q4': 'آیا رایگان است؟',
      'faq.start.a4': 'بله — یک طرح رایگان با ۱۰ گیگابایت در ماه وجود دارد. طرح پریمیوم (۳ دلار در ماه) داده نامحدود و موقعیت‌های بیشتر ارائه می‌دهد.',
      'faq.cat.conn': 'اتصال و پروتکل‌ها',
      'faq.conn.q1': 'کدام پروتکل را استفاده کنم؟',
      'faq.conn.a1': 'اپ به‌طور خودکار بهترین پروتکل را انتخاب می‌کند. برای انتخاب دستی: Reality سخت‌ترین برای مسدود کردن است، XHTTP در برابر DPI خوب کار می‌کند.',
      'faq.conn.q2': 'VLESS + Reality چیست؟',
      'faq.conn.a2': 'VLESS یک پروتکل مدرن مبتنی بر Xray-core است. Reality ترافیک VPN را با جعل وب‌سایت‌های واقعی از HTTPS معمولی غیرقابل تشخیص می‌کند.',
      'faq.conn.q3': 'اپ "Connected" نشان می‌دهد ولی سایت‌ها باز نمی‌شوند',
      'faq.conn.a3': 'امتحان کنید: ۱. به سرور دیگری تغییر دهید. ۲. پروتکل را از صفحه سرورها عوض کنید. ۳. حالت هواپیما را یکبار روشن و خاموش کنید. ۴. اگر مشکل ادامه دارد با نام ISP خود پیام بدهید.',
      'faq.conn.q4': 'آیا می‌توانم ستالینک را با v2rayNG یا Hiddify استفاده کنم؟',
      'faq.conn.a4': 'بله. لینک اشتراک VLESS سازگار با v2rayNG، Streisand و Hiddify را از ما بخواهید.',
      'faq.cat.priv': 'حریم خصوصی و امنیت',
      'faq.priv.q1': 'آیا فعالیت من را ثبت می‌کنید؟',
      'faq.priv.a1': 'خیر. ما آدرس IP، زمان اتصال، مدت جلسه یا داده‌های مرور را ثبت نمی‌کنیم. تنها داده‌ای که نگه می‌داریم نام کاربری تلگرام و تاریخ انقضای طرح شماست.',
      'faq.priv.q2': 'آیا تونل VPN رمزنگاری شده است؟',
      'faq.priv.a2': 'بله. VLESS+Reality از TLS 1.3 با Perfect Forward Secrecy استفاده می‌کند. ترافیک شما بین دستگاه و سرور ما رمزنگاری شده است.',
      'faq.priv.q3': 'آیا Kill Switch واقعاً اینترنت را قطع می‌کند؟',
      'faq.priv.a3': 'بله. وقتی Kill Switch روشن است، اگر VPN قطع شود، همه اینترنت تا زمان اتصال مجدد مسدود می‌شود. این از لو رفتن IP واقعی شما جلوگیری می‌کند.',
      'faq.cat.acct': 'حساب و پرداخت',
      'faq.acct.q1': 'چطور به پریمیوم ارتقا دهم؟',
      'faq.acct.a1': 'در تلگرام پیام بدهید. از طریق کریپتو (USDT/TON) پرداخت می‌پذیریم و پرداخت با کارت به‌زودی اضافه می‌شود.',
      'faq.acct.q2': 'حساب من منقضی شده — چطور تمدید کنم؟',
      'faq.acct.a2': 'با نام کاربری خود به @SetaLink3 پیام بدهید. ظرف چند ساعت تمدید می‌کنیم.',
      'faq.acct.q3': 'آیا می‌توانم روی چندین دستگاه استفاده کنم؟',
      'faq.acct.a3': 'طرح رایگان و پریمیوم: ۱ اتصال همزمان. طرح تیمی (۸ دلار/ماه): ۵ کاربر همزمان.',
      'faq.help.h': 'هنوز به کمک نیاز دارید؟',
      'faq.help.p': 'در تلگرام هستیم و ظرف چند ساعت پاسخ می‌دهیم. بدون ربات — یک نفر واقعی هر پیام را مدیریت می‌کند.',
      'faq.help.cta': 'پیام در تلگرام',
      'footer': '© ۲۰۲۶ ستالینک · VPN هوشمند برای ایران',
    }
  };

  let lang = localStorage.getItem('sl-lang') || 'en';

  function applyLang(l) {
    lang = l;
    localStorage.setItem('sl-lang', l);
    document.documentElement.setAttribute('lang', l);
    document.body.setAttribute('dir', l === 'fa' ? 'rtl' : 'ltr');
    const s = STRINGS[l];
    document.querySelectorAll('[data-t]').forEach(el => {
      const key = el.dataset.t;
      if (s[key] !== undefined) el.textContent = s[key];
    });
  }

  function initLangToggle() {
    const btn = document.getElementById('btn-lang');
    if (!btn) return;
    btn.addEventListener('click', () => applyLang(lang === 'en' ? 'fa' : 'en'));
  }

  function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(item => {
      const btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(o => o.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLangToggle();
    initFAQ();
    applyLang(lang);
  });
})();
</script>
</body>
</html>
