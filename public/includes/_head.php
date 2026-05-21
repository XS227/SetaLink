<?php
/**
 * Shared <head> partial for SetaLink landing pages.
 * Call with: include __DIR__ . '/../includes/_head.php';
 * Required vars (set before include):
 *   $title       string
 *   $desc        string
 *   $canonical   string (full URL)
 *   $lang        string  'en' | 'fa' | 'tr' | 'no'
 *   $og_img      string (optional, defaults to app icon)
 *   $keywords    string (optional)
 */
$og_img   = $og_img   ?? 'https://setalink.no/assets/logo/shirokhorshid/app-icon-connected-512.png';
$keywords = $keywords ?? 'VPN Iran, anti-censorship VPN, free VPN, Reality protocol, VLESS';
$ga_id    = 'G-QVDJGX86KT';
?>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($title) ?></title>
<meta name="description" content="<?= htmlspecialchars($desc) ?>">
<meta name="keywords" content="<?= htmlspecialchars($keywords) ?>">
<meta name="robots" content="index,follow">
<link rel="canonical" href="<?= htmlspecialchars($canonical) ?>">
<meta name="google-site-verification" content="7LR7rEIJvSWpajIB1Ei5wGNNBlx2chBCNnsRKuQgLG4">
<!-- Open Graph -->
<meta property="og:type"        content="website">
<meta property="og:url"         content="<?= htmlspecialchars($canonical) ?>">
<meta property="og:title"       content="<?= htmlspecialchars($title) ?>">
<meta property="og:description" content="<?= htmlspecialchars($desc) ?>">
<meta property="og:image"       content="<?= htmlspecialchars($og_img) ?>">
<meta property="og:site_name"   content="SetaLink VPN">
<!-- Twitter -->
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="<?= htmlspecialchars($title) ?>">
<meta name="twitter:description" content="<?= htmlspecialchars($desc) ?>">
<meta name="twitter:image"       content="<?= htmlspecialchars($og_img) ?>">
<!-- Fonts + styles -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Vazirmatn:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="icon" type="image/x-icon" href="/assets/logo/shirokhorshid/favicon.ico">
<link rel="apple-touch-icon" href="/assets/logo/shirokhorshid/app-icon-connected-180.png">
<link rel="stylesheet" href="/css/main.css">
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=<?= $ga_id ?>"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','<?= $ga_id ?>');</script>
