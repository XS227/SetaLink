<?php
// Shared blog chrome + article registry. Persian-first (RTL), reuses the site's
// css/main.css. Each article file defines $a and calls blog_head()/blog_footer().
// The registry powers the index list, "related posts", and the sitemap.

const BLOG_BASE = 'https://setalink.no/blog';
$LOGO   = '/assets/logo/setalink-mark-256.png';
$OG_IMG = 'https://setalink.no' . $LOGO;

// slug => metadata. body lives in each article's own index.php.
$BLOG_ARTICLES = [
  'best-free-vpn-iran' => [
    'title' => 'بهترین فیلترشکن رایگان برای ایران در ۲۰۲۶ | راهنمای انتخاب',
    'h1'    => 'بهترین فیلترشکن رایگان برای ایران (۲۰۲۶)',
    'desc'  => 'راهنمای انتخاب بهترین فیلترشکن رایگان و پرسرعت برای ایران در سال ۲۰۲۶: پروتکل‌ها، معیارها و چرا ری‌لینک با VLESS+Reality از DPI عبور می‌کند. ۵ گیگابایت رایگان.',
    'keywords' => 'بهترین فیلترشکن, فیلترشکن رایگان, فیلترشکن پرسرعت, فیلترشکن ایران, دانلود فیلترشکن',
    'date'  => '2026-07-10',
    'excerpt' => 'چطور بین ده‌ها فیلترشکن، یکی که واقعاً در ایران کار می‌کند را انتخاب کنیم؟ معیارهای مهم و مقایسه پروتکل‌ها.',
  ],
  'stable-filtershekan-no-disconnect' => [
    'title' => 'چرا فیلترشکن قطع می‌شود؟ راهکار اتصال پایدار و بدون قطعی',
    'h1'    => 'چرا فیلترشکن قطع می‌شود و چطور اتصال پایدار داشته باشیم',
    'desc'  => 'دلایل قطع‌شدن فیلترشکن در ایران (DPI، مسدودسازی SNI، مشکل QUIC) و راهکارهای عملی برای اتصال پایدار و بدون قطعی با ری‌لینک.',
    'keywords' => 'فیلترشکن بدون قطعی, فیلترشکن قطع میشود, فیلترشکن پایدار, فیلترشکن پرسرعت, اتصال فیلترشکن',
    'date'  => '2026-07-10',
    'excerpt' => 'قطع‌شدن مداوم فیلترشکن آزاردهنده است. چرا اتفاق می‌افتد و چطور یک اتصال پایدار بسازیم.',
  ],
  'filtershekan-carrier-guide' => [
    'title' => 'کدام فیلترشکن روی اپراتور شما کار می‌کند؟ همراه اول، ایرانسل، رایتل، مخابرات',
    'h1'    => 'کدام فیلترشکن روی اپراتور شما کار می‌کند؟ (همراه اول، ایرانسل، رایتل، مخابرات)',
    'desc'  => 'فیلترشکن ایرانسل، همراه اول، رایتل و مخابرات یکسان کار نمی‌کنند. راهنمای مبتنی بر داده واقعی: روی هر اپراتور کدام سرور و کدام روش وصل می‌شود — و چرا سرور Stealth روی ایرانسل جواب می‌دهد.',
    'keywords' => 'فیلترشکن ایرانسل, فیلترشکن همراه اول, فیلترشکن رایتل, فیلترشکن مخابرات, بهترین فیلترشکن برای ایرانسل',
    'date'  => '2026-07-12',
    'excerpt' => 'فیلترینگ روی هر اپراتور فرق دارد: چیزی که روی همراه اول کار می‌کند، روی ایرانسل بسته است. راهنمای اپراتور به اپراتور.',
  ],
  'filtershekan-instagram' => [
    'title' => 'فیلترشکن اینستاگرام: چرا باز نمی‌شود و راه‌حل قطعی (راهنمای ۱۴۰۵)',
    'h1'    => 'فیلترشکن اینستاگرام — چرا لود نمی‌شود و چطور درستش کنیم',
    'desc'  => 'فیلترشکن وصل است ولی اینستاگرام باز نمی‌شود؟ مشکل از QUIC است. راهنمای عملی: force-quit بعد از اتصال، سرور Stealth برای ایرانسل و مخابرات، و فیلترشکنی که ویدیو و استوری را واقعاً لود می‌کند.',
    'keywords' => 'فیلترشکن اینستاگرام, فیلترشکن برای اینستاگرام, باز کردن اینستاگرام, بهترین فیلترشکن برای اینستاگرام, اینستاگرام باز نمیشه',
    'date'  => '2026-07-13',
    'excerpt' => 'اینستاگرام با فیلترشکن لود نمی‌شود؟ دلیل فنی مشخصی دارد (QUIC) و راه‌حلش سه قدم ساده است.',
  ],
  'filtershekan-whatsapp' => [
    'title' => 'فیلترشکن واتساپ: پیام می‌رود ولی تماس وصل نمی‌شود؟ راه‌حل کامل',
    'h1'    => 'فیلترشکن واتساپ — پیام، تماس و ویدیو بدون قطعی',
    'desc'  => 'تماس واتساپ با فیلترشکن وصل نمی‌شود؟ تماس‌ها UDP می‌خواهند و خیلی از فیلترشکن‌ها عبورش نمی‌دهند. راهنمای عملی: تونل تمام‌دستگاه، force-quit بعد از اتصال و سرور Stealth برای ایرانسل.',
    'keywords' => 'فیلترشکن واتساپ, فیلترشکن برای واتساپ, تماس واتساپ وصل نمیشود, فیلترشکن تلگرام',
    'date'  => '2026-07-13',
    'excerpt' => 'چرا پیام واتساپ می‌رود ولی تماس نه؟ مشکل UDP است — و چک‌لیست چهار قدمی برای اتصال پایدار.',
  ],
  'filtershekan-irancell-disconnect' => [
    'title' => 'چرا فیلترشکن روی ایرانسل قطع می‌شود؟ راه‌حل قطعی نشدن',
    'h1'    => 'چرا فیلترشکن روی ایرانسل قطع می‌شود و راه‌حل آن',
    'desc'  => 'فیلترشکن روی ایرانسل وصل نمی‌شود یا مدام قطع می‌شود؟ دلیلش سیاه‌چاله شدن IPهای دیتاسنتری روی ایرانسل است. راه‌حل: سرور Stealth پشت CDN و حالت Auto در ری‌لینک — فیلترشکن ایرانسل که قطع نمی‌شود.',
    'keywords' => 'فیلترشکن ایرانسل که قطع نمیشه, فیلترشکن ایرانسل, فیلترشکن برای ایرانسل که کار کنه, چرا فیلترشکن قطع میشه',
    'date'  => '2026-07-12',
    'excerpt' => 'ایرانسل سخت‌گیرترین اپراتور با سرورهای خارجی است. چرا فیلترشکن رویش قطع می‌شود و چه راهی واقعاً جواب می‌دهد.',
  ],
  'what-is-v2ray-vless-reality' => [
    'title' => 'V2Ray، VLESS و Reality چیست؟ راهنمای عبور از فیلترینگ',
    'h1'    => 'V2Ray، VLESS و Reality چیست؟ راهنمای ساده عبور از فیلترینگ',
    'desc'  => 'توضیح ساده V2Ray، VLESS و پروتکل Reality و اینکه چرا این‌ها بهترین روش عبور از فیلترینگ و DPI در ایران هستند — بدون تنظیمات پیچیده با ری‌لینک.',
    'keywords' => 'V2Ray ایران, VLESS, Reality, عبور از فیلترینگ, فیلترشکن قوی, بایپس DPI',
    'date'  => '2026-07-10',
    'excerpt' => 'V2Ray، VLESS و Reality پشت فیلترشکن‌های مدرن هستند. به زبان ساده توضیح می‌دهیم چطور کار می‌کنند.',
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
