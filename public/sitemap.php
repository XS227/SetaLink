<?php
header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=86400');

$base    = 'https://setalink.no';
$today   = date('Y-m-d');

$urls = [
  ['loc' => '/',             'priority' => '1.0', 'changefreq' => 'weekly'],
  ['loc' => '/faq.php',      'priority' => '0.8', 'changefreq' => 'monthly'],
  ['loc' => '/fa/',          'priority' => '0.9', 'changefreq' => 'weekly'],
  ['loc' => '/iran-vpn/',    'priority' => '0.9', 'changefreq' => 'monthly'],
  ['loc' => '/v2ray-iran/',  'priority' => '0.8', 'changefreq' => 'monthly'],
  ['loc' => '/tr/',          'priority' => '0.8', 'changefreq' => 'weekly'],
  ['loc' => '/privacy-vpn/', 'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/',        'priority' => '0.8', 'changefreq' => 'weekly'],
  ['loc' => '/blog/best-free-vpn-iran/',                'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/stable-filtershekan-no-disconnect/', 'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/what-is-v2ray-vless-reality/',       'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/filtershekan-instagram/',            'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/filtershekan-whatsapp/',              'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/filtershekan-carrier-guide/',         'priority' => '0.7', 'changefreq' => 'monthly'],
  ['loc' => '/blog/filtershekan-irancell-disconnect/',   'priority' => '0.7', 'changefreq' => 'monthly'],
];

// hreflang alternates for the homepage — the 4 UI locales served by ?lang=.
// Declared here (and in the page <head>) so Google clusters them as locale
// variants of one page rather than duplicates.
$home_alts = [
  'en'        => $base . '/',
  'fa'        => $base . '/?lang=fa',
  'zh'        => $base . '/?lang=zh',
  'ru'        => $base . '/?lang=ru',
  'x-default' => $base . '/',
];

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' .
     ' xmlns:xhtml="http://www.w3.org/1999/xhtml">' . "\n";
foreach ($urls as $u) {
    // Only include pages that actually exist
    $exists = ($u['loc'] === '/')
        || file_exists(__DIR__ . $u['loc'])                             // direct file e.g. /faq.php
        || file_exists(rtrim(__DIR__ . $u['loc'], '/') . '/index.php') // directory/index.php
        || file_exists(rtrim(__DIR__ . $u['loc'], '/') . '.php');      // /slug → /slug.php
    if (!$exists) continue;
    echo "  <url>\n";
    echo "    <loc>" . htmlspecialchars($base . $u['loc']) . "</loc>\n";
    if ($u['loc'] === '/') {
        foreach ($home_alts as $hl => $href) {
            echo "    <xhtml:link rel=\"alternate\" hreflang=\"" . $hl .
                 "\" href=\"" . htmlspecialchars($href) . "\"/>\n";
        }
    }
    echo "    <lastmod>{$today}</lastmod>\n";
    echo "    <changefreq>{$u['changefreq']}</changefreq>\n";
    echo "    <priority>{$u['priority']}</priority>\n";
    echo "  </url>\n";
}
echo '</urlset>';
