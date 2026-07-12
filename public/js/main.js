(function () {
  'use strict';

  // ── UI languages ────────────────────────────────────────────────────────────
  // English + the three censored-region locales the app also ships: Farsi (Iran),
  // Chinese (mainland / GFW) and Russian. Farsi is the only RTL member.
  var LANGS   = ['en', 'fa', 'zh', 'ru'];
  var LANG_NAMES = { en: 'English', fa: 'فارسی', zh: '中文', ru: 'Русский' };
  var RTL_LANGS = { fa: true };

  var STRINGS = {
    en: {
      'nav.dl':   'Download',

      'hero.badge': 'Servers online — secure global nodes',
      'hero.h1a':   'Free Anti-Censorship VPN',
      'hero.h1b':   'Internet Freedom for Everyone',
      'hero.sub':   'AI-powered private network that keeps your games, apps and community online on slow, throttled or restricted connections. VLESS+Reality &amp; V2Ray. Now on Android &amp; iOS. 5 GB free on install. No account, no server setup.',
      'hero.cta1':  'Download for Android',
      'hero.cta_ios': 'iOS — TestFlight Beta',

      'dl.card1.tag': '✓ Recommended',
      'dl.card1.h':   'Modern phones (64-bit)',
      'dl.card1.p':   'Most phones from 2018+ — Samsung A/S, Xiaomi, Poco, Huawei. Smallest download.',
      'dl.card2.tag': 'Older phones',
      'dl.card2.h':   '32-bit devices',
      'dl.card2.p':   'Samsung J-series and phones before ~2018. Use this if you see "App not installed".',
      'dl.card3.tag': 'Not sure?',
      'dl.card3.h':   'Universal APK',
      'dl.card3.p':   'Works on every Android device. Larger file — pick this when in doubt.',

      'shah.label':   'COMMUNITY GAME',
      'shah.title':   'Play Shahnameh — connect &amp; earn REAL',
      'shah.sub':     'Realink keeps the Shahnameh game and REAL community reachable. Connect, battle as a warrior, and earn REAL rewards — even when the game runs slow or won\'t load.',
      'shah.cta':     'Play on Telegram',

      'stat.members':   'Members &amp; growing',
      'stat.countries': 'Countries reached',
      'stat.platforms': 'Both platforms',
      'stat.free':      'Free on install',

      'how.label': 'HOW IT WORKS',
      'how.title': 'Three Steps to Get Online',
      'how.sub':   'No account, no credit card, no configuration. Install and connect.',
      'how.s1.h':  'Emergency Access',
      'how.s1.p':  'Install the app and get 5 GB instantly — no login, no account. Tap Connect and the AI selects the fastest working protocol for your network.',
      'how.s2.h':  'Invite &amp; Earn Data',
      'how.s2.p':  'Share your referral code. Every person who joins adds data to both of you. The more people connect, the stronger and cheaper the network becomes.',
      'how.s3.h':  'AI Picks Best Route',
      'how.s3.p':  'Reality, XHTTP, and WebSocket are tested in parallel. Only a path that returns real HTTP data is declared connected — no fake “connected” states.',

      'ai.label': 'INTELLIGENT ROUTING',
      'ai.title': 'Not Just a Tunnel',
      'ai.sub':   'Realink actively validates every connection and picks the best path — every single time.',
      'ai.f1.h':  'AI Protocol Optimizer',
      'ai.f1.p':  'Tests Reality, XHTTP, and WebSocket in parallel. Selects the fastest protocol that actually delivers internet — not the last one that worked, the one that works right now.',
      'ai.f2.h':  'Real Internet Validation',
      'ai.f2.p':  'TCP-connected is not enough. The app sends an actual HTTP/HTTPS request and verifies real data is received before declaring you connected. Fake states are rejected hard.',
      'ai.f3.h':  'Adaptive Routing',
      'ai.f3.p':  'The network learns which SNIs work from your region. Different networks have different blocking patterns — the app adapts and remembers what works where, improving over time.',
      'ai.f4.h':  'Remote Config Push',
      'ai.f4.p':  'Admin can push protocol priority updates without requiring an app update. When network blocking patterns change, routing rules are updated automatically for all users.',

      'why.label':      'WHY REALINK',
      'why.title':      'Built for Real-World Networks',
      'why.sub':        'Not a generic VPN wrapper. Engineered from scratch to keep your games, apps and community online on slow, throttled or restricted networks.',
      'why.tech.label': 'TECHNICAL EXCELLENCE',
      'why.tech.1':     'VLESS + Reality — traffic indistinguishable from standard HTTPS, the most censorship-resistant protocol available',
      'why.tech.2':     'XHTTP and WebSocket fallback transports via nginx edge proxy, plus a Cloudflare stealth edge, tested continuously',
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
      'pricing.sub':   '5 GB on install, more via referrals, unlimited data tier coming soon.',

      'plan.free.eyebrow': 'FREE EMERGENCY',
      'plan.free.title':   'Starter Pack',
      'plan.free.desc':    'Auto-activated when you install the app. No account, no login, no credit card.',
      'plan.free.f1':      '5 GB starter quota',
      'plan.free.f2':      'Auto-activated on install',
      'plan.free.f3':      'AI protocol selection',
      'plan.free.f4':      'No account needed',
      'plan.free.cta':     'Download',

      'plan.comm.eyebrow': 'INVITE-BASED',
      'plan.comm.title':   'Community',
      'plan.comm.desc':    'Share your referral code. Every friend who joins gives both of you extra data.',
      'plan.comm.f1':      'Bonus data per friend invited',
      'plan.comm.f2':      'Invitee also receives a bonus',
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
      'support.sub':   'Realink runs on real servers that cost real money. Every contribution helps add nodes, improve reliability, and expand to new regions.',
      'support.s1.h':  'Server Costs',
      'support.s1.p':  'Secure VPS infrastructure. More nodes = better speed and resilience for every user in the network.',
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
      'faq.sub':   'Real questions about how Realink actually works.',

      'footer.faq':       'Full FAQ',
      'footer.tg':        'Telegram',
      'footer.gh':        'GitHub',
      'footer.dl':        'Download',
      'footer.setai':     'SetAI',
      'footer.platforms': 'Android &amp; iOS',
      'footer.by':        'a project by',
    },

    fa: {
      'nav.dl':   'دانلود',

      'hero.badge': 'سرورها فعال — گره‌های امن جهانی',
      'hero.h1a':   'فیلترشکن رایگان و پرسرعت',
      'hero.h1b':   'اینترنت آزاد برای همه',
      'hero.sub':   'شبکه خصوصی هوشمند مبتنی بر هوش مصنوعی که بازی‌ها، اپ‌ها و جامعه‌ات را روی اتصال‌های کند، محدود یا مسدود آنلاین نگه می‌دارد. VLESS+Reality و V2Ray. اکنون روی اندروید و آیفون (iOS). ۵ گیگابایت رایگان پس از نصب، بدون ثبت‌نام.',
      'hero.cta1':  'دانلود برای اندروید',
      'hero.cta_ios': 'iOS — نسخه بتای TestFlight',

      'dl.card1.tag': '✓ پیشنهادی',
      'dl.card1.h':   'گوشی‌های جدید (۶۴ بیت)',
      'dl.card1.p':   'اکثر گوشی‌های ۲۰۱۸ به بعد — سامسونگ A/S، شیائومی، پوکو، هواوی. کم‌حجم‌ترین نسخه.',
      'dl.card2.tag': 'گوشی‌های قدیمی',
      'dl.card2.h':   'دستگاه‌های ۳۲ بیت',
      'dl.card2.p':   'سامسونگ سری J و گوشی‌های قبل از ~۲۰۱۸. اگر «برنامه نصب نشد» دیدید این را بگیرید.',
      'dl.card3.tag': 'مطمئن نیستید؟',
      'dl.card3.h':   'نسخه یونیورسال',
      'dl.card3.p':   'روی همه دستگاه‌های اندروید کار می‌کند. حجم بیشتر — در صورت شک این را انتخاب کنید.',

      'shah.label':   'بازی جامعه',
      'shah.title':   'شاهنامه بازی کن — وصل شو و REAL بگیر',
      'shah.sub':     'ری‌لینک بازی شاهنامه و جامعه REAL را در دسترس نگه می‌دارد. وصل شو، به‌عنوان پهلوان مبارزه کن و جایزه REAL بگیر — حتی وقتی بازی کند است یا باز نمی‌شود.',
      'shah.cta':     'بازی در تلگرام',

      'stat.members':   'کاربر و در حال رشد',
      'stat.countries': 'کشور تحت پوشش',
      'stat.platforms': 'هر دو پلتفرم',
      'stat.free':      'رایگان پس از نصب',

      'how.label': 'چطور کار می‌کند',
      'how.title': 'سه گام تا آنلاین شدن',
      'how.sub':   'بدون حساب، بدون کارت اعتباری، بدون تنظیمات. نصب کن و وصل شو.',
      'how.s1.h':  'دسترسی اضطراری',
      'how.s1.p':  'برنامه را نصب کن و فوری ۵ گیگابایت بگیر — بدون لاگین، بدون حساب. Connect را بزن و هوش مصنوعی سریع‌ترین پروتکل را انتخاب می‌کند.',
      'how.s2.h':  'دعوت و کسب داده',
      'how.s2.p':  'کد دعوت خود را به اشتراک بگذار. هر کسی که بپیوندد به هر دوی شما داده اضافه می‌کند. هرچه بیشتر وصل شوند، شبکه قوی‌تر و ارزان‌تر می‌شود.',
      'how.s3.h':  'هوش مصنوعی بهترین مسیر را انتخاب می‌کند',
      'how.s3.p':  'Reality، XHTTP و WebSocket به صورت موازی آزمایش می‌شوند. تنها مسیری که داده HTTP واقعی برمی‌گرداند متصل اعلام می‌شود — هیچ وضعیت متصل جعلی وجود ندارد.',

      'ai.label': 'مسیریابی هوشمند',
      'ai.title': 'فقط یک تونل نیست',
      'ai.sub':   'ری‌لینک هر اتصال را فعالانه اعتبارسنجی می‌کند و هر بار بهترین مسیر را انتخاب می‌کند.',
      'ai.f1.h':  'بهینه‌ساز پروتکل با هوش مصنوعی',
      'ai.f1.p':  'Reality، XHTTP و WebSocket را به صورت موازی آزمایش می‌کند. سریع‌ترین پروتکلی که اینترنت واقعی ارائه می‌دهد انتخاب می‌شود — نه آنچه قبلاً کار می‌کرد، آنچه الان کار می‌کند.',
      'ai.f2.h':  'اعتبارسنجی اینترنت واقعی',
      'ai.f2.p':  'اتصال TCP کافی نیست. برنامه یک درخواست HTTP/HTTPS واقعی ارسال می‌کند و تأیید می‌کند داده واقعی دریافت شده — قبل از اعلام اتصال. وضعیت‌های جعلی رد می‌شوند.',
      'ai.f3.h':  'مسیریابی تطبیقی',
      'ai.f3.p':  'شبکه یاد می‌گیرد کدام SNIها از منطقه شما کار می‌کنند. شبکه‌های مختلف الگوهای سانسور متفاوتی دارند — برنامه تطبیق پیدا می‌کند و بهتر می‌شود.',
      'ai.f4.h':  'ارسال تنظیمات از راه دور',
      'ai.f4.p':  'بدون نیاز به به‌روزرسانی برنامه، می‌توان اولویت پروتکل‌ها را تغییر داد. وقتی الگوهای مسدودسازی شبکه تغییر می‌کنند، قوانین مسیریابی برای همه کاربران به‌طور خودکار به‌روز می‌شوند.',

      'why.label':      'چرا ری‌لینک',
      'why.title':      'ساخته‌شده برای شبکه‌های واقعی',
      'why.sub':        'یک پوشش VPN عمومی نیست. از پایه ساخته شده تا بازی‌ها، اپ‌ها و جامعه‌ات را روی شبکه‌های کند، محدود یا مسدود آنلاین نگه دارد.',
      'why.tech.label': 'برتری فنی',
      'why.tech.1':     'VLESS + Reality — ترافیکی که از HTTPS استاندارد قابل تشخیص نیست، مقاوم‌ترین پروتکل موجود',
      'why.tech.2':     'پروتکل‌های پشتیبان XHTTP و WebSocket از طریق پروکسی edge nginx و یک گره مخفی Cloudflare، مداوماً آزمایش می‌شوند',
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
      'pricing.title': 'رایگان شروع کن، با هم رشد کنیم',
      'pricing.sub':   '۵ گیگابایت پس از نصب، بیشتر از طریق دعوت، سطح داده نامحدود به زودی.',

      'plan.free.eyebrow': 'اضطراری رایگان',
      'plan.free.title':   'بسته شروع',
      'plan.free.desc':    'با نصب برنامه به‌طور خودکار فعال می‌شود. بدون حساب، بدون لاگین، بدون کارت اعتباری.',
      'plan.free.f1':      'سهمیه ۵ گیگابایت اولیه',
      'plan.free.f2':      'فعال‌سازی خودکار پس از نصب',
      'plan.free.f3':      'انتخاب پروتکل با هوش مصنوعی',
      'plan.free.f4':      'بدون نیاز به حساب',
      'plan.free.cta':     'دانلود',

      'plan.comm.eyebrow': 'دعوت‌محور',
      'plan.comm.title':   'جامعه',
      'plan.comm.desc':    'کد دعوت خود را به اشتراک بگذار. هر دوستی که بپیوندد به هر دویتان داده اضافه می‌دهد.',
      'plan.comm.f1':      'داده جایزه به ازای هر دوست دعوت‌شده',
      'plan.comm.f2':      'دعوت‌شونده هم جایزه می‌گیرد',
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
      'support.sub':   'ری‌لینک روی سرورهای واقعی اجرا می‌شود که هزینه دارند. هر کمکی به افزودن گره‌ها، بهبود پایداری و توسعه به مناطق جدید کمک می‌کند.',
      'support.s1.h':  'هزینه‌های سرور',
      'support.s1.p':  'زیرساخت امن VPS. گره‌های بیشتر = سرعت و پایداری بهتر برای همه کاربران شبکه.',
      'support.s2.h':  'مقاومت در برابر سانسور',
      'support.s2.p':  'پروتکل‌های جدید، چرخش SNI و بهبود پروکسی edge نیاز به زمان توسعه دارند. تأمین مالی کار را ادامه می‌دهد.',
      'support.s3.h':  'چطور کمک کنیم',
      'support.s3.p':  'اپ را با دوستان به اشتراک بگذار (داده کسب کن)، در GitHub کد مشارکت کن، یا از طریق تلگرام با ما تماس بگیر.',

      'comm.tg.h': 'گروه تلگرام',
      'comm.tg.p': 'سوال بپرسید، مشکلات را گزارش دهید، کد دعوت دریافت کنید و از آخرین نسخه‌ها مطلع شوید.',
      'comm.gh.h': 'گیت‌هاب',
      'comm.gh.p': 'توسعه را دنبال کنید، کد مشارکت کنید یا باگ گزارش دهید. بدون ادعای امنیتی جعبه‌سیاه.',

      'faq.label': 'سوالات متداول',
      'faq.title': 'سؤالات پرتکرار',
      'faq.sub':   'سوالات واقعی درباره نحوه عملکرد ری‌لینک.',

      'footer.faq':       'سوالات کامل',
      'footer.tg':        'تلگرام',
      'footer.gh':        'گیت‌هاب',
      'footer.dl':        'دانلود',
      'footer.setai':     'ست‌ای',
      'footer.platforms': 'اندروید و iOS',
      'footer.by':        'پروژه‌ای از',
    },

    zh: {
      'nav.dl':   '下载',

      'hero.badge': '服务器在线 — 安全的全球节点',
      'hero.h1a':   '免费翻墙 VPN',
      'hero.h1b':   '人人享有自由互联网',
      'hero.sub':   '基于 AI 的智能私有网络，让你的游戏、应用和社区在缓慢、受限或被封锁的连接上保持在线。VLESS+Reality 与 V2Ray。现已支持安卓和 iOS。安装即送 5 GB，无需账号，无需配置。',
      'hero.cta1':  '下载安卓版',
      'hero.cta_ios': 'iOS — TestFlight 测试版',

      'dl.card1.tag': '✓ 推荐',
      'dl.card1.h':   '新款手机（64 位）',
      'dl.card1.p':   '2018 年后的大多数手机 — 三星 A/S、小米、Poco、华为。文件最小。',
      'dl.card2.tag': '旧款手机',
      'dl.card2.h':   '32 位设备',
      'dl.card2.p':   '三星 J 系列及 2018 年前的手机。若提示"未安装应用"请选此项。',
      'dl.card3.tag': '不确定？',
      'dl.card3.h':   '通用 APK',
      'dl.card3.p':   '适用于所有安卓设备。文件较大 — 拿不准时选它。',

      'shah.label':   '社区游戏',
      'shah.title':   '玩《列王纪》— 连接并赚取 REAL',
      'shah.sub':     'Realink 让《列王纪》游戏和 REAL 社区始终可达。连接后化身勇士战斗，赢取 REAL 奖励 — 即使游戏缓慢或打不开。',
      'shah.cta':     '在 Telegram 上玩',

      'stat.members':   '用户并持续增长',
      'stat.countries': '已覆盖国家',
      'stat.platforms': '双平台支持',
      'stat.free':      '安装即免费',

      'how.label': '工作原理',
      'how.title': '三步即可上线',
      'how.sub':   '无需账号、无需信用卡、无需配置。安装即连。',
      'how.s1.h':  '紧急接入',
      'how.s1.p':  '安装应用立即获得 5 GB — 无需登录，无需账号。点击连接，AI 会为你的网络选出最快可用的协议。',
      'how.s2.h':  '邀请好友，赚取流量',
      'how.s2.p':  '分享你的邀请码。每有一人加入，双方都会获得额外流量。连接的人越多，网络就越强、越便宜。',
      'how.s3.h':  'AI 选择最佳线路',
      'how.s3.p':  'Reality、XHTTP 和 WebSocket 并行测试。只有能返回真实 HTTP 数据的线路才判定为已连接 — 绝无虚假的"已连接"状态。',

      'ai.label': '智能路由',
      'ai.title': '不只是一条隧道',
      'ai.sub':   'Realink 会主动验证每一次连接，每一次都为你选出最佳线路。',
      'ai.f1.h':  'AI 协议优化器',
      'ai.f1.p':  '并行测试 Reality、XHTTP 和 WebSocket。选出真正能上网的最快协议 — 不是上次能用的那个，而是此刻能用的那个。',
      'ai.f2.h':  '真实联网验证',
      'ai.f2.p':  'TCP 连上还不够。应用会发送真实的 HTTP/HTTPS 请求，确认收到真实数据后才判定为已连接。虚假状态一律拒绝。',
      'ai.f3.h':  '自适应路由',
      'ai.f3.p':  '网络会学习哪些 SNI 在你所在地区可用。不同网络封锁模式不同 — 应用会自适应并记住各地可用方案，越用越好。',
      'ai.f4.h':  '远程配置推送',
      'ai.f4.p':  '无需更新应用即可推送协议优先级更新。当网络封锁模式变化时，路由规则会自动为所有用户更新。',

      'why.label':      '为何选择 REALINK',
      'why.title':      '为真实网络而打造',
      'why.sub':        '不是通用 VPN 的套壳。从零打造，让你的游戏、应用和社区在缓慢、受限或被封锁的网络上保持在线。',
      'why.tech.label': '技术优势',
      'why.tech.1':     'VLESS + Reality — 流量与标准 HTTPS 无法区分，是目前最抗审查的协议',
      'why.tech.2':     '通过 nginx 边缘代理的 XHTTP 与 WebSocket 备用传输，外加 Cloudflare 隐身节点，持续测试',
      'why.tech.3':     '无日志，获取紧急接入无需注册账号',
      'why.tech.4':     'SNI 探测在连接前确认哪些域名在你的运营商网络下可用',
      'why.comm.label': '社区模式',
      'why.comm.1':     '用户越多，人均成本越低 — 基础设施共享，网络随规模增长而更强',
      'why.comm.2':     '邀请奖励同时回馈邀请者和被邀请者 — 增长惠及所有人',
      'why.comm.3':     '由社区支持，而非风投注资 — 决策始终与用户一致，而非投资人',
      'why.comm.4':     '未来：由用户出资扩展服务器 — 对新地区和节点位置进行投票',

      'banner.q': '&ldquo;每一位新用户都让网络对所有人<strong>更强</strong>、<strong>更便宜</strong>。&rdquo;',
      'banner.s': '随着网络增长，人均基础设施成本下降。分享给朋友吧。',

      'pricing.label': '接入等级',
      'pricing.title': '免费开始，一起成长',
      'pricing.sub':   '安装送 5 GB，邀请得更多，无限流量套餐即将推出。',

      'plan.free.eyebrow': '免费紧急版',
      'plan.free.title':   '入门包',
      'plan.free.desc':    '安装应用即自动激活。无需账号、无需登录、无需信用卡。',
      'plan.free.f1':      '5 GB 初始额度',
      'plan.free.f2':      '安装即自动激活',
      'plan.free.f3':      'AI 协议选择',
      'plan.free.f4':      '无需账号',
      'plan.free.cta':     '下载',

      'plan.comm.eyebrow': '邀请制',
      'plan.comm.title':   '社区',
      'plan.comm.desc':    '分享你的邀请码。每有一位好友加入，双方都获得额外流量。',
      'plan.comm.f1':      '每邀请一位好友得奖励流量',
      'plan.comm.f2':      '被邀请者同样获得奖励',
      'plan.comm.f3':      '邀请无上限',
      'plan.comm.f4':      '网络因你而更强',
      'plan.comm.cta':     '获取邀请码',

      'plan.prem.eyebrow': '即将推出',
      'plan.prem.title':   '高级版',
      'plan.prem.desc':    '无限流量、优先节点、专属支持渠道。',
      'plan.prem.f1':      '无限流量',
      'plan.prem.f2':      '优先路由节点',
      'plan.prem.f3':      '专属支持',
      'plan.prem.f4':      '功能抢先体验',
      'plan.prem.cta':     '加入候补名单',

      'support.label': '基础设施筹资',
      'support.title': '支持这个项目',
      'support.sub':   'Realink 运行在真实、需要花钱的服务器上。每一份贡献都有助于增加节点、提升稳定性并拓展到新地区。',
      'support.s1.h':  '服务器成本',
      'support.s1.p':  '安全的 VPS 基础设施。节点越多，网络中每位用户的速度与韧性就越好。',
      'support.s2.h':  '抗审查韧性',
      'support.s2.p':  '新协议、SNI 轮换和边缘代理改进都需要开发时间。筹资让工作得以持续。',
      'support.s3.h':  '如何帮忙',
      'support.s3.p':  '把应用分享给朋友（赚流量）、在 GitHub 上贡献代码，或通过 Telegram 联系我们商谈基础设施赞助。',

      'comm.tg.h': 'Telegram 群组',
      'comm.tg.p': '提问、反馈问题、获取邀请码，并及时了解新版本。主要支持渠道。',
      'comm.gh.h': 'GitHub',
      'comm.gh.p': '关注开发、贡献代码或反馈缺陷。开放社区审查 — 没有黑箱式的安全承诺。',

      'faq.label': '常见问题',
      'faq.title': '常见问题',
      'faq.sub':   '关于 Realink 实际如何工作的真实问题。',

      'footer.faq':       '完整常见问题',
      'footer.tg':        'Telegram',
      'footer.gh':        'GitHub',
      'footer.dl':        '下载',
      'footer.setai':     'SetAI',
      'footer.platforms': '安卓和 iOS',
      'footer.by':        '出品方',
    },

    ru: {
      'nav.dl':   'Скачать',

      'hero.badge': 'Серверы онлайн — защищённые узлы',
      'hero.h1a':   'Бесплатный VPN',
      'hero.h1b':   'Свободный интернет для всех',
      'hero.sub':   'Приватная сеть на базе ИИ, которая держит ваши игры, приложения и сообщество онлайн на медленных, ограниченных или заблокированных соединениях. VLESS+Reality и V2Ray. Теперь на Android и iOS. 5 ГБ бесплатно при установке. Без аккаунта.',
      'hero.cta1':  'Скачать для Android',
      'hero.cta_ios': 'iOS — бета в TestFlight',

      'dl.card1.tag': '✓ Рекомендуется',
      'dl.card1.h':   'Современные телефоны (64-бит)',
      'dl.card1.p':   'Большинство телефонов с 2018 г. — Samsung A/S, Xiaomi, Poco, Huawei. Самый лёгкий файл.',
      'dl.card2.tag': 'Старые телефоны',
      'dl.card2.h':   '32-битные устройства',
      'dl.card2.p':   'Samsung серии J и телефоны до ~2018 г. Выберите это, если видите «Приложение не установлено».',
      'dl.card3.tag': 'Не уверены?',
      'dl.card3.h':   'Универсальный APK',
      'dl.card3.p':   'Работает на любом Android-устройстве. Файл больше — берите его при сомнениях.',

      'shah.label':   'ИГРА СООБЩЕСТВА',
      'shah.title':   'Играй в «Шахнаме» — подключись и зарабатывай REAL',
      'shah.sub':     'Realink держит игру «Шахнаме» и сообщество REAL доступными. Подключись, сражайся как воин и получай награды REAL — даже когда игра тормозит или не открывается.',
      'shah.cta':     'Играть в Telegram',

      'stat.members':   'участников и растёт',
      'stat.countries': 'стран охвачено',
      'stat.platforms': 'Обе платформы',
      'stat.free':      'Бесплатно при установке',

      'how.label': 'КАК ЭТО РАБОТАЕТ',
      'how.title': 'Три шага, чтобы выйти в сеть',
      'how.sub':   'Без аккаунта, без карты, без настройки. Установите и подключитесь.',
      'how.s1.h':  'Экстренный доступ',
      'how.s1.p':  'Установите приложение и сразу получите 5 ГБ — без входа и аккаунта. Нажмите «Подключить», и ИИ выберет самый быстрый рабочий протокол для вашей сети.',
      'how.s2.h':  'Приглашай и получай трафик',
      'how.s2.p':  'Поделитесь своим реферальным кодом. Каждый присоединившийся добавляет трафик вам обоим. Чем больше людей подключается, тем сеть сильнее и дешевле.',
      'how.s3.h':  'ИИ выбирает лучший маршрут',
      'how.s3.p':  'Reality, XHTTP и WebSocket проверяются параллельно. Подключённым считается только маршрут, вернувший реальные HTTP-данные — никаких ложных статусов «подключено».',

      'ai.label': 'ИНТЕЛЛЕКТУАЛЬНАЯ МАРШРУТИЗАЦИЯ',
      'ai.title': 'Не просто туннель',
      'ai.sub':   'Realink активно проверяет каждое соединение и всякий раз выбирает лучший путь.',
      'ai.f1.h':  'ИИ-оптимизатор протоколов',
      'ai.f1.p':  'Параллельно тестирует Reality, XHTTP и WebSocket. Выбирает самый быстрый протокол, который реально даёт интернет — не тот, что работал в прошлый раз, а тот, что работает сейчас.',
      'ai.f2.h':  'Проверка реального интернета',
      'ai.f2.p':  'Подключения по TCP недостаточно. Приложение отправляет настоящий HTTP/HTTPS-запрос и убеждается в получении реальных данных, прежде чем сообщить о подключении. Ложные статусы жёстко отклоняются.',
      'ai.f3.h':  'Адаптивная маршрутизация',
      'ai.f3.p':  'Сеть узнаёт, какие SNI работают в вашем регионе. У разных сетей разные схемы блокировок — приложение адаптируется и запоминает, что где работает, улучшаясь со временем.',
      'ai.f4.h':  'Удалённое обновление конфигурации',
      'ai.f4.p':  'Администратор может обновлять приоритет протоколов без обновления приложения. Когда меняются схемы сетевых блокировок, правила маршрутизации автоматически обновляются для всех.',

      'why.label':      'ПОЧЕМУ REALINK',
      'why.title':      'Создан для реальных сетей',
      'why.sub':        'Не обёртка над обычным VPN. Создан с нуля, чтобы держать ваши игры, приложения и сообщество онлайн на медленных, ограниченных или заблокированных сетях.',
      'why.tech.label': 'ТЕХНИЧЕСКОЕ ПРЕВОСХОДСТВО',
      'why.tech.1':     'VLESS + Reality — трафик неотличим от обычного HTTPS, самый устойчивый к цензуре протокол',
      'why.tech.2':     'Резервные транспорты XHTTP и WebSocket через пограничный прокси nginx плюс скрытый узел Cloudflare, постоянно тестируются',
      'why.tech.3':     'Без логов, без регистрации для экстренного доступа',
      'why.tech.4':     'Проверка SNI подтверждает, какие домены работают у вашего провайдера, ещё до подключения',
      'why.comm.label': 'МОДЕЛЬ СООБЩЕСТВА',
      'why.comm.1':     'Больше пользователей = ниже стоимость на каждого — инфраструктура общая, и сеть крепнет с ростом',
      'why.comm.2':     'Реферальные бонусы вознаграждают и пригласившего, и приглашённого — рост выгоден всем',
      'why.comm.3':     'На поддержке сообщества, а не венчурных денег — решения в интересах пользователей, а не инвесторов',
      'why.comm.4':     'В будущем: расширение серверов на средства пользователей — голосование за новые регионы и узлы',

      'banner.q': '&ldquo;Каждый новый пользователь делает сеть <strong>сильнее</strong> и <strong>дешевле</strong> для всех.&rdquo;',
      'banner.s': 'По мере роста сети инфраструктурные затраты на пользователя снижаются. Поделитесь с друзьями.',

      'pricing.label': 'УРОВНИ ДОСТУПА',
      'pricing.title': 'Начните бесплатно. Растите вместе.',
      'pricing.sub':   '5 ГБ при установке, больше — за приглашения, тариф с безлимитом скоро.',

      'plan.free.eyebrow': 'БЕСПЛАТНЫЙ ЭКСТРЕННЫЙ',
      'plan.free.title':   'Стартовый пакет',
      'plan.free.desc':    'Активируется автоматически при установке. Без аккаунта, входа и карты.',
      'plan.free.f1':      'Стартовая квота 5 ГБ',
      'plan.free.f2':      'Автоактивация при установке',
      'plan.free.f3':      'ИИ-выбор протокола',
      'plan.free.f4':      'Аккаунт не нужен',
      'plan.free.cta':     'Скачать',

      'plan.comm.eyebrow': 'ПО ПРИГЛАШЕНИЮ',
      'plan.comm.title':   'Сообщество',
      'plan.comm.desc':    'Поделитесь реферальным кодом. Каждый присоединившийся друг даёт трафик вам обоим.',
      'plan.comm.f1':      'Бонусный трафик за каждого друга',
      'plan.comm.f2':      'Приглашённый тоже получает бонус',
      'plan.comm.f3':      'Без лимита на приглашения',
      'plan.comm.f4':      'Сеть крепнет вместе с вами',
      'plan.comm.cta':     'Получить код приглашения',

      'plan.prem.eyebrow': 'СКОРО',
      'plan.prem.title':   'Премиум',
      'plan.prem.desc':    'Безлимитный трафик, приоритетные узлы, отдельные каналы поддержки.',
      'plan.prem.f1':      'Безлимитный трафик',
      'plan.prem.f2':      'Приоритетные узлы маршрутизации',
      'plan.prem.f3':      'Выделенная поддержка',
      'plan.prem.f4':      'Ранний доступ к функциям',
      'plan.prem.cta':     'В список ожидания',

      'support.label': 'ФИНАНСИРОВАНИЕ ИНФРАСТРУКТУРЫ',
      'support.title': 'Поддержите проект',
      'support.sub':   'Realink работает на реальных серверах, которые стоят реальных денег. Каждый вклад помогает добавлять узлы, повышать надёжность и выходить в новые регионы.',
      'support.s1.h':  'Затраты на серверы',
      'support.s1.p':  'Защищённая VPS-инфраструктура. Больше узлов = выше скорость и устойчивость для каждого пользователя сети.',
      'support.s2.h':  'Устойчивость к цензуре',
      'support.s2.p':  'Новые протоколы, ротация SNI и улучшения пограничного прокси требуют времени разработки. Финансирование поддерживает работу.',
      'support.s3.h':  'Как помочь',
      'support.s3.p':  'Поделитесь приложением с друзьями (получите трафик), внесите код на GitHub или напишите нам в Telegram по поводу спонсорства инфраструктуры.',

      'comm.tg.h': 'Группа в Telegram',
      'comm.tg.p': 'Задавайте вопросы, сообщайте о проблемах, получайте реферальный код и следите за новыми версиями. Основной канал поддержки.',
      'comm.gh.h': 'GitHub',
      'comm.gh.p': 'Следите за разработкой, вносите код или сообщайте об ошибках. Открыто для проверки сообществом — никаких «чёрных ящиков».',

      'faq.label': 'ЧАСТЫЕ ВОПРОСЫ',
      'faq.title': 'Частые вопросы',
      'faq.sub':   'Реальные вопросы о том, как на самом деле работает Realink.',

      'footer.faq':       'Полный FAQ',
      'footer.tg':        'Telegram',
      'footer.gh':        'GitHub',
      'footer.dl':        'Скачать',
      'footer.setai':     'SetAI',
      'footer.platforms': 'Android и iOS',
      'footer.by':        'проект от',
    }
  };

  // Server renders an initial language from ?lang=; when that query param is
  // present it wins for this pageload (SEO / deep-link). Otherwise the visitor's
  // saved choice wins, falling back to the server default (English).
  var serverLang = (typeof window.__SL_LANG__ === 'string') ? window.__SL_LANG__ : 'en';
  var langLocked = window.__SL_LANG_LOCKED__ === true;
  var stored     = localStorage.getItem('sl-lang');
  var lang = langLocked ? serverLang
           : (LANGS.indexOf(stored) >= 0 ? stored : serverLang);
  if (LANGS.indexOf(lang) < 0) lang = 'en';

  function trackEvent(name, params) {
    if (typeof gtag === 'function') { gtag('event', name, params || {}); }
  }

  function applyLang(l) {
    if (LANGS.indexOf(l) < 0) l = 'en';
    lang = l;
    localStorage.setItem('sl-lang', l);
    var isRtl = !!RTL_LANGS[l];
    document.documentElement.setAttribute('lang', l);
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.body.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    var s = STRINGS[l] || STRINGS['en'];
    document.querySelectorAll('[data-t]').forEach(function (el) {
      var key = el.getAttribute('data-t');
      if (s[key] !== undefined) el.innerHTML = s[key];
    });
    var lbl = document.getElementById('btn-lang-text');
    if (lbl) lbl.textContent = LANG_NAMES[l];
    document.querySelectorAll('.lang-opt').forEach(function (o) {
      o.setAttribute('aria-current', o.getAttribute('data-lang') === l ? 'true' : 'false');
    });
  }

  function initLangPicker() {
    var picker = document.getElementById('lang-picker');
    var btn    = document.getElementById('btn-lang');
    var menu   = document.getElementById('lang-menu');
    if (!picker || !btn || !menu) return;

    function close() { picker.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function open()  { picker.classList.add('open');    btn.setAttribute('aria-expanded', 'true'); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (picker.classList.contains('open')) { close(); } else { open(); }
    });
    menu.querySelectorAll('.lang-opt').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var l = opt.getAttribute('data-lang');
        var from = lang;
        applyLang(l);
        close();
        trackEvent('lang_switch', { from: from, to: l });
      });
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(function (item) {
      var btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function (o) {
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

  function initDownloadTracking() {
    document.querySelectorAll('a[href*=".apk"]').forEach(function (a) {
      a.addEventListener('click', function () {
        trackEvent('apk_download', { label: a.href });
      });
    });
  }

  // ── Live member / country counters ──────────────────────────────────────────
  // Polls the public aggregate endpoint and counts UP to the real value so the
  // hero shows a living, honest number. No fabricated figures — everything comes
  // straight from /stats.php (real device + country counts).
  function animateCount(el, to) {
    if (!el || typeof to !== 'number' || to < 0) return;
    var from = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (from === to) return;
    el.setAttribute('data-count', String(to));
    var live = el.classList.contains('hero-stat-live');
    var dot  = live ? '<span class="dot-live" style="width:8px;height:8px;margin-inline-end:6px"></span>' : '';
    var start = performance.now(), dur = 900;
    function frame(now) {
      var p = Math.min(1, (now - start) / dur);
      var v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      el.innerHTML = dot + v.toLocaleString();
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function refreshStats() {
    fetch('/stats.php', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.members == null) return;
        animateCount(document.getElementById('stat-members'), d.members | 0);
        animateCount(document.getElementById('stat-countries'), d.countries | 0);
      })
      .catch(function () { /* offline / blocked — keep the last shown value */ });
  }

  function initStats() {
    if (!document.getElementById('stat-members')) return;
    refreshStats();
    // Refresh every 30 s so a freshly-registered member appears without reload.
    setInterval(refreshStats, 30000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initLangPicker();
    initFAQ();
    initDownloadTracking();
    initStats();
    applyLang(lang);
  });
})();
