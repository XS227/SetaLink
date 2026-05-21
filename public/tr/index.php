<?php
header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Content-Language: tr');
$dl_link   = '/download/setalink-latest.apk';
$title     = 'SetaLink — Türkiye için Ücretsiz VPN | Sansür Engelleyici Android VPN';
$desc      = 'SetaLink, Türkiye\'de sansürü aşmak için tasarlanmış yapay zeka destekli VPN. VLESS+Reality protokolü, DNS-over-HTTPS, 1 GB ücretsiz. Hesap gerekmez. Sadece Android.';
$keywords  = 'VPN Türkiye, ücretsiz VPN Türkiye, Türkiye sansür aşma, Reality VPN, VLESS Android, anti-sansür VPN';
$canonical = 'https://setalink.no/tr/';
?>
<!DOCTYPE html>
<html lang="tr" dir="ltr">
<head>
<?php include __DIR__ . '/../includes/_head.php'; ?>
</head>
<body dir="ltr">
<div class="page-wrap">

<nav class="nav">
  <a href="/" class="nav-logo">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="32" height="32" alt="SetaLink">
    <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
  </a>
  <div class="nav-actions">
    <a href="/" style="font-size:.82rem;color:var(--text-2);text-decoration:none">English</a>
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn-nav-dl">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      APK İndir
    </a>
  </div>
</nav>

<section class="hero">
  <div class="hero-glow"></div>
  <div class="hero-ring">
    <img src="/assets/logo/shirokhorshid/logo-mark-connected-128.png" class="hero-logo" width="112" height="112" alt="SetaLink VPN Türkiye">
  </div>
  <div class="hero-badge"><span class="dot-live"></span>Sunucu Aktif &mdash; Norveç &amp; Türkiye</div>
  <h1>
    Türkiye için<br>
    <span class="text-gradient">Ücretsiz VPN</span>
  </h1>
  <p class="hero-sub">
    Yapay zeka destekli VLESS+Reality VPN. Türkiye'nin DPI engellerini aşar. DNS-over-HTTPS ile DNS zehirlenmesini engeller. Kurulum anında 1 GB ücretsiz. Hesap gerekmez.
  </p>
  <div class="hero-btns">
    <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
      APK'yı Ücretsiz İndir
    </a>
    <a href="https://t.me/SetaLink3" target="_blank" rel="noopener" class="btn btn-secondary">Telegram'a Katıl</a>
  </div>
  <div class="hero-stats">
    <div class="hero-stat"><div class="hero-stat-num">1 GB</div><div class="hero-stat-label">Kurulumda ücretsiz</div></div>
    <div class="hero-stat"><div class="hero-stat-num">Reality</div><div class="hero-stat-label">Kullanılan protokol</div></div>
    <div class="hero-stat"><div class="hero-stat-num">DoH</div><div class="hero-stat-label">DNS koruması</div></div>
    <div class="hero-stat"><div class="hero-stat-num">0</div><div class="hero-stat-label">Hesap gerekmez</div></div>
  </div>
</section>

<div class="divider"></div>

<section class="section">
  <div class="section-label">NEDEN SETALINK</div>
  <h2 class="section-title">Türkiye'nin Sansürünü Aşmak İçin Tasarlandı</h2>
  <div class="why-grid">
    <div class="why-card">
      <div class="why-card-title">TEKNİK ÜSTÜNLÜK</div>
      <ul class="why-list">
        <li>VLESS + Reality — trafik standart HTTPS'den ayırt edilemez, DPI'ye karşı en dirençli protokol</li>
        <li>DNS-over-HTTPS tüneli — ISP DNS zehirlenmesini engeller</li>
        <li>XHTTP ve WebSocket yedek protokolleri nginx proxy üzerinden</li>
        <li>Yapay zeka ISP'nize göre en hızlı çalışan protokolü seçer</li>
        <li>Log yok, kayıt gerekmez</li>
      </ul>
    </div>
    <div class="why-card">
      <div class="why-card-title">TOPLULUK MODELİ</div>
      <ul class="why-list">
        <li>Daha fazla kullanıcı = kullanıcı başına daha düşük maliyet</li>
        <li>Davet bonusu — hem davet eden hem de davet edilen +1 GB kazanır</li>
        <li>VC destekli değil, topluluk destekli</li>
        <li>Gelecek: kullanıcıların oylamasıyla yeni bölgeler ve sunucular</li>
      </ul>
    </div>
  </div>
</section>

<div class="divider"></div>

<section class="section" id="faq">
  <div class="faq-section">
    <div class="section-label">SSS</div>
    <h2 class="section-title">Sık Sorulan Sorular</h2>
  </div>
  <div class="faq-list">
    <?php
    $faqs = [
      ['SetaLink Türkiye\'de nasıl çalışır?',
       'SetaLink, VLESS+Reality protokolünü kullanır. Bu protokol, tünel trafiğini www.microsoft.com gibi meşru bir alan adına normal TLS 1.3 el sıkışmasından ayırt edilemez kılar. Türkiye\'nin DPI altyapısı bunu VPN olarak tespit edemez. AI, ISP\'nize göre en hızlı çalışan rotayı otomatik olarak seçer.'],
      ['DNS-over-HTTPS neden önemli?',
       'Türk ISP\'leri zaman zaman engellenen alan adları için DNS yanıtlarını zehirler. SetaLink, tüm DNS sorgularını şifreli VPN tüneli üzerinden DoH (1.1.1.1, 8.8.8.8, 9.9.9.9) kullanarak yönlendirir. ISP artık DNS\'inizi durduramaz veya yeniden yönlendiremez.'],
      ['Davet sistemi nasıl çalışır?',
       'SetaLink\'i kurduğunuzda benzersiz bir davet kodu alırsınız. Arkadaşlarınızla paylaşın. Bir arkadaş uygulamayı yükleyip kodunuzu kullandığında, ikiniz de +1 GB ek veri alırsınız. Davet sayısında sınır yoktur.'],
      ['Neden sadece Android?',
       'Android, App Store kısıtlamaları olmadan tam TUN tabanlı VPN\'e izin verir. iOS, App Store dağıtımı ve Apple politikasına uyum gerektirir. Türkiye ve İran\'daki birincil hedef pazarımız için Android sürümü önceliklidir.'],
    ];
    foreach ($faqs as $i => [$q, $a]): ?>
    <div class="faq-item">
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

<section class="section" style="text-align:center;padding-bottom:80px">
  <h2 class="section-title" style="margin-bottom:16px">Türkiye'nin sansürünü aşmaya hazır mısınız?</h2>
  <a href="<?= htmlspecialchars($dl_link) ?>" class="btn btn-primary" style="font-size:1.05rem;padding:.8rem 2rem">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 12l-4-4h2.5V4h3v4H12L8 12z"/><rect x="2" y="13" width="12" height="1.5" rx=".75"/></svg>
    SetaLink APK'yı Ücretsiz İndir
  </a>
  <p style="margin-top:16px;font-size:.8rem;color:var(--text-3)">Sadece Android · Play Store gerekmez · Doğrudan APK indirme</p>
</section>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <img src="/assets/logo/shirokhorshid/logo-mark-connected-32.png" width="28" height="28" alt="SetaLink" style="border-radius:7px">
      <span class="brand-seta">Seta</span><span class="brand-link">Link</span>
    </div>
    <nav class="footer-links">
      <a href="/">English</a>
      <a href="/fa/">فارسی</a>
      <a href="/faq.php">FAQ</a>
      <a href="https://t.me/SetaLink3" target="_blank" rel="noopener">Telegram</a>
      <a href="<?= htmlspecialchars($dl_link) ?>">APK İndir</a>
    </nav>
    <p class="footer-copy">&copy; <?= date('Y') ?> SetaLink VPN · Sadece Android</p>
  </div>
</footer>

</div>
<script src="/js/main.js" defer></script>
</body>
</html>
