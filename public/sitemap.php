<?php
header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=86400');

$base    = 'https://setalink.no';
$today   = date('Y-m-d');

$urls = [
  ['loc' => '/',            'priority' => '1.0', 'changefreq' => 'weekly'],
  ['loc' => '/faq.php',     'priority' => '0.8', 'changefreq' => 'monthly'],
  ['loc' => '/fa/',         'priority' => '0.9', 'changefreq' => 'weekly'],
  ['loc' => '/iran-vpn/',   'priority' => '0.9', 'changefreq' => 'monthly'],
  ['loc' => '/v2ray-iran/', 'priority' => '0.8', 'changefreq' => 'monthly'],
  ['loc' => '/tr/',         'priority' => '0.8', 'changefreq' => 'weekly'],
  ['loc' => '/privacy-vpn/','priority' => '0.7', 'changefreq' => 'monthly'],
];

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($urls as $u) {
    // Only include pages that actually exist
    $path = __DIR__ . rtrim($u['loc'], '/');
    $path_idx = $path . '/index.php';
    $path_php  = rtrim(__DIR__ . $u['loc'], '/');
    $exists = ($u['loc'] === '/')
        || file_exists(__DIR__ . $u['loc'] . 'index.php')
        || file_exists(rtrim(__DIR__ . $u['loc'], '/') . '.php');
    if (!$exists) continue;
    echo "  <url>\n";
    echo "    <loc>" . htmlspecialchars($base . $u['loc']) . "</loc>\n";
    echo "    <lastmod>{$today}</lastmod>\n";
    echo "    <changefreq>{$u['changefreq']}</changefreq>\n";
    echo "    <priority>{$u['priority']}</priority>\n";
    echo "  </url>\n";
}
echo '</urlset>';
