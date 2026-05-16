// SetaLink landing page — lang toggle + FAQ accordion
(function () {
  'use strict';

  const STRINGS = {
    en: {
      'nav.lang': 'فارسی',
      'hero.badge': 'Server Online',
      'hero.h1a': 'Bypass Internet',
      'hero.h1b': 'Censorship',
      'hero.sub': 'Fast, private VPN for Iran. Multiple transport protocols designed to stay connected when everything else is blocked.',
      'hero.cta1': 'Get Started',
      'hero.cta2': 'How it works',
      'dl.label': 'APPS',
      'dl.h2': 'Download & Connect',
      'dl.sub': 'Use one of these free apps to import your VPN profile.',
      'app.v2ray.meta': 'Android · Recommended',
      'app.v2ray.desc': 'Most compatible with all VLESS transports',
      'app.streisand.meta': 'iOS / macOS',
      'app.streisand.desc': 'Clean iOS client, supports VLESS Reality',
      'app.hiddify.meta': 'Android / Windows',
      'app.hiddify.desc': 'All-in-one, great for beginners',
      'app.v2rayng.meta': 'Android (stable)',
      'app.v2rayng.desc': 'Widely used, very stable',
      'howto.label': 'SETUP GUIDE',
      'howto.h2': 'Connect in 3 steps',
      'howto.sub': 'Your VPN profile is ready. Just follow these steps.',
      's1.h': 'Download an app',
      's1.p': 'Install v2rayNG, Hiddify, or Streisand from the links above.',
      's2.h': 'Import your profile',
      's2.p': 'Open the app and paste your VLESS link, or scan the QR code sent to you.',
      's3.h': 'Connect and browse',
      's3.p': 'Tap connect. If one profile is blocked, try another transport — try Reality or XHTTP first.',
      'transports.label': 'TRANSPORTS',
      'transports.h2': 'Available Connections',
      'transports.sub': 'Four different tunneling methods. If one is blocked by your ISP, switch to another.',
      'tr.reality.desc': 'Hardest to detect. Direct TCP, looks like normal HTTPS traffic.',
      'tr.xhttp.desc': 'HTTP/2 stream. Resistant to deep packet inspection.',
      'tr.httpup.desc': 'HTTP Upgrade tunnel. Reliable fallback.',
      'tr.ws.desc': 'WebSocket over TLS. Widely compatible.',
      'faq.label': 'FAQ',
      'faq.h2': 'Common Questions',
      'faq.q1': 'Which profile should I try first?',
      'faq.a1': 'Start with REALITY — it\'s the hardest to detect. If that\'s blocked, try XHTTP, then HTTPUpgrade, then WebSocket.',
      'faq.q2': 'The VPN connects but pages don\'t load?',
      'faq.a2': 'Try a different transport. Your ISP may be blocking that protocol specifically. Reality and XHTTP are usually the most resilient.',
      'faq.q3': 'How do I get a profile link?',
      'faq.a3': 'Contact us via Telegram. We\'ll send you a personal VLESS link and QR code for all transports.',
      'faq.q4': 'Is it free?',
      'faq.a4': 'Yes, for now. Free 7-day and 30-day accounts are available. Contact us on Telegram to get access.',
      'faq.q5': 'What is VLESS / what client should I use?',
      'faq.a5': 'VLESS is a modern VPN protocol used by Xray-core. Use v2rayNG (Android) or Hiddify (all platforms). These apps support all our transport types.',
      'contact.label': 'CONTACT',
      'contact.h2': 'Get Your Free Account',
      'contact.sub': 'Message us on Telegram to get your personal VPN profile link and QR code.',
      'contact.cta': 'Message on Telegram',
      'contact.note': 'We reply within a few hours. Free accounts available.',
      'footer': '© 2026 SetaLink · Free VPN for Iran',
    },
    fa: {
      'nav.lang': 'English',
      'hero.badge': 'سرور فعال',
      'hero.h1a': 'دور زدن',
      'hero.h1b': 'سانسور اینترنت',
      'hero.sub': 'VPN سریع و خصوصی برای ایران. چندین پروتکل انتقال طراحی شده برای اتصال دائمی حتی وقتی همه چیز دیگر مسدود است.',
      'hero.cta1': 'شروع کنید',
      'hero.cta2': 'نحوه کار',
      'dl.label': 'اپلیکیشن‌ها',
      'dl.h2': 'دانلود و اتصال',
      'dl.sub': 'یکی از این اپ‌های رایگان را برای وارد کردن پروفایل VPN خود استفاده کنید.',
      'app.v2ray.meta': 'اندروید · پیشنهادی',
      'app.v2ray.desc': 'بیشترین سازگاری با تمام انواع VLESS',
      'app.streisand.meta': 'iOS / macOS',
      'app.streisand.desc': 'کلاینت تمیز iOS، پشتیبانی از VLESS Reality',
      'app.hiddify.meta': 'اندروید / ویندوز',
      'app.hiddify.desc': 'همه‌کاره، مناسب مبتدیان',
      'app.v2rayng.meta': 'اندروید (پایدار)',
      'app.v2rayng.desc': 'پرکاربرد و بسیار پایدار',
      'howto.label': 'راهنمای اتصال',
      'howto.h2': 'اتصال در ۳ مرحله',
      'howto.sub': 'پروفایل VPN شما آماده است. فقط این مراحل را دنبال کنید.',
      's1.h': 'یک اپ دانلود کنید',
      's1.p': 'v2rayNG، Hiddify یا Streisand را از لینک‌های بالا نصب کنید.',
      's2.h': 'پروفایل خود را وارد کنید',
      's2.p': 'اپ را باز کنید و لینک VLESS خود را paste کنید، یا کد QR ارسال‌شده را اسکن کنید.',
      's3.h': 'وصل شوید و مرور کنید',
      's3.p': 'روی connect بزنید. اگر یک پروفایل مسدود شد، پروتکل دیگری امتحان کنید — اول Reality یا XHTTP را امتحان کنید.',
      'transports.label': 'پروتکل‌ها',
      'transports.h2': 'اتصالات موجود',
      'transports.sub': 'چهار روش مختلف تونل. اگر یکی توسط ISP شما مسدود شد، به دیگری تغییر دهید.',
      'tr.reality.desc': 'سخت‌ترین برای تشخیص. TCP مستقیم، شبیه ترافیک HTTPS معمولی است.',
      'tr.xhttp.desc': 'جریان HTTP/2. مقاوم در برابر بازرسی عمیق بسته.',
      'tr.httpup.desc': 'تونل HTTP Upgrade. گزینه پشتیبان قابل اعتماد.',
      'tr.ws.desc': 'WebSocket روی TLS. سازگاری گسترده.',
      'faq.label': 'سوالات متداول',
      'faq.h2': 'سوالات رایج',
      'faq.q1': 'کدام پروفایل را اول امتحان کنم؟',
      'faq.a1': 'با REALITY شروع کنید — سخت‌ترین برای تشخیص است. اگر مسدود شد، XHTTP را امتحان کنید، سپس HTTPUpgrade، سپس WebSocket.',
      'faq.q2': 'VPN وصل می‌شود ولی صفحات باز نمی‌شوند؟',
      'faq.a2': 'یک پروتکل دیگر امتحان کنید. ISP شما ممکن است آن پروتکل خاص را مسدود کرده باشد. Reality و XHTTP معمولاً مقاوم‌ترین هستند.',
      'faq.q3': 'چطور لینک پروفایل بگیرم؟',
      'faq.a3': 'از طریق تلگرام با ما تماس بگیرید. لینک شخصی VLESS و کد QR برای تمام پروتکل‌ها برای شما ارسال می‌کنیم.',
      'faq.q4': 'آیا رایگان است؟',
      'faq.a4': 'بله، فعلاً. اکانت‌های رایگان ۷ روزه و ۳۰ روزه در دسترس هستند. برای دسترسی از طریق تلگرام با ما تماس بگیرید.',
      'faq.q5': 'VLESS چیست / از کدام کلاینت استفاده کنم؟',
      'faq.a5': 'VLESS یک پروتکل VPN مدرن است که توسط Xray-core استفاده می‌شود. از v2rayNG (اندروید) یا Hiddify (همه پلتفرم‌ها) استفاده کنید. این اپ‌ها از تمام انواع انتقال ما پشتیبانی می‌کنند.',
      'contact.label': 'تماس',
      'contact.h2': 'اکانت رایگان بگیرید',
      'contact.sub': 'در تلگرام پیام بدهید تا لینک شخصی VPN و کد QR خود را دریافت کنید.',
      'contact.cta': 'پیام در تلگرام',
      'contact.note': 'در چند ساعت پاسخ می‌دهیم. اکانت‌های رایگان در دسترس است.',
      'footer': '© ۲۰۲۶ ستالینک · VPN رایگان برای ایران',
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

  function initStatusCheck() {
    // Lightweight transport health check via fetch HEAD
    const checks = [
      { id: 'status-ws',      url: '/ws',     expect: [101, 400, 200] },
      { id: 'status-xhttp',   url: '/xhttp',  expect: [404, 400, 200] },
      { id: 'status-httpup',  url: '/httpup', expect: [502, 400, 200, 101] },
    ];
    checks.forEach(({ id, url, expect }) => {
      const dot = document.getElementById(id);
      if (!dot) return;
      dot.className = 'status-dot checking';
      fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5000) })
        .then(r => {
          dot.className = expect.includes(r.status) ? 'status-dot' : 'status-dot offline';
        })
        .catch(() => {
          // network error = could be blocked or CORS; mark unknown
          dot.className = 'status-dot';
        });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLangToggle();
    initFAQ();
    initStatusCheck();
    applyLang(lang);
  });
})();
