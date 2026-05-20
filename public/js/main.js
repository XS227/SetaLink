(function () {
  'use strict';

  var STRINGS = {
    en: {
      'nav.lang': 'فارسی',
      'nav.dl':   'Download APK',

      'hero.badge': 'Server Online &mdash; Norway &amp; Turkey nodes',
      'hero.h1a':   'Free Internet',
      'hero.h1b':   'for Everyone',
      'hero.sub':   'AI-powered VPN built for real censorship. Android-only. 1 GB free on install. No account. No server setup.',
      'hero.cta1':  'Download APK',
      'hero.cta2':  'Join Telegram',

      'stat.1': 'Free on install',
      'stat.2': 'Protocols tested',
      'stat.3': 'Accounts needed',
      'stat.4': 'Per referral',

      'how.label': 'HOW IT WORKS',
      'how.title': 'Three Steps to Free Internet',
      'how.sub':   'No account, no credit card, no configuration. Install and connect.',
      'how.s1.h':  'Emergency Access',
      'how.s1.p':  'Install the APK and get 1 GB instantly — no login, no account. Tap Connect and the AI selects the fastest working protocol for your network.',
      'how.s2.h':  'Invite &amp; Earn Data',
      'how.s2.p':  'Share your referral code. Every person who joins adds 512 MB to both of you. The more people connect, the stronger and cheaper the network becomes.',
      'how.s3.h':  'AI Picks Best Route',
      'how.s3.p':  'Reality, XHTTP, and WebSocket are tested in parallel. Only a path that returns real HTTP data is declared connected — no fake “connected” states.',

      'ai.label': 'INTELLIGENT ROUTING',
      'ai.title': 'Not Just a Tunnel',
      'ai.sub':   'SetaLink actively validates every connection and picks the best path — every single time.',
      'ai.f1.h':  'AI Protocol Optimizer',
      'ai.f1.p':  'Tests Reality, XHTTP, and WebSocket in parallel. Selects the fastest protocol that actually delivers internet — not the last one that worked, the one that works right now.',
      'ai.f2.h':  'Real Internet Validation',
      'ai.f2.p':  'TCP-connected is not enough. The app sends an actual HTTP/HTTPS request and verifies real data is received before declaring you connected. Fake states are rejected hard.',
      'ai.f3.h':  'Adaptive Routing',
      'ai.f3.p':  'The network learns which SNIs work from your region. Turkey and Iran have different blocking patterns — the app adapts and remembers what works where, improving over time.',
      'ai.f4.h':  'Remote Config Push',
      'ai.f4.p':  'Admin can push protocol priority updates without requiring an app update. When censorship patterns change, routing rules are updated automatically for all users.',

      'why.label':      'WHY SETALINK',
      'why.title':      'Built for Real Censorship',
      'why.sub':        'Not a generic VPN wrapper. Built from scratch for the realities of Iran and Turkey.',
      'why.tech.label': 'TECHNICAL EXCELLENCE',
      'why.tech.1':     'VLESS + Reality — traffic indistinguishable from standard HTTPS, the most censorship-resistant protocol available',
      'why.tech.2':     'XHTTP and WebSocket fallback transports via nginx edge proxy, tested continuously',
      'why.tech.3':     'No logs, no account registration required to get emergency access',
      'why.tech.4':     'SNI probing confirms which domains work from your ISP before connecting',
      'why.comm.label': 'COMMUNITY MODEL',
      'why.comm.1':     'More users = lower cost per user — infrastructure is shared and the network grows stronger with scale',
      'why.comm.2':     'Referral bonuses reward both inviter and invitee — growth benefits everyone',
      'why.comm.3':     'Community-backed, not VC-funded — decisions stay aligned with users, not investors',
      'why.comm.4':     'Future: user-funded server expansion — vote on new regions and node locations',

      'banner.q': '&ldquo;Every new user makes the network <strong>stronger</strong> and <strong>cheaper</strong> for everyone.&rdquo;',
      'banner.s': 'As the network grows, infrastructure cost per user decreases. Share with friends.',

      'pricing.label': 'ACCESS TIERS',
      'pricing.title': 'Start Free. Grow Together.',
      'pricing.sub':   '1 GB on install, more via referrals, unlimited data tier coming soon.',

      'plan.free.eyebrow': 'FREE EMERGENCY',
      'plan.free.title':   'Starter Pack',
      'plan.free.desc':    'Auto-activated when you install the APK. No account, no login, no credit card.',
      'plan.free.f1':      '1 GB starter quota',
      'plan.free.f2':      'Auto-activated on install',
      'plan.free.f3':      'AI protocol selection',
      'plan.free.f4':      'No account needed',
      'plan.free.cta':     'Download APK',

      'plan.comm.eyebrow': 'INVITE-BASED',
      'plan.comm.title':   'Community',
      'plan.comm.desc':    'Share your referral code. Every friend who joins gives both of you 512 MB extra.',
      'plan.comm.f1':      '+512 MB per friend invited',
      'plan.comm.f2':      'Invitee also receives +512 MB',
      'plan.comm.f3':      'No limit on referrals',
      'plan.comm.f4':      'Network grows stronger with you',
      'plan.comm.cta':     'Get Invite Code',

      'plan.prem.eyebrow': 'COMING SOON',
      'plan.prem.title':   'Premium',
      'plan.prem.desc':    'Unlimited data, priority nodes, dedicated support channels.',
      'plan.prem.f1':      'Unlimited data',
      'plan.prem.f2':      'Priority routing nodes',
      'plan.prem.f3':      'Dedicated support',
      'plan.prem.f4':      'Early access features',
      'plan.prem.cta':     'Join Waitlist',

      'support.label': 'INFRASTRUCTURE FUNDING',
      'support.title': 'Support the Project',
      'support.sub':   'SetaLink runs on real servers that cost real money. Every contribution helps add nodes, improve reliability, and expand to new regions.',
      'support.s1.h':  'Server Costs',
      'support.s1.p':  'VPS hosting in Norway and Turkey. More nodes = better speed and resilience for every user in the network.',
      'support.s2.h':  'Censorship Resilience',
      'support.s2.p':  'New protocols, SNI rotation, and edge proxy improvements require development time. Funding keeps the work moving.',
      'support.s3.h':  'How to Help',
      'support.s3.p':  'Share the app with friends (earn data), contribute code on GitHub, or contact us via Telegram to discuss infrastructure sponsorship.',

      'comm.tg.h': 'Telegram Group',
      'comm.tg.p': 'Ask questions, report issues, get your referral code, and stay updated on new releases. The main support channel.',
      'comm.gh.h': 'GitHub',
      'comm.gh.p': 'Follow development, contribute code or report bugs. Open to community review — no black-box security claims.',

      'faq.label': 'FAQ',
      'faq.title': 'Common Questions',
      'faq.sub':   'Real questions about how SetaLink actually works.',

      'footer.faq': 'Full FAQ',
      'footer.tg':  'Telegram',
      'footer.gh':  'GitHub',
      'footer.dl':  'Download APK',
    },
    fa: {
      'nav.lang': 'English',
      'nav.dl':   'دانلود APK',

      'hero.badge': 'سرور فعال &mdash; گره‌های نروژ و ترکیه',
      'hero.h1a':   'اینترنت آزاد',
      'hero.h1b':   'برای همه',
      'hero.sub':   'VPN مبتنی بر هوش مصنوعی، ساخته‌شده برای سانسور واقعی. فقط اندروید. ۱ گیگابایت رایگان پس از نصب. بدون حساب. بدون تنظیمات.',
      'hero.cta1':  'دانلود APK',
      'hero.cta2':  'پیوستن به تلگرام',

      'stat.1': 'رایگان پس از نصب',
      'stat.2': 'پروتکل آزمایش‌شده',
      'stat.3': 'بدون نیاز به حساب',
      'stat.4': 'به ازای هر دعوت',

      'how.label': 'چطور کار می‌کند',
      'how.title': 'سه گام به اینترنت آزاد',
      'how.sub':   'بدون حساب، بدون کارت اعتباری، بدون تنظیمات. نصب کن و وصل شو.',
      'how.s1.h':  'دسترسی اضطراری',
      'how.s1.p':  'APK را نصب کن و فوری ۱ گیگابایت بگیر — بدون لاگین، بدون حساب. Connect را بزن و هوش مصنوعی سریع‌ترین پروتکل را انتخاب می‌کند.',
      'how.s2.h':  'دعوت و کسب داده',
      'how.s2.p':  'کد دعوت خود را به اشتراک بگذار. هر کسی که بپیوندد ۵۱۲ مگابایت به هر دوی شما اضافه می‌کند. هرچه بیشتر وصل شوند، شبکه قوی‌تر و ارزان‌تر می‌شود.',
      'how.s3.h':  'هوش مصنوعی بهترین مسیر را انتخاب می‌کند',
      'how.s3.p':  'Reality، XHTTP و WebSocket به صورت موازی آزمایش می‌شوند. تنها مسیری که داده HTTP واقعی برمی‌گرداند متصل اعلام می‌شود — هیچ وضعیت متصل جعلی وجود ندارد.',

      'ai.label': 'مسیریابی هوشمند',
      'ai.title': 'فقط یک تونل نیست',
      'ai.sub':   'ستالینک هر اتصال را فعالانه اعتبارسنجی می‌کند و هر بار بهترین مسیر را انتخاب می‌کند.',
      'ai.f1.h':  'بهینه‌ساز پروتکل با هوش مصنوعی',
      'ai.f1.p':  'Reality، XHTTP و WebSocket را به صورت موازی آزمایش می‌کند. سریع‌ترین پروتکلی که اینترنت واقعی ارائه می‌دهد انتخاب می‌شود — نه آنچه قبلاً کار می‌کرد، آنچه الان کار می‌کند.',
      'ai.f2.h':  'اعتبارسنجی اینترنت واقعی',
      'ai.f2.p':  'اتصال TCP کافی نیست. برنامه یک درخواست HTTP/HTTPS واقعی ارسال می‌کند و تأیید می‌کند داده واقعی دریافت شده — قبل از اعلام اتصال. وضعیت‌های جعلی رد می‌شوند.',
      'ai.f3.h':  'مسیریابی تطبیقی',
      'ai.f3.p':  'شبکه یاد می‌گیرد کدام SNIها از منطقه شما کار می‌کنند. ترکیه و ایران الگوهای سانسور متفاوتی دارند — برنامه تطبیق پیدا می‌کند و بهتر می‌شود.',
      'ai.f4.h':  'ارسال تنظیمات از راه دور',
      'ai.f4.p':  'بدون نیاز به به‌روزرسانی برنامه، می‌توان اولویت پروتکل‌ها را تغییر داد. وقتی الگوهای سانسور تغییر می‌کنند، قوانین مسیریابی برای همه کاربران به‌طور خودکار به‌روز می‌شوند.',

      'why.label':      'چرا ستالینک',
      'why.title':      'ساخته‌شده برای سانسور واقعی',
      'why.sub':        'یک پوشش VPN عمومی نیست. از صفر برای واقعیت‌های ایران و ترکیه ساخته شده.',
      'why.tech.label': 'برتری فنی',
      'why.tech.1':     'VLESS + Reality — ترافیکی که از HTTPS استاندارد قابل تشخیص نیست، مقاوم‌ترین پروتکل موجود',
      'why.tech.2':     'پروتکل‌های پشتیبان XHTTP و WebSocket از طریق پروکسی edge nginx، مداوماً آزمایش می‌شوند',
      'why.tech.3':     'بدون لاگ، بدون ثبت‌نام برای دسترسی اضطراری',
      'why.tech.4':     'SNI probing تأیید می‌کند کدام دامنه‌ها از ISP شما کار می‌کنند، قبل از اتصال',
      'why.comm.label': 'مدل جامعه‌محور',
      'why.comm.1':     'کاربران بیشتر = هزینه کمتر برای هر کاربر — زیرساخت مشترک است و شبکه با رشد قوی‌تر می‌شود',
      'why.comm.2':     'پاداش دعوت هم دعوت‌کننده و هم دعوت‌شونده را جایزه می‌دهد — رشد به نفع همه است',
      'why.comm.3':     'پشتیبانی جامعه، نه سرمایه‌گذار — تصمیمات با کاربران همسو می‌ماند',
      'why.comm.4':     'آینده: گسترش سرور با تأمین مالی کاربران — رأی‌گیری برای مناطق و موقعیت‌های جدید',

      'banner.q': '&ldquo;هر کاربر جدید شبکه را <strong>قوی‌تر</strong> و <strong>ارزان‌تر</strong> برای همه می‌کند.&rdquo;',
      'banner.s': 'با رشد شبکه، هزینه زیرساخت به ازای هر کاربر کاهش می‌یابد. با دوستانتان به اشتراک بگذارید.',

      'pricing.label': 'سطوح دسترسی',
      'pricing.title': 'رایگان شروع کن. با هم رشد کن.',
      'pricing.sub':   '۱ گیگابایت پس از نصب، بیشتر از طریق دعوت، سطح داده نامحدود به زودی.',

      'plan.free.eyebrow': 'اضطراری رایگان',
      'plan.free.title':   'بسته شروع',
      'plan.free.desc':    'با نصب APK به‌طور خودکار فعال می‌شود. بدون حساب، بدون لاگین، بدون کارت اعتباری.',
      'plan.free.f1':      'سهمیه ۱ گیگابایت اولیه',
      'plan.free.f2':      'فعال‌سازی خودکار پس از نصب',
      'plan.free.f3':      'انتخاب پروتکل با هوش مصنوعی',
      'plan.free.f4':      'بدون نیاز به حساب',
      'plan.free.cta':     'دانلود APK',

      'plan.comm.eyebrow': 'دعوت‌محور',
      'plan.comm.title':   'جامعه',
      'plan.comm.desc':    'کد دعوت خود را به اشتراک بگذار. هر دوستی که بپیوندد ۵۱۲ مگابایت به هر دویتان اضافه می‌کند.',
      'plan.comm.f1':      '+۵۱۲ مگابایت به ازای هر دوستی که دعوت کنی',
      'plan.comm.f2':      'دعوت‌شونده هم +۵۱۲ مگابایت دریافت می‌کند',
      'plan.comm.f3':      'بدون محدودیت در دعوت',
      'plan.comm.f4':      'شبکه با تو قوی‌تر می‌شود',
      'plan.comm.cta':     'دریافت کد دعوت',

      'plan.prem.eyebrow': 'به زودی',
      'plan.prem.title':   'پریمیوم',
      'plan.prem.desc':    'داده نامحدود، گره‌های اولویت‌دار، کانال‌های پشتیبانی اختصاصی.',
      'plan.prem.f1':      'داده نامحدود',
      'plan.prem.f2':      'گره‌های مسیریابی اولویت‌دار',
      'plan.prem.f3':      'پشتیبانی اختصاصی',
      'plan.prem.f4':      'دسترسی زودهنگام به ویژگی‌ها',
      'plan.prem.cta':     'ثبت‌نام در لیست انتظار',

      'support.label': 'تأمین مالی زیرساخت',
      'support.title': 'از پروژه حمایت کن',
      'support.sub':   'ستالینک روی سرورهای واقعی اجرا می‌شود که هزینه دارند. هر کمکی به افزودن گره‌ها، بهبود پایداری و توسعه به مناطق جدید کمک می‌کند.',
      'support.s1.h':  'هزینه‌های سرور',
      'support.s1.p':  'هاستینگ VPS در نروژ و ترکیه. گره‌های بیشتر = سرعت و پایداری بهتر برای همه کاربران شبکه.',
      'support.s2.h':  'مقاومت در برابر سانسور',
      'support.s2.p':  'پروتکل‌های جدید، چرخش SNI و بهبود پروکسی edge نیاز به زمان توسعه دارند. تأمین مالی کار را ادامه می‌دهد.',
      'support.s3.h':  'چطور کمک کنیم',
      'support.s3.p':  'اپ را با دوستان به اشتراک بگذار (داده کسب کن)، در GitHub کد مشارکت کن، یا از طریق تلگرام با ما تماس بگیر.',

      'comm.tg.h': 'گروه تلگرام',
      'comm.tg.p': 'سوال بپرسید، مشکلات را گزارش دهید، کد دعوت دریافت کنید و از آخرین نسخه‌ها مطلع شوید.',
      'comm.gh.h': 'گیت‌هاب',
      'comm.gh.p': 'توسعه را دنبال کنید، کد مشارکت کنید یا باگ گزارش دهید. بدون ادعای امنیتی جعبه‌سیاه.',

      'faq.label': 'سوالات متداول',
      'faq.title': 'سوالات رایج',
      'faq.sub':   'سوالات واقعی درباره نحوه عملکرد ستالینک.',

      'footer.faq': 'سوالات کامل',
      'footer.tg':  'تلگرام',
      'footer.gh':  'گیت‌هاب',
      'footer.dl':  'دانلود APK',
    }
  };

  var lang = localStorage.getItem('sl-lang') || 'en';

  function applyLang(l) {
    lang = l;
    localStorage.setItem('sl-lang', l);
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('dir', l === 'fa' ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', l === 'fa' ? 'rtl' : 'ltr');
    var s = STRINGS[l];
    document.querySelectorAll('[data-t]').forEach(function(el) {
      var key = el.dataset.t;
      if (s[key] !== undefined) el.innerHTML = s[key];
    });
  }

  function initLangToggle() {
    var btn = document.getElementById('btn-lang');
    if (!btn) return;
    btn.addEventListener('click', function() {
      applyLang(lang === 'en' ? 'fa' : 'en');
    });
  }

  function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(function(item) {
      var btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function(o) {
          o.classList.remove('open');
          var ob = o.querySelector('.faq-q');
          if (ob) ob.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    initLangToggle();
    initFAQ();
    applyLang(lang);
  });
})();
