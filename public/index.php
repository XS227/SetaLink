<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
// Referral code from ?ref= or ?start= (Telegram deep link)
$ref_code = '';
foreach (['ref', 'start'] as $key) {
    $v = trim((string)($_GET[$key] ?? ''));
    if (preg_match('/^[A-Z0-9]{4,20}$/i', $v)) { $ref_code = strtoupper($v); break; }
}
$dl_base  = '/download/setalink-latest.apk';
$dl_link  = $ref_code ? '/download/setalink-latest.apk?ref=' . urlencode($ref_code) : $dl_base;
$dl_ref       = $ref_code ? '?ref=' . urlencode($ref_code) : '';
$dl_arm32     = '/download/setalink-latest-arm32.apk' . $dl_ref;
$dl_universal = '/download/setalink-latest-universal.apk' . $dl_ref;
$logo      = '/assets/logo/setalink-mark-256.png';   // current brand mark (2026)
$og_img    = 'https://setalink.no' . $logo;

// Four supported UI languages — the same set the app ships (EN, Farsi, Chinese,
// Russian). Farsi/Chinese/Russian map to the censored regions we target:
// Iran, China, Russia. ?lang= sets the initial server-rendered language so
// crawlers index each locale; the JS switcher then persists the user's choice.
$SUPPORTED_LANGS = ['en', 'fa', 'zh', 'ru'];
$og_locale_map   = ['en' => 'en_US', 'fa' => 'fa_IR', 'zh' => 'zh_CN', 'ru' => 'ru_RU'];
$lang = strtolower((string)($_GET['lang'] ?? 'en'));
if (!in_array($lang, $SUPPORTED_LANGS, true)) { $lang = 'en'; }
$dir  = ($lang === 'fa') ? 'rtl' : 'ltr';
// Each locale self-canonicalizes so the hreflang cluster is consistent —
// pointing every variant's canonical at the bare root would tell Google the
// localized URLs are duplicates and break locale targeting.
$canonical = ($lang === 'en' && !isset($_GET['lang']))
  ? 'https://setalink.no/'
  : 'https://setalink.no/?lang=' . $lang;
$telegram = 'https://t.me/SetaLink3';
$ios_cta  = $telegram; // iOS is TestFlight beta — request access via Telegram

// Localized <title> + meta description per language. The body copy is swapped
// client-side by main.js, but these two tags are the strongest SEO signals, so
// they are rendered server-side in the requested language for crawlers.
$meta = [
  'en' => [
    'title' => 'Realink — Free VPN for Iran, China & Russia | Anti-Censorship VPN (Android & iOS)',
    'desc'  => 'Realink: AI-powered VLESS+Reality VPN for Iran, China, Russia and other censored regions. 5 GB free on install. No account. Beats DPI with DNS-over-HTTPS. Android APK + iOS TestFlight. In English, فارسی, 中文 and Русский.',
  ],
  'fa' => [
    'title' => 'فیلترشکن رایگان و پرسرعت ری‌لینک | وی‌پی‌ان ضدسانسور ایران (اندروید و iOS)',
    'desc'  => 'دانلود فیلترشکن رایگان ری‌لینک: فیلترشکن قوی و پرسرعت مبتنی بر VLESS+Reality و V2Ray برای ایران، بدون قطعی. ۵ گیگابایت رایگان پس از نصب، بدون ثبت‌نام و بدون حساب. عبور از فیلترینگ و DPI. نسخه اندروید و آیفون (iOS).',
  ],
  'zh' => [
    'title' => 'Realink — 面向伊朗、中国、俄罗斯的免费翻墙 VPN | 抗审查（安卓和 iOS）',
    'desc'  => 'Realink：基于 VLESS+Reality 的 AI 智能翻墙 VPN，面向伊朗、中国、俄罗斯等审查地区。安装即送 5 GB，无需账号。以 DNS-over-HTTPS 突破 DPI 深度包检测。提供安卓 APK 与 iOS TestFlight。',
  ],
  'ru' => [
    'title' => 'Realink — бесплатный VPN для Ирана, Китая и России | Обход блокировок (Android и iOS)',
    'desc'  => 'Realink: VPN на базе ИИ с VLESS+Reality для Ирана, Китая, России и других стран с цензурой. 5 ГБ бесплатно при установке. Без аккаунта. Обходит DPI через DNS-over-HTTPS. Android APK и iOS TestFlight.',
  ],
];
$m_title = $meta[$lang]['title'];
$m_desc  = $meta[$lang]['desc'];

// SEO-critical on-page copy, rendered SERVER-SIDE in the requested language.
// The H1 and section headings are Google's strongest on-page ranking signals,
// so they must contain the target keyword in the crawled HTML — not only appear
// after JS swaps them. For Farsi that keyword is «فیلترشکن» (filtershekan), the
// term Iranians actually search (far more than "VPN"). js/main.js STRINGS carry
// the SAME text for the client-side language switcher — keep the two in sync.
$seo = [
  'en' => [
    'badge' => 'Servers online — secure global nodes',
    'h1a' => 'Free Anti-Censorship VPN', 'h1b' => 'Internet Freedom for Everyone',
    'sub' => 'AI-powered VPN that beats DPI and censorship. VLESS+Reality &amp; V2Ray. Now on Android &amp; iOS. 5 GB free on install. No account, no server setup.',
    'how' => 'Three Steps to Free Internet', 'ai' => 'Not Just a Tunnel',
    'why' => 'Built for Real Censorship', 'pricing' => 'Start Free. Grow Together.', 'faq' => 'Common Questions', 'faqsub' => 'Real questions about how Realink actually works.',
  ],
  'fa' => [
    'badge' => 'سرورها فعال — گره‌های امن جهانی',
    'h1a' => 'فیلترشکن رایگان و پرسرعت', 'h1b' => 'اینترنت آزاد برای همه',
    'sub' => 'فیلترشکن هوشمند مبتنی بر هوش مصنوعی برای عبور از فیلترینگ و سانسور. VLESS+Reality و V2Ray. اکنون روی اندروید و آیفون (iOS). ۵ گیگابایت رایگان پس از نصب، بدون ثبت‌نام و بدون قطعی.',
    'how' => 'سه گام تا فیلترشکن رایگان', 'ai' => 'فقط یک تونل نیست',
    'why' => 'ساخته‌شده برای سانسور واقعی ایران', 'pricing' => 'رایگان شروع کن، با هم رشد کنیم', 'faq' => 'سؤالات پرتکرار', 'faqsub' => 'سؤال‌های واقعی درباره نحوه عملکرد ری‌لینک.',
  ],
  'zh' => [
    'badge' => '服务器在线 — 安全的全球节点',
    'h1a' => '免费翻墙 VPN', 'h1b' => '人人享有自由互联网',
    'sub' => '基于 AI 的智能翻墙 VPN，突破 DPI 与审查。VLESS+Reality 与 V2Ray。现已支持安卓和 iOS。安装即送 5 GB，无需账号，无需配置。',
    'how' => '三步通往自由互联网', 'ai' => '不只是一条隧道',
    'why' => '专为真实审查打造', 'pricing' => '免费开始，一起成长', 'faq' => '常见问题', 'faqsub' => '关于 Realink 实际工作方式的真实问题。',
  ],
  'ru' => [
    'badge' => 'Серверы онлайн — защищённые узлы',
    'h1a' => 'Бесплатный VPN', 'h1b' => 'Свободный интернет для всех',
    'sub' => 'VPN на базе ИИ для обхода блокировок и DPI. VLESS+Reality и V2Ray. Теперь на Android и iOS. 5 ГБ бесплатно при установке. Без аккаунта и настройки.',
    'how' => 'Три шага к свободному интернету', 'ai' => 'Не просто туннель',
    'why' => 'Создан для реальной цензуры', 'pricing' => 'Начните бесплатно. Растите вместе.', 'faq' => 'Частые вопросы', 'faqsub' => 'Реальные вопросы о том, как на самом деле работает Realink.',
  ],
];
$S = $seo[$lang];

// FAQ content per language (feeds BOTH the visible list and the FAQPage JSON-LD,
// so Google shows localized FAQ rich results). Farsi is fully translated because
// Iranian users are the primary audience; zh/ru fall back to English for now.
$faqs_i18n = [
  'en' => [
    ['How does the invite system work?',
     'When you install Realink, you receive a unique referral code. Share it with friends. When a friend installs the app and enters your code, both of you receive +1 GB of additional data. Invite 3 active friends to unlock stealth servers. There is no limit on how many people you can invite.'],
    ['What is the 5 GB emergency package?',
     'Every new device that installs Realink automatically receives 5 GB of free data — no account, no login, no credit card. This is designed so that anyone who suddenly loses internet access can get back online immediately.'],
    ['How does the AI protocol optimizer work?',
     'On every connection attempt, the app tests VLESS+Reality, XHTTP, and WebSocket in parallel. For each protocol, it performs a real HTTP probe — not just a TCP handshake. The first protocol to return actual HTTP data wins. Fake "connected" states are impossible.'],
    ['Does Realink keep logs?',
     'No user activity logs. The xray core logs connection events internally for diagnostic purposes but no user-identifiable content is stored. Device IDs are anonymous hashes. The admin can see aggregate connection statistics but not who connected to what.'],
    ['Is Realink on iPhone / iOS?',
     'Yes. Realink is now on both Android and iOS. Android installs directly from the APK on this page (no Play Store needed). iOS is in TestFlight beta — join our Telegram to get a beta invite. Both builds share the same AI routing engine, VLESS+Reality core, and QUIC-through-tunnel fix.'],
    ['What happens when Iran blocks a new SNI?',
     'The Remote Config system allows the server to push updated SNI priority lists to all apps without requiring an update. The AI optimizer also learns from real connection data — if a previously working SNI stops working, it drops in priority automatically.'],
    ['How is traffic different from normal HTTPS?',
     'VLESS+Reality makes VPN traffic cryptographically indistinguishable from a TLS handshake to a legitimate domain (like www.microsoft.com). Deep Packet Inspection cannot tell it apart from normal HTTPS traffic to that domain.'],
    ['What is the difference between Turkey and Iran routing?',
     'Turkey uses looser censorship with most SNIs working. Iran has stricter DPI and many SNIs are blocked. The AI optimizer knows which regions have stricter filtering and tests more aggressively, prioritizing SNIs confirmed to work from Iranian networks.'],
    ['Can I use it on multiple devices?',
     'Yes. Each install generates a separate device ID and receives its own 5 GB starter quota. Referral codes are tied to your device ID and transfer the bonus data to that device.'],
    ['What is the roadmap?',
     'Shipped: iOS TestFlight beta, per-app split tunneling, QUIC through the tunnel, and a Cloudflare stealth edge node. Near-term: more server nodes across the Middle East and Asia, App Store release, premium unlimited tier. Long-term: user-voted server expansion, community funding model, and open-source release of the core protocol selection engine.'],
  ],
  'fa' => [
    ['سیستم دعوت چگونه کار می‌کند؟',
     'وقتی ری‌لینک را نصب می‌کنی، یک کد دعوت اختصاصی دریافت می‌کنی. آن را با دوستانت به اشتراک بگذار. وقتی دوستی برنامه را نصب کند و کد تو را وارد کند، هر دوی شما ۱ گیگابایت داده اضافی می‌گیرید. با دعوت ۳ دوست فعال، سرورهای مخفی (استلث) باز می‌شوند. محدودیتی در تعداد افرادی که می‌توانی دعوت کنی وجود ندارد.'],
    ['بسته اضطراری ۵ گیگابایتی چیست؟',
     'هر دستگاه جدیدی که ری‌لینک را نصب کند، به‌طور خودکار ۵ گیگابایت داده رایگان دریافت می‌کند — بدون حساب، بدون ورود و بدون کارت بانکی. این برای زمانی طراحی شده که ناگهان دسترسی به اینترنت را از دست می‌دهی تا فوراً دوباره آنلاین شوی.'],
    ['بهینه‌ساز هوشمند پروتکل چگونه کار می‌کند؟',
     'در هر تلاش برای اتصال، برنامه به‌صورت هم‌زمان VLESS+Reality، XHTTP و WebSocket را آزمایش می‌کند. برای هر پروتکل یک پروب واقعی HTTP انجام می‌شود — نه فقط دست‌دادن TCP. اولین پروتکلی که داده واقعی HTTP برگرداند برنده می‌شود. وضعیت «متصل» جعلی ممکن نیست.'],
    ['آیا ری‌لینک لاگ نگه می‌دارد؟',
     'هیچ لاگی از فعالیت کاربر ثبت نمی‌شود. هسته xray رویدادهای اتصال را برای اهداف تشخیصی به‌صورت داخلی ثبت می‌کند اما هیچ محتوای قابل شناسایی کاربر ذخیره نمی‌شود. شناسه دستگاه‌ها هش ناشناس است. مدیر فقط آمار کلی اتصال را می‌بیند، نه اینکه چه کسی به چه چیزی وصل شده است.'],
    ['آیا ری‌لینک روی آیفون (iOS) هست؟',
     'بله. ری‌لینک اکنون هم روی اندروید و هم iOS در دسترس است. نسخه اندروید مستقیماً از فایل APK همین صفحه نصب می‌شود (بدون نیاز به گوگل‌پلی). نسخه iOS در بتای TestFlight است — به تلگرام ما بپیوند تا دعوت‌نامه بتا بگیری. هر دو نسخه از همان موتور مسیریابی هوشمند، هسته VLESS+Reality و اصلاح QUIC از داخل تونل استفاده می‌کنند.'],
    ['وقتی ایران یک SNI جدید را مسدود می‌کند چه می‌شود؟',
     'سیستم Remote Config به سرور اجازه می‌دهد فهرست اولویت SNI به‌روزشده را بدون نیاز به آپدیت برنامه به همه دستگاه‌ها ارسال کند. بهینه‌ساز هوشمند هم از داده‌های واقعی اتصال یاد می‌گیرد — اگر SNI‌ای که قبلاً کار می‌کرد از کار بیفتد، اولویتش به‌طور خودکار کاهش می‌یابد.'],
    ['ترافیک چه تفاوتی با HTTPS معمولی دارد؟',
     'پروتکل VLESS+Reality ترافیک VPN را از نظر رمزنگاری از یک دست‌دادن TLS به یک دامنه معتبر (مانند www.microsoft.com) غیرقابل‌تشخیص می‌کند. بازرسی عمیق بسته (DPI) نمی‌تواند آن را از ترافیک عادی HTTPS به آن دامنه تشخیص دهد.'],
    ['تفاوت مسیریابی ترکیه و ایران چیست؟',
     'ترکیه سانسور ملایم‌تری دارد و بیشتر SNI‌ها کار می‌کنند. ایران DPI سخت‌گیرانه‌تری دارد و بسیاری از SNI‌ها مسدودند. بهینه‌ساز هوشمند می‌داند کدام مناطق فیلترینگ شدیدتری دارند، تهاجمی‌تر آزمایش می‌کند و SNI‌هایی را که کارکردشان از شبکه‌های ایران تأیید شده در اولویت می‌گذارد.'],
    ['آیا می‌توانم روی چند دستگاه استفاده کنم؟',
     'بله. هر نصب یک شناسه دستگاه جداگانه می‌سازد و سهمیه اولیه ۵ گیگابایتی مخصوص خودش را دریافت می‌کند. کدهای دعوت به شناسه دستگاه تو گره خورده‌اند و داده جایزه را به همان دستگاه منتقل می‌کنند.'],
    ['نقشه راه چیست؟',
     'منتشرشده: بتای iOS TestFlight، تونل جداگانه برای هر برنامه، QUIC از داخل تونل و گره استلث Cloudflare. کوتاه‌مدت: سرورهای بیشتر در خاورمیانه و آسیا، انتشار در App Store و اشتراک نامحدود ویژه. بلندمدت: گسترش سرور با رأی کاربران، مدل تأمین مالی جامعه و انتشار متن‌باز موتور انتخاب پروتکل.'],
  ],
];
$faqs = $faqs_i18n[$lang] ?? $faqs_i18n['en'];
?><!DOCTYPE html>
<html lang="<?= $lang ?>" dir="<?= $dir ?>">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($m_title, ENT_QUOTES) ?></title>
  <meta name="description" content="<?= htmlspecialchars($m_desc, ENT_QUOTES) ?>">
  <meta name="keywords" content="فیلترشکن, فیلترشکن رایگان, فیلترشکن قوی, فیلترشکن پرسرعت, بهترین فیلترشکن, دانلود فیلترشکن, فیلترشکن اندروید, فیلترشکن آیفون, فیلترشکن جدید, فیلترشکن بدون قطعی, فیلتر شکن, وی پی ان, وی‌پی‌ان رایگان, V2Ray ایران, VLESS Reality, عبور از فیلترینگ, ضد فیلتر, VPN Iran, free VPN Iran, anti-censorship VPN, bypass DPI, 翻墙, 科学上网, VPN обход блокировок">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <meta name="author" content="SetAI">
  <link rel="canonical" href="<?= $canonical ?>">
  <!-- hreflang: one URL per UI language + x-default. The page renders the
       requested ?lang= server-side so each locale is independently indexable. -->
  <link rel="alternate" hreflang="en" href="https://setalink.no/">
  <link rel="alternate" hreflang="fa" href="https://setalink.no/?lang=fa">
  <link rel="alternate" hreflang="zh" href="https://setalink.no/?lang=zh">
  <link rel="alternate" hreflang="ru" href="https://setalink.no/?lang=ru">
  <link rel="alternate" hreflang="x-default" href="https://setalink.no/">
  <!-- Google verification -->
  <meta name="google-site-verification" content="7LR7rEIJvSWpajIB1Ei5wGNNBlx2chBCNnsRKuQgLG4">
  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="<?= $canonical ?>">
  <meta property="og:title"       content="<?= htmlspecialchars($m_title, ENT_QUOTES) ?>">
  <meta property="og:description" content="<?= htmlspecialchars($m_desc, ENT_QUOTES) ?>">
  <meta property="og:image"       content="<?= $og_img ?>">
  <meta property="og:locale"      content="<?= $og_locale_map[$lang] ?>">
  <?php foreach ($og_locale_map as $lc => $ogl): if ($lc === $lang) continue; ?>
  <meta property="og:locale:alternate" content="<?= $ogl ?>">
  <?php endforeach; ?>
  <meta property="og:site_name"   content="Realink VPN">
  <!-- Twitter / X -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="Realink — Free Anti-Censorship VPN (Android &amp; iOS)">
  <meta name="twitter:description" content="AI-powered VPN that defeats DPI. VLESS+Reality. 5 GB free, no account. Iran · China · Russia.">
  <meta name="twitter:image"       content="<?= $og_img ?>">
  <!-- Fonts + styles -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="<?= $logo ?>">
  <link rel="apple-touch-icon" href="<?= $logo ?>">
  <link rel="stylesheet" href="/css/main.css">
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-QVDJGX86KT"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-QVDJGX86KT');</script>
  <!-- Schema.org JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "name": "Realink VPN",
        "url": "https://setalink.no",
        "logo": "<?= $og_img ?>",
        "parentOrganization": {"@type": "Organization", "name": "SetAI", "url": "https://setai.no"},
        "sameAs": ["https://t.me/SetaLink3","https://github.com/XS227/SetaLink","https://setai.no"]
      },
      {
        "@type": "SoftwareApplication",
        "name": "Realink VPN",
        "operatingSystem": "Android, iOS",
        "applicationCategory": "SecurityApplication",
        "applicationSubCategory": "VPN",
        "description": "AI-powered anti-censorship VPN for Iran, China, Russia and other censored regions. VLESS+Reality, DoH, XHTTP/WebSocket fallback, QUIC through the tunnel. 5 GB free on install, no account.",
        "url": "https://setalink.no",
        "downloadUrl": "https://setalink.no/download/setalink-latest.apk",
        "inLanguage": ["en","fa","zh","ru"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "author": {"@type": "Organization", "name": "SetAI", "url": "https://setai.no"},
        "publisher": {"@type": "Organization", "name": "SetAI", "url": "https://setai.no"}
      },
      {
        "@type": "WebSite",
        "name": "Realink VPN",
        "url": "https://setalink.no",
        "inLanguage": ["en","fa","zh","ru"],
        "potentialAction": {
          "@type": "SearchAction",
          "target": "https://setalink.no/?q={search_term_string}",
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
<?php foreach ($faqs as $fi => [$fq, $fa]): ?>
          {
            "@type": "Question",
            "name": <?= json_encode($fq, JSON_UNESCAPED_UNICODE) ?>,
            "acceptedAnswer": {"@type": "Answer", "text": <?= json_encode($fa, JSON_UNESCAPED_UNICODE) ?>}
          }<?= $fi < count($faqs) - 1 ? ',' : '' ?>

<?php endforeach; ?>
        ]
      }
    ]
  }
  </script>
</head>
<body dir="ltr">
<div class="page-wrap">

<!-- ══ NAVIGATION ══════════════════════════════════════════════ -->
<nav class="nav">
  <a href="/" class="nav-logo">
    <img src="<?= $logo ?>" width="32" height="32" alt="Realink">
    <span class="brand-seta">Rea</span><span class="brand-link">link</span>
  </a>
  <div class="nav-actions">
    <div class="lang-picker" id="lang-picker">
      <button class="btn-lang" id="btn-lang" aria-label="Change language" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span class="btn-lang-text" id="btn-lang-text">English</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="lang-menu" id="lang-menu" role="menu">
        <button class="lang-opt" data-lang="en" role="menuitem"><span>English</span></button>
        <button class="lang-opt" data-lang="fa" role="menuitem" dir="rtl"><span>فارسی</span></button>
        <button class="lang-opt" data-lang="zh" role="menuitem"><span>中文</span></button>
        <button class="lang-opt" data-lang="ru" role="menuitem"><span>Русский</span></button>
      </div>
    </div>
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      <span data-t="nav.dl">Download APK</span>
    </a>
  </div>
</nav>

<!-- ══ REFERRAL INVITE BANNER ══════════════════════════════════ -->
<?php if ($ref_code): ?>
<div style="background:linear-gradient(90deg,rgba(0,232,122,.12),rgba(51,153,255,.12));border-bottom:1px solid rgba(0,232,122,.25);padding:.85rem 1.25rem;text-align:center">
  <span style="font-size:.9rem;color:#e0ffe8">
    🎁 You've been invited!
    Download the app and enter code
    <strong style="font-family:monospace;font-size:1rem;color:#00e87a;background:rgba(0,232,122,.12);padding:.1em .45em;border-radius:5px;border:1px solid rgba(0,232,122,.3)"><?= htmlspecialchars($ref_code) ?></strong>
    — both you and your friend get <strong>+1 GB free</strong>.
  </span>
</div>
<?php endif; ?>

<!-- ══ HERO ════════════════════════════════════════════════════ -->
<section class="hero">
  <div class="hero-glow"></div>

  <div class="hero-ring">
    <img src="<?= $logo ?>"
         class="hero-logo" width="112" height="112" alt="Realink">
  </div>

  <div class="hero-badge">
    <span class="dot-live"></span>
    <span data-t="hero.badge"><?= $S['badge'] ?></span>
  </div>

  <h1>
    <span data-t="hero.h1a"><?= $S['h1a'] ?></span><br>
    <span class="text-gradient" data-t="hero.h1b"><?= $S['h1b'] ?></span>
  </h1>

  <p class="hero-sub" data-t="hero.sub">
    <?= $S['sub'] ?>
  </p>

  <div class="hero-btns">
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.6 9.48l1.84-3.18c.16-.29.06-.65-.23-.81-.29-.16-.65-.06-.81.23l-1.86 3.23a11.4 11.4 0 0 0-8.9 0L5.77 5.72a.6.6 0 0 0-.81-.23c-.29.16-.39.52-.23.81L6.57 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
      <span data-t="hero.cta1">Download for Android</span>
    </a>
    <a href="<?= htmlspecialchars($ios_cta) ?>" target="_blank" rel="noopener" class="btn btn-secondary">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.6 12.9c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.7.8-3.5 2.1-1.5 2.6-.4 6.4 1.1 8.5.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1-.02 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.02-.01-2.1-.8-2.1-3.2zM15.4 5.8c.6-.7 1-1.7.9-2.7-.9.03-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .07 1.9-.5 2.5-1.2z"/></svg>
      <span data-t="hero.cta_ios">iOS — TestFlight Beta</span>
    </a>
  </div>

  <!-- APK variants — three clear options so visitors pick the right build
       (64-bit-only APK shows "App not installed" on 32-bit phones). -->
  <div class="dl-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.8rem;margin-top:1.4rem;max-width:860px;width:100%">
    <a href="<?= htmlspecialchars($dl_link) ?>" rel="nofollow"
       style="display:block;text-decoration:none;background:rgba(0,232,122,.07);border:1px solid rgba(0,232,122,.35);border-radius:14px;padding:1rem 1.1rem;text-align:left">
      <div style="font-size:.7rem;letter-spacing:.08em;color:#00e87a;font-weight:800;text-transform:uppercase" data-t="dl.card1.tag">✓ Recommended</div>
      <div style="font-size:.95rem;color:#fff;font-weight:700;margin:.25rem 0" data-t="dl.card1.h">Modern phones (64-bit)</div>
      <div style="font-size:.78rem;color:#9ab0c5;line-height:1.45" data-t="dl.card1.p">Most phones from 2018+ — Samsung A/S, Xiaomi, Poco, Huawei. Smallest download.</div>
    </a>
    <a href="<?= htmlspecialchars($dl_arm32) ?>" rel="nofollow"
       style="display:block;text-decoration:none;background:rgba(255,184,0,.06);border:1px solid rgba(255,184,0,.3);border-radius:14px;padding:1rem 1.1rem;text-align:left">
      <div style="font-size:.7rem;letter-spacing:.08em;color:#ffb800;font-weight:800;text-transform:uppercase" data-t="dl.card2.tag">Older phones</div>
      <div style="font-size:.95rem;color:#fff;font-weight:700;margin:.25rem 0" data-t="dl.card2.h">32-bit devices</div>
      <div style="font-size:.78rem;color:#9ab0c5;line-height:1.45" data-t="dl.card2.p">Samsung J-series and phones before ~2018. Use this if you see "App not installed".</div>
    </a>
    <a href="<?= htmlspecialchars($dl_universal) ?>" rel="nofollow"
       style="display:block;text-decoration:none;background:rgba(51,153,255,.06);border:1px solid rgba(51,153,255,.3);border-radius:14px;padding:1rem 1.1rem;text-align:left">
      <div style="font-size:.7rem;letter-spacing:.08em;color:#39f;font-weight:800;text-transform:uppercase" data-t="dl.card3.tag">Not sure?</div>
      <div style="font-size:.95rem;color:#fff;font-weight:700;margin:.25rem 0" data-t="dl.card3.h">Universal APK</div>
      <div style="font-size:.78rem;color:#9ab0c5;line-height:1.45" data-t="dl.card3.p">Works on every Android device. Larger file — pick this when in doubt.</div>
    </a>
  </div>

  <div class="hero-stats">
    <div class="hero-stat">
      <div class="hero-stat-num hero-stat-live" id="stat-members" data-count="0">
        <span class="dot-live" style="width:8px;height:8px;margin-inline-end:6px"></span>—
      </div>
      <div class="hero-stat-label" data-t="stat.members">Members &amp; growing</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-num" id="stat-countries" data-count="0">—</div>
      <div class="hero-stat-label" data-t="stat.countries">Countries reached</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-num">iOS + Android</div>
      <div class="hero-stat-label" data-t="stat.platforms">Both platforms</div>
    </div>
    <div class="hero-stat">
      <div class="hero-stat-num">5 GB</div>
      <div class="hero-stat-label" data-t="stat.free">Free on install</div>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ══ HOW IT WORKS ════════════════════════════════════════════ -->
<section class="section" id="how">
  <div class="section-label" data-t="how.label">HOW IT WORKS</div>
  <h2 class="section-title" data-t="how.title"><?= $S['how'] ?></h2>
  <p class="section-sub" data-t="how.sub">No account, no credit card, no configuration. Install and connect.</p>

  <div class="steps-bento">
    <div class="step-card">
      <div class="step-num">1</div>
      <h3 data-t="how.s1.h">Emergency Access</h3>
      <p data-t="how.s1.p">Install the APK and get 5 GB instantly — no login, no account. Tap Connect and the AI selects the fastest working protocol for your network.</p>
    </div>
    <div class="step-card">
      <div class="step-num">2</div>
      <h3 data-t="how.s2.h">Invite &amp; Earn Data</h3>
      <p data-t="how.s2.p">Share your referral code. Every person who joins adds 1 GB to both of you. The more people connect, the stronger and cheaper the network becomes.</p>
    </div>
    <div class="step-card">
      <div class="step-num">3</div>
      <h3 data-t="how.s3.h">AI Picks Best Route</h3>
      <p data-t="how.s3.p">Reality, XHTTP, and WebSocket are tested in parallel. Only a path that returns real HTTP data is declared connected — no fake "connected" states.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ══ AI FEATURES ═════════════════════════════════════════════ -->
<section class="section" id="ai">
  <div class="ai-section">
    <div class="section-label" data-t="ai.label">INTELLIGENT ROUTING</div>
    <h2 class="section-title" data-t="ai.title"><?= $S['ai'] ?></h2>
    <p class="section-sub" data-t="ai.sub">Realink actively validates every connection and picks the best path — every single time.</p>
  </div>

  <div class="bento-grid">
    <div class="bento-cell">
      <div class="bento-icon green">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
      </div>
      <h4 data-t="ai.f1.h">AI Protocol Optimizer</h4>
      <p data-t="ai.f1.p">Tests Reality, XHTTP, and WebSocket in parallel. Selects the fastest protocol that actually delivers internet — not the last one that worked, the one that works right now.</p>
    </div>

    <div class="bento-cell">
      <div class="bento-icon gold">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h4 data-t="ai.f2.h">Real Internet Validation</h4>
      <p data-t="ai.f2.p">TCP-connected is not enough. The app sends an actual HTTP/HTTPS request and verifies real data is received before declaring you connected. Fake states are rejected hard.</p>
    </div>

    <div class="bento-cell">
      <div class="bento-icon blue">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z"/></svg>
      </div>
      <h4 data-t="ai.f3.h">Adaptive Routing</h4>
      <p data-t="ai.f3.p">The network learns which SNIs work from your region. Different networks have different blocking patterns — the app adapts and remembers what works where, improving over time.</p>
    </div>

    <div class="bento-cell">
      <div class="bento-icon red">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h4 data-t="ai.f4.h">Remote Config Push</h4>
      <p data-t="ai.f4.p">Admin can push protocol priority updates without requiring an app update. When censorship patterns change, routing rules are updated automatically for all users.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ══ WHY REALINK ════════════════════════════════════════════ -->
<section class="section" id="why">
  <div class="section-label" data-t="why.label">WHY REALINK</div>
  <h2 class="section-title" data-t="why.title"><?= $S['why'] ?></h2>
  <p class="section-sub" data-t="why.sub">Not a generic VPN wrapper. Built from scratch for the realities of internet censorship in Iran.</p>

  <div class="why-grid">
    <div class="why-card">
      <div class="why-card-title" data-t="why.tech.label">TECHNICAL EXCELLENCE</div>
      <ul class="why-list">
        <li data-t="why.tech.1">VLESS + Reality — traffic indistinguishable from standard HTTPS, the most censorship-resistant protocol available</li>
        <li data-t="why.tech.2">XHTTP and WebSocket fallback transports via nginx edge proxy, tested continuously</li>
        <li data-t="why.tech.3">No logs, no account registration required to get emergency access</li>
        <li data-t="why.tech.4">SNI probing confirms which domains work from your ISP before connecting</li>
      </ul>
    </div>
    <div class="why-card">
      <div class="why-card-title" data-t="why.comm.label">COMMUNITY MODEL</div>
      <ul class="why-list">
        <li data-t="why.comm.1">More users = lower cost per user — infrastructure is shared and the network grows stronger with scale</li>
        <li data-t="why.comm.2">Referral bonuses reward both inviter and invitee — growth benefits everyone</li>
        <li data-t="why.comm.3">Community-backed, not VC-funded — decisions stay aligned with users, not investors</li>
        <li data-t="why.comm.4">Future: user-funded server expansion — vote on new regions and node locations</li>
      </ul>
    </div>
  </div>
</section>

<!-- ══ NETWORK BANNER ══════════════════════════════════════════ -->
<div class="banner">
  <p class="banner-quote" data-t="banner.q">"Every new user makes the network <strong>stronger</strong> and <strong>cheaper</strong> for everyone."</p>
  <p class="banner-sub"   data-t="banner.s">As the network grows, infrastructure cost per user decreases. Share with friends.</p>
</div>

<!-- ══ PRICING ════════════════════════════════════════════════ -->
<section class="section" id="pricing">
  <div class="section-label" data-t="pricing.label">ACCESS TIERS</div>
  <h2 class="section-title" data-t="pricing.title"><?= $S['pricing'] ?></h2>
  <p class="section-sub" data-t="pricing.sub">5 GB on install, more via referrals, unlimited data tier coming soon.</p>

  <div class="pricing-grid">
    <div class="price-card">
      <div class="price-eyebrow" data-t="plan.free.eyebrow">FREE EMERGENCY</div>
      <div class="price-title"   data-t="plan.free.title">Starter Pack</div>
      <div class="price-value">5 GB <span class="price-suffix">on install</span></div>
      <div class="price-desc"    data-t="plan.free.desc">Auto-activated when you install the APK. No account, no login, no credit card.</div>
      <ul class="price-features">
        <li data-t="plan.free.f1">5 GB starter quota</li>
        <li data-t="plan.free.f2">Auto-activated on install</li>
        <li data-t="plan.free.f3">AI protocol selection</li>
        <li data-t="plan.free.f4">No account needed</li>
      </ul>
      <a href="<?= htmlspecialchars($dl_link) ?>" class="price-cta price-cta-solid" data-t="plan.free.cta">Download APK</a>
    </div>

    <div class="price-card featured">
      <div class="price-eyebrow" data-t="plan.comm.eyebrow">INVITE-BASED</div>
      <div class="price-title"   data-t="plan.comm.title">Community</div>
      <div class="price-value">+1 GB <span class="price-suffix">per invite</span></div>
      <div class="price-desc"    data-t="plan.comm.desc">Share your referral code. Every friend who joins gives both of you 1 GB extra.</div>
      <ul class="price-features">
        <li data-t="plan.comm.f1">+1 GB per friend invited</li>
        <li data-t="plan.comm.f2">Invitee also receives +1 GB</li>
        <li data-t="plan.comm.f3">No limit on referrals</li>
        <li data-t="plan.comm.f4">Network grows stronger with you</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta price-cta-gold" data-t="plan.comm.cta">Get Invite Code</a>
    </div>

    <div class="price-card dimmed">
      <div class="price-eyebrow" data-t="plan.prem.eyebrow">COMING SOON</div>
      <div class="price-title"   data-t="plan.prem.title">Premium</div>
      <div class="price-value">∞ <span class="price-suffix">unlimited</span></div>
      <div class="price-desc"    data-t="plan.prem.desc">Unlimited data, priority nodes, dedicated support channels.</div>
      <ul class="price-features">
        <li data-t="plan.prem.f1">Unlimited data</li>
        <li data-t="plan.prem.f2">Priority routing nodes</li>
        <li data-t="plan.prem.f3">Dedicated support</li>
        <li data-t="plan.prem.f4">Early access features</li>
      </ul>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="price-cta price-cta-outline" data-t="plan.prem.cta">Join Waitlist</a>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ══ SHAHNAMEH PROMO ═════════════════════════════════════════ -->
<section class="section" id="shahnameh">
  <div style="max-width:720px;margin:0 auto;background:linear-gradient(135deg,rgba(201,164,42,.1),rgba(200,16,46,.06));border:1px solid rgba(201,164,42,.35);border-radius:18px;padding:2rem;text-align:center">
    <div class="section-label" style="color:#c9a42a" data-t="shah.label">COMMUNITY GAME</div>
    <h2 class="section-title" style="margin:.4rem 0" data-t="shah.title">Play Shahnameh — earn REAL</h2>
    <p class="section-sub" style="margin:0 auto 1.2rem" data-t="shah.sub">Battle as a Persian warrior in the Shahnameh Telegram game and earn REAL rewards.</p>
    <a href="https://t.me/shahnameh_bot?start=warrior_5629291605" target="_blank" rel="noopener" class="btn btn-primary" style="background:#c9a42a;border-color:#c9a42a">
      ⚔️ <span data-t="shah.cta">Play on Telegram</span>
    </a>
  </div>
</section>

<div class="divider"></div>

<!-- ══ SUPPORT THE PROJECT ═════════════════════════════════════ -->
<section class="section" id="support">
  <div class="support-section">
    <div class="section-label" data-t="support.label">INFRASTRUCTURE FUNDING</div>
    <h2 class="section-title" data-t="support.title">Support the Project</h2>
    <p class="section-sub" style="margin:0 auto" data-t="support.sub">Realink runs on real servers that cost real money. Every contribution helps add nodes, improve reliability, and expand to new regions.</p>
  </div>

  <div class="support-grid">
    <div class="support-card">
      <div class="support-icon" style="background:var(--green-dim);border:1px solid rgba(29,156,34,.2)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <h4 data-t="support.s1.h">Server Costs</h4>
      <p data-t="support.s1.p">Secure VPS infrastructure. More nodes = better speed and resilience for every user in the network.</p>
    </div>
    <div class="support-card">
      <div class="support-icon" style="background:var(--gold-dim);border:1px solid rgba(201,164,42,.2)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <h4 data-t="support.s2.h">Censorship Resilience</h4>
      <p data-t="support.s2.p">New protocols, SNI rotation, and edge proxy improvements require development time. Funding keeps the work moving.</p>
    </div>
    <div class="support-card">
      <div class="support-icon" style="background:var(--red-dim);border:1px solid rgba(200,16,46,.2)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e04060" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <h4 data-t="support.s3.h">How to Help</h4>
      <p data-t="support.s3.p">Share the app with friends (earn data), contribute code on GitHub, or contact us via Telegram to discuss infrastructure sponsorship.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<!-- ══ COMMUNITY / TELEGRAM + GITHUB ══════════════════════════ -->
<div class="community-row">
  <div class="community-grid">
    <div class="community-card">
      <div class="community-card-icon" style="background:rgba(41,161,238,.12);border:1px solid rgba(41,161,238,.25)">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="rgba(41,161,238,.9)"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
      </div>
      <h3 data-t="comm.tg.h">Telegram Group</h3>
      <p data-t="comm.tg.p">Ask questions, report issues, get your referral code, and stay updated on new releases. The main support channel.</p>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-secondary">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
        @SetaLink3
      </a>
    </div>

    <div class="community-card">
      <div class="community-card-icon" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15)">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="rgba(255,255,255,.85)"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      </div>
      <h3 data-t="comm.gh.h">GitHub</h3>
      <p data-t="comm.gh.p">Follow development, contribute code or report bugs. Open to community review — no black-box security claims.</p>
      <a href="https://github.com/XS227/SetaLink" target="_blank" rel="noopener" class="btn btn-secondary">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
        github.com/XS227/SetaLink
      </a>
    </div>
  </div>
</div>

<div class="divider"></div>

<!-- ══ FAQ ════════════════════════════════════════════════════ -->
<section class="section" id="faq">
  <div class="faq-section">
    <div class="section-label" data-t="faq.label">FAQ</div>
    <h2 class="section-title" data-t="faq.title"><?= $S['faq'] ?></h2>
    <p class="section-sub" style="margin:0 auto" data-t="faq.sub"><?= $S['faqsub'] ?></p>
  </div>

  <div class="faq-list">
    <?php
    foreach ($faqs as $i => [$q, $a]): ?>
    <div class="faq-item" id="faq<?= $i ?>">
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

<!-- ══ FOOTER ═════════════════════════════════════════════════ -->
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <img src="<?= $logo ?>" width="28" height="28" alt="Realink" style="border-radius:7px">
      <span class="brand-seta">Rea</span><span class="brand-link">link</span>
    </div>
    <nav class="footer-links">
      <a href="/faq.php" data-t="footer.faq">Full FAQ</a>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" data-t="footer.tg">Telegram</a>
      <a href="https://github.com/XS227/SetaLink" target="_blank" rel="noopener" data-t="footer.gh">GitHub</a>
      <a href="<?= htmlspecialchars($dl_link) ?>" data-t="footer.dl">Download</a>
      <a href="https://setai.no" target="_blank" rel="external" data-t="footer.setai">SetAI</a>
    </nav>
    <!-- Keyword-targeted landing pages — descriptive anchor text passes topical
         relevance/link equity so each guide can rank for its own search intent. -->
    <nav class="footer-links footer-guides" aria-label="Guides">
      <a href="/blog/">Blog</a>
      <a href="/fa/" hreflang="fa" dir="rtl" lang="fa">فیلترشکن رایگان</a>
      <a href="/iran-vpn/">VPN for Iran</a>
      <a href="/v2ray-iran/">V2Ray Iran</a>
      <a href="/privacy-vpn/">Privacy VPN</a>
      <a href="/tr/" hreflang="tr" lang="tr">VPN Türkiye</a>
    </nav>
    <p class="footer-copy">
      &copy; <?= date('Y') ?> Realink VPN · <span data-t="footer.platforms">Android &amp; iOS</span> ·
      <span data-t="footer.by">a project by</span>
      <a href="https://setai.no" target="_blank" rel="external" style="color:var(--gold);font-weight:600">SetAI</a>
    </p>
  </div>
</footer>

</div><!-- .page-wrap -->

<script>window.__SL_LANG__ = <?= json_encode($lang) ?>; window.__SL_LANG_LOCKED__ = <?= json_encode(isset($_GET['lang'])) ?>;</script>
<script src="/js/main.js" defer></script>
<?php
// FAQ schema — mirrors the FAQ items rendered in HTML above
$faq_schema_items = [
  ['How does the invite system work?', 'When you install Realink, you receive a unique referral code. Share it with friends. When a friend installs the app and enters your code, both of you receive +1 GB of additional data. There is no limit on how many people you can invite.'],
  ['What is the 5 GB emergency package?', 'Every new device that installs Realink automatically receives 5 GB of free data — no account, no login, no credit card. Anyone who suddenly loses internet access can get back online immediately.'],
  ['How does the AI protocol optimizer work?', 'On every connection attempt, the app tests VLESS+Reality, XHTTP, and WebSocket in parallel. For each protocol, it performs a real HTTP probe — not just a TCP handshake. The first protocol to return actual HTTP data wins.'],
  ['Does Realink keep logs?', 'No user activity logs are kept. Device IDs are anonymous hashes. Aggregate statistics are stored but cannot be traced to individual users.'],
  ['Is Realink on iPhone / iOS?', 'Yes. Realink runs on both Android and iOS. Android installs directly from the APK on this page. iOS is in TestFlight beta — join the Telegram channel to request an invite. Both share the same AI routing engine and VLESS+Reality core.'],
  ['What happens when Iran blocks a new SNI?', 'The Remote Config system allows pushing updated SNI priority lists to all apps without requiring an update. The AI optimizer also drops blocked SNIs in priority automatically.'],
  ['How is traffic different from normal HTTPS?', 'VLESS+Reality makes VPN traffic cryptographically indistinguishable from a TLS handshake to a legitimate domain like www.microsoft.com. Deep Packet Inspection cannot tell it apart.'],
];
$faq_entities = array_map(fn($f) => [
  '@type' => 'Question',
  'name' => $f[0],
  'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f[1]],
], $faq_schema_items);
echo '<script type="application/ld+json">' . json_encode([
  '@context' => 'https://schema.org',
  '@type' => 'FAQPage',
  'mainEntity' => $faq_entities,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>' . "\n";
?>
</body>
</html>
