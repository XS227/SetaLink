<?php
// Shared blog chrome + article registry. Persian-first (RTL), reuses the site's
// css/main.css. Each article file defines $a and calls blog_head()/blog_footer().
// The registry powers the index list, "related posts", and the sitemap.

const BLOG_BASE = 'https://setalink.no/blog';
$LOGO   = '/assets/logo/setalink-mark-256.png';
$OG_IMG = 'https://setalink.no' . $LOGO;

// slug => metadata. body lives in each article's own index.php.
// Optional 'faq' key: array of ['q'=>..., 'a'=>...] pairs -> emits FAQPage
// JSON-LD in blog_head() for that article (SEO, 2026-07-19).
//
// SEO note (2026-07-19): 'فیلترشکن پرسرعت' ("fast VPN") used to be a target
// keyword on BOTH best-free-vpn-iran and stable-filtershekan-no-disconnect —
// the two pages were competing for the same query instead of reinforcing
// each other. Kept it on best-free-vpn-iran (speed is a core "best VPN"
// buying criterion); the disconnect article now targets its own distinct
// term instead (see 'keywords' below).
$BLOG_ARTICLES = [
  'best-free-vpn-iran' => [
    'title' => 'بهترین فیلترشکن رایگان برای ایران در ۲۰۲۶ | راهنمای انتخاب',
    'h1'    => 'بهترین فیلترشکن رایگان برای ایران (۲۰۲۶)',
    'desc'  => 'راهنمای انتخاب بهترین فیلترشکن رایگان و پرسرعت برای ایران در سال ۲۰۲۶: پروتکل‌ها، معیارها و چرا ری‌لینک با VLESS+Reality از DPI عبور می‌کند. ۵ گیگابایت رایگان.',
    'keywords' => 'بهترین فیلترشکن, فیلترشکن رایگان, فیلترشکن پرسرعت, فیلترشکن ایران, دانلود فیلترشکن',
    'date'  => '2026-07-10',
    'excerpt' => 'چطور بین ده‌ها فیلترشکن، یکی که واقعاً در ایران کار می‌کند را انتخاب کنیم؟ معیارهای مهم و مقایسه پروتکل‌ها.',
    'faq' => [
      ['q' => 'آیا فیلترشکن رایگان واقعاً امن است؟',
       'a' => 'بستگی دارد. اگر سازنده آن مشخص باشد، سیاست عدم‌لاگ داشته باشد و از پروتکل مدرنی مثل VLESS+Reality استفاده کند، بله. اگر منبع آن نامشخص است یا دسترسی‌های غیرضروری می‌خواهد، نه.'],
      ['q' => 'چرا فیلترشکن‌های قدیمی مثل OpenVPN دیگر خوب کار نمی‌کنند؟',
       'a' => 'چون سیستم فیلترینگ ایران با بازرسی عمیق بسته (DPI) الگوی ترافیک آن‌ها را می‌شناسد و مسدود می‌کند، حتی اگر محتوای داخل آن رمزنگاری‌شده باشد.'],
      ['q' => 'آیا برای استفاده از ری‌لینک باید ثبت‌نام کنم؟',
       'a' => 'نه. ۵ گیگابایت اول کاملاً بدون ثبت‌نام، بدون حساب کاربری و بدون کارت بانکی در دسترس است.'],
    ],
  ],
  'stable-filtershekan-no-disconnect' => [
    'title' => 'چرا فیلترشکن قطع می‌شود؟ راهکار اتصال پایدار و بدون قطعی',
    'h1'    => 'چرا فیلترشکن قطع می‌شود و چطور اتصال پایدار داشته باشیم',
    'desc'  => 'دلایل قطع‌شدن فیلترشکن در ایران (DPI، مسدودسازی SNI، مشکل QUIC) و راهکارهای عملی برای اتصال پایدار و بدون قطعی با ری‌لینک.',
    'keywords' => 'فیلترشکن بدون قطعی, فیلترشکن قطع میشود, فیلترشکن پایدار, رفع قطعی فیلترشکن, اتصال فیلترشکن',
    'date'  => '2026-07-10',
    'excerpt' => 'قطع‌شدن مداوم فیلترشکن آزاردهنده است. چرا اتفاق می‌افتد و چطور یک اتصال پایدار بسازیم.',
    'faq' => [
      ['q' => 'چرا فیلترشکن با وجود اتصال، مدام قطع می‌شود؟',
       'a' => 'معمولاً به این دلیل که سیستم فیلترینگ ایران نام دامنه (SNI) اتصال شما را شناسایی و مسدود می‌کند. فیلترشکن‌هایی که از پروتکل Reality و به‌روزرسانی خودکار SNI استفاده می‌کنند، این نوع قطعی را برطرف می‌کنند.'],
      ['q' => 'چرا تلگرام کار می‌کند اما اینستاگرام و واتساپ باز نمی‌شوند؟',
       'a' => 'اینستاگرام و واتساپ از پروتکل QUIC روی UDP استفاده می‌کنند که خیلی از فیلترشکن‌ها آن را درست هدایت نمی‌کنند؛ تلگرام چون TCP است معمولاً کار می‌کند. راه‌حل: بعد از تعویض سرور، اپلیکیشن را کاملاً ببندید (force-quit) و دوباره باز کنید تا نشست‌های قدیمی QUIC پاک شوند.'],
      ['q' => 'چرا بعضی صفحات نیمه‌باز می‌مانند و لود نمی‌شوند؟',
       'a' => 'روی شبکه‌های موبایل ایران، بسته‌های بزرگ گاهی گم می‌شوند. فیلترشکن‌هایی که اندازه بسته (MSS/MTU) را به‌صورت خودکار تنظیم می‌کنند، این مشکل را برطرف می‌کنند.'],
      ['q' => 'چطور بهترین سرور را برای اپراتور خودم انتخاب کنم؟',
       'a' => 'اگر یک سرور از یک اپراتور (مثلاً ایرانسل) مسدود است ولی از اپراتور دیگر باز، فیلترشکن‌های هوشمند به‌صورت خودکار بهترین سرور را برای شبکه شما اولویت می‌دهند. اگر یک نود کند بود، گزینه Stealth (Cloudflare) را امتحان کنید.'],
      ['q' => 'چرا اتصال وصل است اما بعضی سایت‌ها باز نمی‌شوند؟',
       'a' => 'این معمولاً به‌خاطر مسدودسازی DNS است، نه قطعی واقعی. اگر درخواست DNS از داخل تونل رمزنگاری‌شده عبور نکند، آدرس بعضی سایت‌ها پیدا نمی‌شود حتی وقتی خود اتصال VPN برقرار است.'],
      ['q' => 'چرا فیلترشکن روی گوشی من در پس‌زمینه قطع می‌شود؟',
       'a' => 'اغلب مقصر تنظیمات گوشی است، نه فیلترشکن: در اندروید، بهینه‌سازی باتری اپلیکیشن را در پس‌زمینه می‌بندد — آن را «بدون محدودیت» تنظیم کنید. در iOS، Background App Refresh باید برای فیلترشکن فعال باشد.'],
    ],
  ],
  'what-is-v2ray-vless-reality' => [
    'title' => 'V2Ray، VLESS و Reality چیست؟ راهنمای عبور از فیلترینگ',
    'h1'    => 'V2Ray، VLESS و Reality چیست؟ راهنمای ساده عبور از فیلترینگ',
    'desc'  => 'توضیح ساده V2Ray، VLESS و پروتکل Reality و اینکه چرا این‌ها بهترین روش عبور از فیلترینگ و DPI در ایران هستند — بدون تنظیمات پیچیده با ری‌لینک.',
    'keywords' => 'V2Ray ایران, VLESS, Reality, عبور از فیلترینگ, فیلترشکن قوی, بایپس DPI',
    'date'  => '2026-07-10',
    'excerpt' => 'V2Ray، VLESS و Reality پشت فیلترشکن‌های مدرن هستند. به زبان ساده توضیح می‌دهیم چطور کار می‌کنند.',
    'faq' => [
      ['q' => 'تفاوت V2Ray و VLESS چیست؟',
       'a' => 'V2Ray (نسخه پیشرفته آن: Xray) یک هسته نرم‌افزاری است که چند پروتکل مختلف را در خود دارد. VLESS یکی از همان پروتکل‌هاست — سبک و سریع، بدون سربار رمزنگاری اضافی — که معمولاً همراه با Reality استفاده می‌شود.'],
      ['q' => 'آیا Reality همیشه غیرقابل‌شناسایی است؟',
       'a' => 'هیچ روشی صد‌درصد تضمینی نیست، اما Reality با شبیه‌سازی دقیق handshake یک سایت واقعی، تا امروز یکی از مقاوم‌ترین روش‌ها در برابر DPI بوده — بسیار مقاوم‌تر از OpenVPN یا Shadowsocks معمولی.'],
      ['q' => 'آیا برای استفاده از VLESS+Reality نیاز به دانش فنی دارم؟',
       'a' => 'نه. اپلیکیشن‌هایی مثل ری‌لینک این پروتکل‌ها را داخل خود دارند و به‌صورت خودکار بهترین گزینه را انتخاب می‌کنند — کاربر فقط دکمه اتصال را می‌زند.'],
    ],
  ],
  'filtershekan-instagram' => [
    'title' => 'فیلترشکن اینستاگرام: چرا باز نمی‌شود و راه‌حل قطعی (راهنمای ۱۴۰۵)',
    'h1'    => 'فیلترشکن اینستاگرام — چرا لود نمی‌شود و چطور درستش کنیم',
    'desc'  => 'فیلترشکن وصل است ولی اینستاگرام باز نمی‌شود؟ مشکل از QUIC است. راهنمای عملی: force-quit بعد از اتصال، سرور Stealth برای ایرانسل و مخابرات، و فیلترشکنی که ویدیو و استوری را واقعاً لود می‌کند.',
    'keywords' => 'فیلترشکن اینستاگرام, فیلترشکن برای اینستاگرام, باز کردن اینستاگرام, بهترین فیلترشکن برای اینستاگرام, اینستاگرام باز نمیشه',
    'date'  => '2026-07-13',
    'excerpt' => 'اینستاگرام با فیلترشکن لود نمی‌شود؟ دلیل فنی مشخصی دارد (QUIC) و راه‌حلش سه قدم ساده است.',
    'faq' => [
      ['q' => 'چرا اینستاگرام با فیلترشکن باز نمی‌شود ولی سایت‌های دیگر باز می‌شوند؟',
       'a' => 'چون اینستاگرام از پروتکل QUIC روی UDP استفاده می‌کند، نه TCP معمولی. خیلی از فیلترشکن‌ها فقط ترافیک TCP را درست هدایت می‌کنند، برای همین سایت‌های عادی باز می‌شوند اما اینستاگرام روی «در حال بارگذاری» می‌ماند.'],
      ['q' => 'چرا فقط ویدیو و استوری اینستاگرام لود نمی‌شود؟',
       'a' => 'این علامت کلاسیک مشکل QUIC است — متن و عکس از مسیر TCP می‌آیند ولی ویدیو از QUIC. فیلترشکنی که QUIC را کامل از تونل عبور می‌دهد این مشکل را ندارد.'],
      ['q' => 'بعد از وصل کردن فیلترشکن چه کار کنم که اینستاگرام باز شود؟',
       'a' => 'اینستاگرام را کاملاً ببندید (force-quit — از لیست برنامه‌های اخیر هم کنار بزنید) و دوباره باز کنید. این کار نشست قبلی و مسدود آن را پاک می‌کند و در بیشتر موارد مشکل را حل می‌کند.'],
    ],
  ],
  'filtershekan-whatsapp' => [
    'title' => 'فیلترشکن واتساپ: پیام می‌رود ولی تماس وصل نمی‌شود؟ راه‌حل کامل',
    'h1'    => 'فیلترشکن واتساپ — پیام، تماس و ویدیو بدون قطعی',
    'desc'  => 'تماس واتساپ با فیلترشکن وصل نمی‌شود؟ تماس‌ها UDP می‌خواهند و خیلی از فیلترشکن‌ها عبورش نمی‌دهند. راهنمای عملی: تونل تمام‌دستگاه، force-quit بعد از اتصال و سرور Stealth برای ایرانسل.',
    'keywords' => 'فیلترشکن واتساپ, فیلترشکن برای واتساپ, تماس واتساپ وصل نمیشود, فیلترشکن تلگرام',
    'date'  => '2026-07-13',
    'excerpt' => 'چرا پیام واتساپ می‌رود ولی تماس نه؟ مشکل UDP است — و چک‌لیست چهار قدمی برای اتصال پایدار.',
    'faq' => [
      ['q' => 'چرا پیام واتساپ می‌رسد ولی تماس صوتی/تصویری وصل نمی‌شود؟',
       'a' => 'پیام‌ها از مسیر TCP معمولی رد می‌شوند، ولی تماس‌های واتساپ روی UDP کار می‌کنند. خیلی از فیلترشکن‌ها UDP را کامل عبور نمی‌دهند؛ فیلترشکنی با تونل تمام‌دستگاه این مشکل را ندارد.'],
      ['q' => 'تلگرام کار می‌کند ولی واتساپ نه — دلیلش چیست؟',
       'a' => 'این خودش یک نشانه تشخیصی است: تلگرام تحمل بیشتری در برابر اختلال دارد. اگر تلگرام وصل است ولی واتساپ نه، مشکل از عبور ناقص UDP/QUIC در فیلترشکن شماست، نه از اینترنت.'],
      ['q' => 'روی ایرانسل و مخابرات چه سروری برای واتساپ بهتر است؟',
       'a' => 'سرور Stealth (پشت CDN). سرورهای دیتاسنتری معمولی روی این دو اپراتور اغلب مسدود می‌شوند؛ روی همراه اول معمولاً سرور مستقیم کافی است.'],
    ],
  ],
  'filtershekan-carrier-guide' => [
    'title' => 'کدام فیلترشکن روی اپراتور شما کار می‌کند؟ همراه اول، ایرانسل، رایتل، مخابرات',
    'h1'    => 'کدام فیلترشکن روی اپراتور شما کار می‌کند؟ (همراه اول، ایرانسل، رایتل، مخابرات)',
    'desc'  => 'فیلترشکن ایرانسل، همراه اول، رایتل و مخابرات یکسان کار نمی‌کنند. راهنمای مبتنی بر داده واقعی: روی هر اپراتور کدام سرور و کدام روش وصل می‌شود — و چرا سرور Stealth روی ایرانسل جواب می‌دهد.',
    // SEO note (2026-07-19): dropped the bare 'فیلترشکن ایرانسل' keyword here
    // — filtershekan-irancell-disconnect targets that exact phrase as its
    // specific deep-dive page; this pillar page keeps the broader,
    // carrier-comparison framing instead so the two don't compete.
    'keywords' => 'فیلترشکن اپراتور, فیلترشکن همراه اول, فیلترشکن رایتل, فیلترشکن مخابرات, مقایسه فیلترشکن اپراتورها',
    'date'  => '2026-07-12',
    'excerpt' => 'فیلترینگ روی هر اپراتور فرق دارد: چیزی که روی همراه اول کار می‌کند، روی ایرانسل بسته است. راهنمای اپراتور به اپراتور.',
    'faq' => [
      ['q' => 'چرا فیلترشکن دوستم روی همراه اول کار می‌کند ولی روی گوشی من (ایرانسل) نه؟',
       'a' => 'چون مسدودسازی سرورهای خارجی اپراتور به اپراتور اعمال می‌شود، نه به‌صورت یکسان در کل کشور. سروری که از همراه اول باز است می‌تواند روی ایرانسل کاملاً سیاه‌چاله شده باشد.'],
      ['q' => 'روی کدام اپراتورها باید سرور Stealth استفاده کنم؟',
       'a' => 'ایرانسل و اینترنت ثابت مخابرات، چون IPهای دیتاسنتری روی این دو معمولاً مسدودند. روی همراه اول معمولاً سرور مستقیم سریع‌تر و کافی است.'],
      ['q' => 'نمی‌دانم کدام سرور را انتخاب کنم — چه کار کنم؟',
       'a' => 'حالت Auto را روشن بگذارید. فیلترشکن از تجربه اتصال کاربرانِ همان اپراتور یاد می‌گیرد و بهترین مسیر را خودش انتخاب می‌کند، بدون نیاز به تست دستی.'],
    ],
  ],
  'filtershekan-irancell-disconnect' => [
    'title' => 'چرا فیلترشکن روی ایرانسل قطع می‌شود؟ راه‌حل قطعی نشدن',
    'h1'    => 'چرا فیلترشکن روی ایرانسل قطع می‌شود و راه‌حل آن',
    'desc'  => 'فیلترشکن روی ایرانسل وصل نمی‌شود یا مدام قطع می‌شود؟ دلیلش سیاه‌چاله شدن IPهای دیتاسنتری روی ایرانسل است. راه‌حل: سرور Stealth پشت CDN و حالت Auto در ری‌لینک — فیلترشکن ایرانسل که قطع نمی‌شود.',
    'keywords' => 'فیلترشکن ایرانسل که قطع نمیشه, فیلترشکن ایرانسل, فیلترشکن برای ایرانسل که کار کنه, چرا فیلترشکن قطع میشه',
    'date'  => '2026-07-12',
    'excerpt' => 'ایرانسل سخت‌گیرترین اپراتور با سرورهای خارجی است. چرا فیلترشکن رویش قطع می‌شود و چه راهی واقعاً جواب می‌دهد.',
    'faq' => [
      ['q' => 'چرا فیلترشکن دوستم (همراه اول) روی ایرانسلِ من کار نمی‌کند؟',
       'a' => 'چون مسدودسازی اپراتور به اپراتور فرق دارد. همراه اول اتصال مستقیم را اغلب باز گذاشته؛ ایرانسل همان سرورها را سیاه‌چاله می‌کند.'],
      ['q' => 'آیا فیلترشکن پولی روی ایرانسل بهتر است؟',
       'a' => 'نه لزوماً. مهم مسیر اتصال است، نه قیمت. فیلترشکنی که فقط سرور دیتاسنتری مستقیم دارد — رایگان یا پولی — روی ایرانسل گیر می‌کند. چیزی که فرق ایجاد می‌کند مسیر CDN/Stealth و تشخیص خودکار اپراتور است.'],
      ['q' => 'با اینترنت خانگی مخابرات چه کنم؟',
       'a' => 'همان راه‌حل ایرانسل: سرور Stealth. رفتار مخابرات در داده‌های ما تقریباً مشابه ایرانسل است.'],
    ],
  ],
];

function blog_head(array $a): void {
    global $OG_IMG;
    $url = BLOG_BASE . '/' . $a['slug'] . '/';
    echo '<!DOCTYPE html><html lang="fa" dir="rtl"><head>';
    echo '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">';
    echo '<title>' . htmlspecialchars($a['title'], ENT_QUOTES) . '</title>';
    echo '<meta name="description" content="' . htmlspecialchars($a['desc'], ENT_QUOTES) . '">';
    echo '<meta name="keywords" content="' . htmlspecialchars($a['keywords'], ENT_QUOTES) . '">';
    echo '<meta name="robots" content="index,follow,max-image-preview:large">';
    echo '<meta name="author" content="SetAI">';
    echo '<link rel="canonical" href="' . $url . '">';
    echo '<link rel="alternate" hreflang="fa" href="' . $url . '"><link rel="alternate" hreflang="x-default" href="' . $url . '">';
    echo '<meta property="og:type" content="article"><meta property="og:locale" content="fa_IR">';
    echo '<meta property="og:title" content="' . htmlspecialchars($a['title'], ENT_QUOTES) . '">';
    echo '<meta property="og:description" content="' . htmlspecialchars($a['desc'], ENT_QUOTES) . '">';
    echo '<meta property="og:url" content="' . $url . '"><meta property="og:image" content="' . $OG_IMG . '">';
    echo '<meta property="og:site_name" content="Realink VPN">';
    echo '<meta name="twitter:card" content="summary_large_image">';
    echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
    echo '<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">';
    echo '<link rel="icon" type="image/png" href="/assets/logo/setalink-mark-256.png">';
    echo '<link rel="stylesheet" href="/css/main.css">';
    // GA — same property as the main site.
    echo '<script async src="https://www.googletagmanager.com/gtag/js?id=G-QVDJGX86KT"></script>';
    echo '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-QVDJGX86KT");</script>';
    // Article + Breadcrumb JSON-LD.
    $ld = [
      '@context' => 'https://schema.org',
      '@graph' => [
        [
          '@type' => 'BlogPosting',
          'headline' => $a['h1'],
          'description' => $a['desc'],
          'inLanguage' => 'fa',
          'datePublished' => $a['date'], 'dateModified' => $a['date'],
          'image' => $OG_IMG,
          'mainEntityOfPage' => $url,
          'author' => ['@type' => 'Organization', 'name' => 'SetAI', 'url' => 'https://setai.no'],
          'publisher' => ['@type' => 'Organization', 'name' => 'Realink VPN',
                          'logo' => ['@type' => 'ImageObject', 'url' => $OG_IMG]],
        ],
        [
          '@type' => 'BreadcrumbList',
          'itemListElement' => [
            ['@type' => 'ListItem', 'position' => 1, 'name' => 'خانه', 'item' => 'https://setalink.no/?lang=fa'],
            ['@type' => 'ListItem', 'position' => 2, 'name' => 'وبلاگ', 'item' => BLOG_BASE . '/'],
            ['@type' => 'ListItem', 'position' => 3, 'name' => $a['h1'], 'item' => $url],
          ],
        ],
      ],
    ];
    // FAQPage schema (SEO, 2026-07-19) — only emitted for articles that
    // define a 'faq' array, so it stays accurate (Google penalizes FAQ
    // rich-result markup that doesn't match visible on-page content).
    if (!empty($a['faq'])) {
      $ld['@graph'][] = [
        '@type' => 'FAQPage',
        'mainEntity' => array_map(fn($f) => [
          '@type' => 'Question',
          'name' => $f['q'],
          'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f['a']],
        ], $a['faq']),
      ];
    }
    echo '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
    echo '</head><body dir="rtl"><div class="page-wrap">';
    // Simple nav
    echo '<nav class="nav"><a href="/?lang=fa" class="nav-logo"><img src="/assets/logo/setalink-mark-256.png" width="32" height="32" alt="Realink"><span class="brand-seta">Rea</span><span class="brand-link">link</span></a>';
    echo '<div class="nav-actions"><a href="/blog/" style="color:var(--muted);font-size:.9rem;margin-inline-end:1rem">وبلاگ</a>';
    echo '<a href="/download/setalink-latest.apk" class="btn-nav-dl"><span>دانلود فیلترشکن</span></a></div></nav>';
    // Breadcrumb + article shell
    echo '<article style="max-width:760px;margin:0 auto;padding:1.5rem 1.25rem 3rem;line-height:2;font-size:1.05rem">';
    echo '<nav aria-label="breadcrumb" style="font-size:.8rem;color:var(--muted-2);margin-bottom:1rem"><a href="/?lang=fa" style="color:var(--muted)">خانه</a> › <a href="/blog/" style="color:var(--muted)">وبلاگ</a> › ' . htmlspecialchars($a['h1']) . '</nav>';
    echo '<h1 style="font-size:2rem;line-height:1.4;margin-bottom:.5rem">' . htmlspecialchars($a['h1']) . '</h1>';
    echo '<p style="color:var(--muted-2);font-size:.85rem;margin-bottom:1.5rem">به‌روزرسانی ' . htmlspecialchars($a['date']) . ' · نویسنده: تیم ری‌لینک</p>';
}

// Renders the FAQ visibly in the article body — Google's FAQPage rich-result
// guidelines require the marked-up Q&A to actually be visible on the page,
// not schema-only. Call right before blog_footer() on articles that have
// an 'faq' array; shares the same data as the JSON-LD in blog_head().
function blog_faq(array $a): void {
    if (empty($a['faq'])) return;
    echo '<h2 style="font-size:1.2rem;margin-top:2rem">سوالات متداول</h2>';
    foreach ($a['faq'] as $f) {
        echo '<h3 style="font-size:1rem;margin:1rem 0 .3rem">' . htmlspecialchars($f['q']) . '</h3>';
        echo '<p>' . htmlspecialchars($f['a']) . '</p>';
    }
}

function blog_footer(array $a): void {
    global $BLOG_ARTICLES;
    // Related posts (the other articles) — internal links.
    echo '<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:2.5rem 0 1.5rem">';
    echo '<div style="background:linear-gradient(90deg,rgba(0,232,122,.1),rgba(51,153,255,.1));border:1px solid rgba(0,232,122,.25);border-radius:12px;padding:1.25rem;text-align:center;margin-bottom:2rem">';
    echo '<p style="margin:0 0 .8rem;font-weight:700">همین حالا ری‌لینک را نصب کن — ۵ گیگابایت رایگان، بدون ثبت‌نام</p>';
    echo '<a href="/download/setalink-latest.apk" class="btn-nav-dl" style="display:inline-flex">دانلود فیلترشکن اندروید</a></div>';
    echo '<h2 style="font-size:1.2rem">مطالب مرتبط</h2><ul>';
    foreach ($BLOG_ARTICLES as $slug => $art) {
        if ($slug === $a['slug']) continue;
        echo '<li style="margin:.4rem 0"><a href="/blog/' . $slug . '/" style="color:var(--accent,#00e87a)">' . htmlspecialchars($art['h1']) . '</a></li>';
    }
    echo '</ul>';
    echo '</article>';
    echo '<footer class="footer"><div class="footer-inner"><p class="footer-copy">© ' . date('Y') . ' Realink VPN · <a href="https://setai.no" rel="external" style="color:var(--gold)">SetAI</a></p></div></footer>';
    echo '</div></body></html>';
}
