// SetaLink landing page — lang toggle + FAQ accordion
(function () {
  'use strict';

  const STRINGS = {
    en: {
      'nav.lang': 'فارسی',

      // Hero
      'hero.badge': 'Server Online',
      'hero.h1a': 'Your VPN.',
      'hero.h1b': 'Built for Iran.',
      'hero.sub': 'SetaLink is a smart VPN app designed from the ground up for Iran — VLESS+Reality protocols, AI-assisted routing, no logs, bilingual. Now in beta for Android.',
      'hero.cta1': 'Get the App',
      'hero.cta2': 'See Features',

      // App section
      'app.badge': 'Android Beta · Available Now',
      'app.h2': 'The SetaLink App is Here',
      'app.sub': 'No more importing configs into third-party apps. SetaLink is a complete VPN app — connect in one tap, switch servers instantly, and let AI pick the fastest route.',
      'app.android.pre': 'Join Beta',
      'app.android.label': 'Android APK',
      'app.ios.pre': 'Coming Soon',
      'app.ios.label': 'iOS App',
      'app.note': 'Contact us on Telegram to join the Android beta · iOS coming Q3 2026',

      // Features
      'feat.label': 'FEATURES',
      'feat.h2': 'Built Different',
      'feat.sub': 'Every detail designed for users behind Iran\'s firewall.',
      'feat.f1.h': 'VLESS + Reality',
      'feat.f1.p': 'The hardest-to-block protocol available. Traffic looks identical to normal HTTPS — no VPN fingerprint to detect.',
      'feat.f2.h': 'AI Smart Routing',
      'feat.f2.p': 'AI engine monitors latency and blocking patterns, auto-switches protocols and servers to keep you connected.',
      'feat.f3.h': 'One-Tap Connect',
      'feat.f3.p': 'No config files, no QR codes, no setup. Install, tap connect — that\'s it. Reconnects automatically on network changes.',
      'feat.f4.h': 'Bilingual',
      'feat.f4.p': 'Full Persian and English support with proper RTL layout. The first VPN app that feels native for Iranian users.',
      'feat.f5.h': 'Zero Logs',
      'feat.f5.p': 'We never store connection logs, your IP, or traffic data. Privacy is not a feature — it\'s the foundation.',
      'feat.f6.h': 'Live Stats',
      'feat.f6.p': 'Real-time upload/download speed, ping, session timer, and traffic history — all visible at a glance.',

      // Transports
      'transports.label': 'TRANSPORTS',
      'transports.h2': 'Available Connections',
      'transports.sub': 'Four tunneling methods. The app switches automatically — or you can pick manually.',
      'tr.reality.desc': 'Hardest to detect. Direct TCP, looks like normal HTTPS traffic.',
      'tr.xhttp.desc': 'HTTP/2 stream. Resistant to deep packet inspection.',
      'tr.httpup.desc': 'HTTP Upgrade tunnel. Reliable fallback.',
      'tr.ws.desc': 'WebSocket over TLS. Widely compatible.',
      'transports.notice': 'Status dots show whether this server\'s transports are reachable from your location. The app handles switching automatically.',

      // Pricing
      'pricing.label': 'PRICING',
      'pricing.h2': 'Simple Plans',
      'pricing.sub': 'Start free. Upgrade when you need more.',
      'plan.free.label': 'FREE',
      'plan.free.period': 'Always free',
      'plan.free.f1': '10 GB / month',
      'plan.free.f2': '5 server locations',
      'plan.free.f3': 'All protocols',
      'plan.free.f4': 'Standard speed',
      'plan.free.cta': 'Get Started Free',
      'plan.premium.label': 'PREMIUM',
      'plan.premium.period': 'per month',
      'plan.premium.f1': 'Unlimited data',
      'plan.premium.f2': '50+ server locations',
      'plan.premium.f3': 'All protocols + AI routing',
      'plan.premium.f4': 'Maximum speed',
      'plan.premium.f5': 'Priority support',
      'plan.premium.cta': 'Get Premium',
      'plan.team.label': 'TEAM',
      'plan.team.period': '5 users / month',
      'plan.team.f1': 'Everything in Premium',
      'plan.team.f2': '5 simultaneous users',
      'plan.team.f3': 'Shared admin panel',
      'plan.team.f4': 'Dedicated account manager',
      'plan.team.cta': 'Contact for Team',

      // FAQ
      'faq.label': 'FAQ',
      'faq.h2': 'Common Questions',
      'faq.q1': 'How do I get the app?',
      'faq.a1': 'Message us on Telegram to receive the Android APK and your account credentials. iOS is coming in Q3 2026.',
      'faq.q2': 'Which protocol should I use?',
      'faq.a2': 'The app picks the best protocol automatically. If you want to choose manually, start with Reality — it\'s the hardest to detect. Then try XHTTP, HTTPUpgrade, WebSocket.',
      'faq.q3': 'Is my data private?',
      'faq.a3': 'Yes. We never log your IP address, connection times, or browsing data. The VPN tunnel itself uses VLESS+Reality which is end-to-end encrypted.',
      'faq.q4': 'The VPN connects but pages don\'t load?',
      'faq.a4': 'Try a different transport from the server screen. Your ISP may be blocking that specific protocol. Reality and XHTTP are usually the most resilient.',
      'faq.q5': 'Can I still use v2rayNG / Hiddify?',
      'faq.a5': 'Yes. Contact us on Telegram and we\'ll send you a VLESS subscription link compatible with v2rayNG (Android), Streisand (iOS), and Hiddify (all platforms).',

      // Community
      'comm.label': 'COMMUNITY',
      'comm.h2': 'Stay Connected',
      'comm.sub': 'Join our channels for updates, new servers, and support.',
      'comm.tg.h': 'Telegram Support',
      'comm.tg.p': 'Get your account, report issues, ask questions.',
      'comm.ch.h': 'Announcements Channel',
      'comm.ch.p': 'Server updates, new features, downtime alerts.',

      'footer': '© 2026 SetaLink · Smart VPN for Iran',
    },
    fa: {
      'nav.lang': 'English',

      // Hero
      'hero.badge': 'سرور فعال',
      'hero.h1a': 'VPN شما.',
      'hero.h1b': 'ساخته‌شده برای ایران.',
      'hero.sub': 'ستالینک یک اپ VPN هوشمند است که از صفر برای ایران طراحی شده — پروتکل‌های VLESS+Reality، مسیریابی با هوش مصنوعی، بدون لاگ، دوزبانه. اکنون در نسخه بتا برای اندروید.',
      'hero.cta1': 'دریافت اپ',
      'hero.cta2': 'ویژگی‌ها',

      // App section
      'app.badge': 'بتای اندروید · هم‌اکنون در دسترس',
      'app.h2': 'اپ ستالینک اینجاست',
      'app.sub': 'دیگر نیازی به وارد کردن کانفیگ در اپ‌های شخص ثالث نیست. ستالینک یک اپ VPN کامل است — با یک ضربه وصل شوید، سریع سرور عوض کنید، و بگذارید هوش مصنوعی سریع‌ترین مسیر را انتخاب کند.',
      'app.android.pre': 'پیوستن به بتا',
      'app.android.label': 'اندروید APK',
      'app.ios.pre': 'به‌زودی',
      'app.ios.label': 'اپ iOS',
      'app.note': 'برای پیوستن به بتای اندروید در تلگرام با ما تماس بگیرید · iOS در سه‌ماهه سوم ۲۰۲۶',

      // Features
      'feat.label': 'ویژگی‌ها',
      'feat.h2': 'متفاوت ساخته شده',
      'feat.sub': 'هر جزئیت برای کاربران پشت فایروال ایران طراحی شده.',
      'feat.f1.h': 'VLESS + Reality',
      'feat.f1.p': 'سخت‌ترین پروتکل برای مسدود کردن. ترافیک دقیقاً شبیه HTTPS معمولی است — هیچ اثر انگشت VPN برای تشخیص وجود ندارد.',
      'feat.f2.h': 'مسیریابی هوشمند AI',
      'feat.f2.p': 'موتور AI تأخیر و الگوهای مسدودسازی را رصد می‌کند و پروتکل‌ها و سرورها را به‌طور خودکار تغییر می‌دهد.',
      'feat.f3.h': 'اتصال با یک ضربه',
      'feat.f3.p': 'بدون فایل کانفیگ، بدون کد QR، بدون تنظیمات. نصب کنید، ضربه بزنید — همین. در تغییر شبکه به‌طور خودکار دوباره وصل می‌شود.',
      'feat.f4.h': 'دوزبانه',
      'feat.f4.p': 'پشتیبانی کامل از فارسی و انگلیسی با طرح‌بندی RTL صحیح. اولین اپ VPN که برای کاربران ایرانی احساس بومی می‌دهد.',
      'feat.f5.h': 'بدون لاگ',
      'feat.f5.p': 'ما هرگز لاگ اتصال، IP شما یا داده‌های ترافیک را ذخیره نمی‌کنیم. حریم خصوصی یک ویژگی نیست — پایه است.',
      'feat.f6.h': 'آمار زنده',
      'feat.f6.p': 'سرعت آپلود/دانلود، پینگ، تایمر جلسه و تاریخچه ترافیک — همه در یک نگاه قابل مشاهده.',

      // Transports
      'transports.label': 'پروتکل‌ها',
      'transports.h2': 'اتصالات موجود',
      'transports.sub': 'چهار روش تونل. اپ به‌طور خودکار تغییر می‌دهد — یا می‌توانید دستی انتخاب کنید.',
      'tr.reality.desc': 'سخت‌ترین برای تشخیص. TCP مستقیم، شبیه ترافیک HTTPS معمولی.',
      'tr.xhttp.desc': 'جریان HTTP/2. مقاوم در برابر بازرسی عمیق بسته.',
      'tr.httpup.desc': 'تونل HTTP Upgrade. گزینه پشتیبان قابل اعتماد.',
      'tr.ws.desc': 'WebSocket روی TLS. سازگاری گسترده.',
      'transports.notice': 'نقاط وضعیت نشان می‌دهند که آیا پروتکل‌های این سرور از موقعیت شما قابل دسترسی هستند. اپ تغییر را به‌طور خودکار انجام می‌دهد.',

      // Pricing
      'pricing.label': 'قیمت‌گذاری',
      'pricing.h2': 'طرح‌های ساده',
      'pricing.sub': 'رایگان شروع کنید. وقتی نیاز بیشتری داشتید ارتقا دهید.',
      'plan.free.label': 'رایگان',
      'plan.free.period': 'همیشه رایگان',
      'plan.free.f1': '۱۰ گیگابایت در ماه',
      'plan.free.f2': '۵ موقعیت سرور',
      'plan.free.f3': 'همه پروتکل‌ها',
      'plan.free.f4': 'سرعت معمولی',
      'plan.free.cta': 'شروع رایگان',
      'plan.premium.label': 'پریمیوم',
      'plan.premium.period': 'در ماه',
      'plan.premium.f1': 'داده نامحدود',
      'plan.premium.f2': 'بیش از ۵۰ موقعیت سرور',
      'plan.premium.f3': 'همه پروتکل‌ها + مسیریابی AI',
      'plan.premium.f4': 'حداکثر سرعت',
      'plan.premium.f5': 'پشتیبانی اولویت‌دار',
      'plan.premium.cta': 'دریافت پریمیوم',
      'plan.team.label': 'تیمی',
      'plan.team.period': '۵ کاربر در ماه',
      'plan.team.f1': 'همه امکانات پریمیوم',
      'plan.team.f2': '۵ کاربر همزمان',
      'plan.team.f3': 'پنل ادمین مشترک',
      'plan.team.f4': 'مدیر حساب اختصاصی',
      'plan.team.cta': 'تماس برای تیم',

      // FAQ
      'faq.label': 'سوالات متداول',
      'faq.h2': 'سوالات رایج',
      'faq.q1': 'چطور اپ را بگیرم؟',
      'faq.a1': 'در تلگرام پیام بدهید تا APK اندروید و اطلاعات حساب خود را دریافت کنید. iOS در سه‌ماهه سوم ۲۰۲۶ می‌آید.',
      'faq.q2': 'کدام پروتکل را استفاده کنم؟',
      'faq.a2': 'اپ بهترین پروتکل را به‌طور خودکار انتخاب می‌کند. اگر می‌خواهید دستی انتخاب کنید، با Reality شروع کنید — سخت‌ترین برای تشخیص است.',
      'faq.q3': 'آیا داده‌هایم خصوصی است؟',
      'faq.a3': 'بله. ما هرگز آدرس IP، زمان‌های اتصال یا داده‌های مرور شما را ثبت نمی‌کنیم. تونل VPN از VLESS+Reality که انتها به انتها رمزنگاری شده استفاده می‌کند.',
      'faq.q4': 'VPN وصل می‌شود ولی صفحات باز نمی‌شوند؟',
      'faq.a4': 'یک پروتکل دیگر از صفحه سرورها امتحان کنید. ISP شما ممکن است آن پروتکل خاص را مسدود کرده باشد.',
      'faq.q5': 'آیا می‌توانم از v2rayNG / Hiddify استفاده کنم؟',
      'faq.a5': 'بله. در تلگرام تماس بگیرید تا لینک اشتراک VLESS سازگار با v2rayNG، Streisand و Hiddify برای شما ارسال کنیم.',

      // Community
      'comm.label': 'جامعه',
      'comm.h2': 'در ارتباط باشید',
      'comm.sub': 'به کانال‌های ما برای به‌روزرسانی، سرورهای جدید و پشتیبانی بپیوندید.',
      'comm.tg.h': 'پشتیبانی تلگرام',
      'comm.tg.p': 'حساب بگیرید، مشکلات را گزارش دهید، سوال بپرسید.',
      'comm.ch.h': 'کانال اطلاع‌رسانی',
      'comm.ch.p': 'به‌روزرسانی سرور، ویژگی‌های جدید، هشدارهای قطعی.',

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

  function initStatusCheck() {
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
