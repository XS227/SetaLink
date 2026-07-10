<?php
require __DIR__ . '/inc.php';
$title = 'وبلاگ ری‌لینک | راهنمای فیلترشکن و عبور از فیلترینگ در ایران';
$desc  = 'راهنماها و مقاله‌های ری‌لینک درباره بهترین فیلترشکن رایگان، اتصال پایدار و بدون قطعی، و پروتکل‌های عبور از فیلترینگ مثل V2Ray، VLESS و Reality.';
$url   = BLOG_BASE . '/';
?><!DOCTYPE html><html lang="fa" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($title, ENT_QUOTES) ?></title>
<meta name="description" content="<?= htmlspecialchars($desc, ENT_QUOTES) ?>">
<meta name="keywords" content="فیلترشکن, راهنمای فیلترشکن, وبلاگ فیلترشکن, عبور از فیلترینگ, V2Ray ایران, بهترین فیلترشکن">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="<?= $url ?>">
<link rel="alternate" hreflang="fa" href="<?= $url ?>"><link rel="alternate" hreflang="x-default" href="<?= $url ?>">
<meta property="og:type" content="website"><meta property="og:locale" content="fa_IR">
<meta property="og:title" content="<?= htmlspecialchars($title, ENT_QUOTES) ?>">
<meta property="og:description" content="<?= htmlspecialchars($desc, ENT_QUOTES) ?>">
<meta property="og:url" content="<?= $url ?>"><meta property="og:image" content="<?= $OG_IMG ?>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" type="image/png" href="/assets/logo/setalink-mark-256.png">
<link rel="stylesheet" href="/css/main.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QVDJGX86KT"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-QVDJGX86KT");</script>
<script type="application/ld+json"><?= json_encode([
  '@context'=>'https://schema.org','@type'=>'Blog','name'=>'وبلاگ ری‌لینک','url'=>$url,'inLanguage'=>'fa',
  'publisher'=>['@type'=>'Organization','name'=>'Realink VPN','url'=>'https://setalink.no'],
  'blogPost'=>array_map(fn($s,$a)=>['@type'=>'BlogPosting','headline'=>$a['h1'],'url'=>BLOG_BASE.'/'.$s.'/','datePublished'=>$a['date']], array_keys($BLOG_ARTICLES), $BLOG_ARTICLES),
], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES) ?></script>
</head><body dir="rtl"><div class="page-wrap">
<nav class="nav"><a href="/?lang=fa" class="nav-logo"><img src="/assets/logo/setalink-mark-256.png" width="32" height="32" alt="Realink"><span class="brand-seta">Rea</span><span class="brand-link">link</span></a>
<div class="nav-actions"><a href="/download/setalink-latest.apk" class="btn-nav-dl"><span>دانلود فیلترشکن</span></a></div></nav>
<section style="max-width:820px;margin:0 auto;padding:2rem 1.25rem 3rem">
  <h1 style="font-size:2rem">وبلاگ ری‌لینک — راهنمای فیلترشکن</h1>
  <p style="color:var(--muted-2);margin-bottom:2rem">راهنماهای عملی درباره انتخاب فیلترشکن، اتصال پایدار و فناوری عبور از فیلترینگ در ایران.</p>
  <div style="display:grid;gap:1rem">
  <?php foreach ($BLOG_ARTICLES as $slug => $a): ?>
    <a href="/blog/<?= $slug ?>/" style="display:block;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.25rem;text-decoration:none">
      <h2 style="font-size:1.25rem;margin:0 0 .4rem;color:#fff"><?= htmlspecialchars($a['h1']) ?></h2>
      <p style="margin:0 0 .5rem;color:var(--muted)"><?= htmlspecialchars($a['excerpt']) ?></p>
      <span style="color:var(--accent,#00e87a);font-size:.85rem">خواندن مقاله ←</span>
    </a>
  <?php endforeach; ?>
  </div>
</section>
<footer class="footer"><div class="footer-inner"><p class="footer-copy">© <?= date('Y') ?> Realink VPN · <a href="https://setai.no" rel="external" style="color:var(--gold)">SetAI</a></p></div></footer>
</div></body></html>
