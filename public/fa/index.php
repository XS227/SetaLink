<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Content-Language: fa');
$ref_code = '';
foreach (['ref','start'] as $key) {
    $v = trim((string)($_GET[$key] ?? ''));
    if (preg_match('/^[A-Z0-9]{4,20}$/i', $v)) { $ref_code = strtoupper($v); break; }
}
$dl_link   = '/download/setalink-latest.apk' . ($ref_code ? '?ref=' . urlencode($ref_code) : '');
$title     = 'ستالینک — فیلترشکن رایگان برای ایران | VPN اندروید';
$desc      = 'ستالینک: فیلترشکن هوشمند مبتنی بر هوش مصنوعی با پروتکل VLESS+Reality. ۱ گیگابایت رایگان بدون ثبت‌نام. بایپس DPI. اندروید.';
$keywords  = 'فیلترشکن رایگان, VPN ایران, فیلتر شکن اندروید, ستالینک, v2ray ایران, VLESS Reality, وی‌پی‌ان رایگان, دانلود فیلترشکن';
$canonical = 'https://setalink.no/fa/';
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<?php include __DIR__ . '/../includes/_head.php'; ?>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "ستالینک VPN",
  "operatingSystem": "Android",
  "applicationCategory": "NetworkingApplication",
  "description": "فیلترشکن هوشمند با پروتکل VLESS+Reality برای ایران. ۱ گیگابایت رایگان بدون ثبت‌نام.",
  "url": "https://setalink.no/fa/",
  "downloadUrl": "https://setalink.no/download/setalink-latest.apk",
  "offers": {"@type": "Offer", "price": "0", "priceCurrency": "IRR"},
  "inLanguage": "fa"
}
</script>
</head>
<body dir="rtl" style="font-family:'Vazirmatn','Inter',sans-serif">
<div class="page-wrap">

<nav class="nav">
  <a href="/fa/" class="nav-logo">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="32" height="32" alt="ستالینک">
    <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
  </a>
  <div class="nav-actions" style="flex-direction:row-reverse">
    <a href="/" style="font-size:.82rem;color:var(--text-2);text-decoration:none">English</a>
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      دانلود APK
    </a>
  </div>
</nav>

<?php if ($ref_code): ?>
<div style="background:linear-gradient(90deg,rgba(0,232,122,.12),rgba(51,153,255,.12));border-bottom:1px solid rgba(0,232,122,.25);padding:.85rem 1.25rem;text-align:center">
  <span style="font-size:.9rem;color:#e0ffe8">
    🎁 شما دعوت شده‌اید! اپ را نصب کنید و کد
    <strong style="font-family:monospace;color:#00e87a;background:rgba(0,232,122,.12);padding:.1em .45em;border-radius:5px"><?= htmlspecialchars($ref_code) ?></strong>
    را وارد کنید — هر دوی شما <strong>+۱ گیگابایت رایگان</strong> دریافت می‌کنید.
  </span>
</div>
<?php endif; ?>

<section class="hero">
  <div class="hero-glow"></div>
  <div class="hero-ring">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-128.png" class="hero-logo" width="112" height="112" alt="ستالینک">
  </div>
  <div class="hero-badge">
    <span class="dot-live"></span>
    سرور فعال &mdash; گره‌های نروژ و ترکیه
  </div>
  <h1>
    اینترنت آزاد<br>
    <span class="text-gradient">برای همه</span>
  </h1>
  <p class="hero-sub">
    فیلترشکن مبتنی بر هوش مصنوعی، ساخته‌شده برای سانسور واقعی. فقط اندروید. ۱ گیگابایت رایگان پس از نصب. بدون حساب. بدون تنظیمات.
  </p>
  <div class="hero-btns" style="direction:rtl">
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary" id="apk-dl-btn">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      دانلود APK
    </a>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-secondary">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>
      پیوستن به تلگرام
    </a>
  </div>
  <div class="hero-stats">
    <div class="hero-stat"><div class="hero-stat-num">۱ GB</div><div class="hero-stat-label">رایگان پس از نصب</div></div>
    <div class="hero-stat"><div class="hero-stat-num">۳</div><div class="hero-stat-label">پروتکل آزمایش‌شده</div></div>
    <div class="hero-stat"><div class="hero-stat-num">۰</div><div class="hero-stat-label">بدون نیاز به حساب</div></div>
    <div class="hero-stat"><div class="hero-stat-num">+۱ GB</div><div class="hero-stat-label">به ازای هر دعوت</div></div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="how">
  <div class="section-label">چطور کار می‌کند</div>
  <h2 class="section-title">سه گام به اینترنت آزاد</h2>
  <p class="section-sub">بدون حساب، بدون کارت اعتباری، بدون تنظیمات. نصب کن و وصل شو.</p>
  <div class="steps-bento">
    <div class="step-card" style="text-align:right">
      <div class="step-num">۱</div>
      <h3>دسترسی اضطراری</h3>
      <p>APK را نصب کن و فوری ۱ گیگابایت بگیر — بدون لاگین، بدون حساب. Connect را بزن و هوش مصنوعی سریع‌ترین پروتکل را انتخاب می‌کند.</p>
    </div>
    <div class="step-card" style="text-align:right">
      <div class="step-num">۲</div>
      <h3>دعوت و کسب داده</h3>
      <p>کد دعوت خود را به اشتراک بگذار. هر کسی که بپیوندد ۱ گیگابایت به هر دوی شما اضافه می‌کند. هرچه بیشتر وصل شوند، شبکه قوی‌تر و ارزان‌تر می‌شود.</p>
    </div>
    <div class="step-card" style="text-align:right">
      <div class="step-num">۳</div>
      <h3>هوش مصنوعی بهترین مسیر را انتخاب می‌کند</h3>
      <p>Reality، XHTTP و WebSocket به صورت موازی آزمایش می‌شوند. تنها مسیری که داده HTTP واقعی برمی‌گرداند متصل اعلام می‌شود — هیچ وضعیت متصل جعلی وجود ندارد.</p>
    </div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="why">
  <div class="section-label">چرا ستالینک</div>
  <h2 class="section-title">ساخته‌شده برای سانسور واقعی</h2>
  <p class="section-sub">یک پوشش VPN عمومی نیست. از صفر برای واقعیت‌های ایران ساخته شده.</p>
  <div class="why-grid">
    <div class="why-card" style="text-align:right">
      <div class="why-card-title">برتری فنی</div>
      <ul class="why-list" style="text-align:right">
        <li>VLESS + Reality — ترافیکی که از HTTPS استاندارد قابل تشخیص نیست، مقاوم‌ترین پروتکل موجود در برابر DPI</li>
        <li>DNS-over-HTTPS از طریق تونل VPN — مانع مسموم‌سازی DNS توسط ISP می‌شود</li>
        <li>XHTTP و WebSocket به عنوان پروتکل پشتیبان از طریق پروکسی nginx</li>
        <li>بدون لاگ، بدون ثبت‌نام برای دسترسی اضطراری</li>
        <li>SNI probing تأیید می‌کند کدام دامنه‌ها از ISP شما کار می‌کنند</li>
      </ul>
    </div>
    <div class="why-card" style="text-align:right">
      <div class="why-card-title">مدل جامعه‌محور</div>
      <ul class="why-list" style="text-align:right">
        <li>کاربران بیشتر = هزینه کمتر برای هر کاربر — زیرساخت مشترک</li>
        <li>پاداش دعوت هم دعوت‌کننده و هم دعوت‌شونده را جایزه می‌دهد</li>
        <li>پشتیبانی جامعه، نه سرمایه‌گذار — تصمیمات با کاربران همسو</li>
        <li>آینده: گسترش سرور با تأمین مالی کاربران — رأی‌گیری برای مناطق جدید</li>
      </ul>
    </div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="faq">
  <div class="faq-section">
    <div class="section-label">سوالات متداول</div>
    <h2 class="section-title">سوالات رایج</h2>
    <p class="section-sub" style="margin:0 auto">سوالات واقعی درباره نحوه عملکرد ستالینک.</p>
  </div>
  <div class="faq-list" style="text-align:right">
    <?php
    $faqs_fa = [
      ['سیستم دعوت چطور کار می‌کند؟',
       'وقتی ستالینک را نصب می‌کنی، یک کد دعوت منحصربه‌فرد دریافت می‌کنی. با دوستانت به اشتراک بگذار. وقتی دوستی اپ را نصب کند و کد تو را وارد کند، هر دوی شما +۱ گیگابایت اضافی دریافت می‌کنید. محدودیتی در تعداد دعوت‌ها وجود ندارد.'],
      ['بسته ۱ گیگابایت اضطراری چیست؟',
       'هر دستگاه جدیدی که ستالینک را نصب کند، به طور خودکار ۱ گیگابایت داده رایگان دریافت می‌کند — بدون حساب، بدون لاگین، بدون کارت اعتباری. طراحی شده برای اینکه هر کسی که ناگهان به اینترنت دسترسی ندارد، بتواند فوری به اینترنت آزاد برگردد.'],
      ['بهینه‌ساز پروتکل با هوش مصنوعی چطور کار می‌کند؟',
       'در هر تلاش اتصال، اپ سه پروتکل را به صورت موازی آزمایش می‌کند: VLESS+Reality، XHTTP و WebSocket. برای هر پروتکل، یک پروب HTTP واقعی انجام می‌دهد — نه فقط دست دادن TCP. اولین پروتکلی که داده HTTP واقعی برگرداند، برنده می‌شود. وضعیت متصل جعلی غیرممکن است.'],
      ['آیا ستالینک لاگ نگه می‌دارد؟',
       'هیچ لاگ فعالیت کاربری وجود ندارد. شناسه‌های دستگاه هش‌های ناشناس هستند. آمار مجموع ذخیره می‌شود اما قابل ردیابی به کاربران فردی نیست.'],
      ['چرا فقط اندروید؟',
       'اندروید VPN مبتنی بر TUN را بدون محدودیت App Store امکان‌پذیر می‌کند. iOS نیاز به توزیع App Store و انطباق با سیاست‌های Apple دارد — ناسازگار با اجرای یک ابزار دور زدن سانسور به صورت آزاد. بازار هدف اصلی (ایران) سهم بالای اندروید دارد.'],
      ['وقتی ایران یک SNI جدید را بلاک می‌کند چه اتفاقی می‌افتد؟',
       'سیستم Remote Config به ادمین اجازه می‌دهد لیست‌های اولویت SNI به‌روزشده را بدون نیاز به به‌روزرسانی اپ به همه بفرستد. بهینه‌ساز هوش مصنوعی هم SNIهای بلاک‌شده را به طور خودکار در اولویت کاهش می‌دهد.'],
    ];
    foreach ($faqs_fa as $i => [$q, $a]): ?>
    <div class="faq-item" id="faq-fa-<?= $i ?>">
      <button class="faq-q" aria-expanded="false" style="text-align:right">
        <?= htmlspecialchars($q) ?>
        <svg class="faq-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="faq-a" style="text-align:right"><?= htmlspecialchars($a) ?></div>
    </div>
    <?php endforeach; ?>
  </div>
</section>

<div class="divider"></div>

<footer class="footer">
  <div class="footer-inner" style="flex-direction:row-reverse">
    <div class="footer-brand">
      <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="ستالینک" style="border-radius:7px">
      <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
    </div>
    <nav class="footer-links" style="flex-direction:row-reverse">
      <a href="/faq.php">سوالات کامل</a>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener">تلگرام</a>
      <a href="https://github.com/XS227/SetaLink" target="_blank" rel="noopener">گیت‌هاب</a>
      <a href="<?= htmlspecialchars($dl_link) ?>">دانلود APK</a>
      <a href="/">English</a>
    </nav>
    <p class="footer-copy">&copy; <?= date('Y') ?> SetaLink VPN · فقط اندروید</p>
  </div>
</footer>

</div>
<script src="/js/main.js" defer></script>
<script>
// Track APK downloads on Persian page
document.getElementById('apk-dl-btn').addEventListener('click', function() {
  if (typeof gtag === 'function') gtag('event', 'apk_download', {page: 'fa'});
});
</script>
</body>
</html>
