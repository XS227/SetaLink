<?php
// Google Analytics (GA4) → admin dashboard sync (pure PHP, no Composer).
//
// Auth uses a SERVICE ACCOUNT, same pattern as gsc_sync.php: mint an RS256
// JWT, exchange it for an access token, call the GA4 Data API's runReport,
// cache the result (JSON) in settings so the admin page doesn't hit the
// live API on every pageview.
//
// SETUP (one-time, done by the owner in their Google account):
//   1. Google Cloud Console → same project as GSC is fine → enable
//      "Google Analytics Data API".
//   2. Reuse the existing GSC service account (GA4_KEY_PATH defaults to
//      the same file as GSC's), OR create a new one — either way, note
//      its e-mail (…@….iam.gserviceaccount.com).
//   3. In Google Analytics (analytics.google.com) → Admin → Property
//      Access Management (for the GA4 property, e.g. realgram.no) → add
//      that service-account e-mail with "Viewer" access.
//   4. Find the numeric GA4 Property ID: Admin → Property Settings
//      (looks like "properties/123456789" or just the number). Enter it
//      in the admin UI's Analytics page and click Sync.
//
// This is a DIFFERENT Google API/permission system from Search Console —
// granting GSC access does not grant GA4 access, even for the same
// service account. Both grants are needed if you want both integrations.

const GA4_KEY_PATH = '/var/www/setalink/data/gsc-service-account.json'; // reuse by default
const GA4_SCOPE     = 'https://www.googleapis.com/auth/analytics.readonly';

function ga4_b64url(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}

function ga4_http_post(string $url, array $headers, string $body, int $timeout = 30): array {
    $ctx = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", $headers),
        'content'       => $body,
        'timeout'       => $timeout,
        'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $code = (int)$m[1];
    }
    return [$code, (string)$resp];
}

function ga4_setting(PDO $db, string $key, ?string $set = null, string $default = ''): string {
    if ($set !== null) {
        $db->prepare("INSERT INTO settings (key,value) VALUES (?,?)
                      ON CONFLICT(key) DO UPDATE SET value=excluded.value")->execute([$key, $set]);
        return $set;
    }
    $r = $db->prepare("SELECT value FROM settings WHERE key=?");
    $r->execute([$key]);
    $v = $r->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function ga4_key_present(): bool {
    return is_readable(GA4_KEY_PATH) && filesize(GA4_KEY_PATH) > 100;
}

function ga4_access_token(PDO $db): string {
    $cached = ga4_setting($db, 'ga4_token');
    $exp    = (int) ga4_setting($db, 'ga4_token_exp', null, '0');
    if ($cached && $exp > time() + 120) return $cached;

    if (!ga4_key_present()) throw new RuntimeException('GA4 service-account key missing at ' . GA4_KEY_PATH);
    $sa = json_decode((string)file_get_contents(GA4_KEY_PATH), true);
    if (!isset($sa['client_email'], $sa['private_key'])) throw new RuntimeException('GA4 key JSON malformed');

    $now = time();
    $header = ga4_b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claim  = ga4_b64url(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => GA4_SCOPE,
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $signingInput = $header . '.' . $claim;
    $sig = '';
    if (!openssl_sign($signingInput, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('GA4 JWT signing failed');
    }
    $jwt = $signingInput . '.' . ga4_b64url($sig);

    [$code, $resp] = ga4_http_post(
        'https://oauth2.googleapis.com/token',
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        15
    );
    $data = json_decode((string)$resp, true);
    if ($code !== 200 || empty($data['access_token'])) {
        throw new RuntimeException('GA4 token exchange failed (' . $code . '): ' . substr((string)$resp, 0, 200));
    }
    ga4_setting($db, 'ga4_token', $data['access_token']);
    ga4_setting($db, 'ga4_token_exp', (string)($now + (int)($data['expires_in'] ?? 3600)));
    return $data['access_token'];
}

// One GA4 runReport call. $body is the request payload (dateRanges,
// dimensions, metrics, orderBys, limit — per the Data API v1beta schema).
function ga4_run_report(string $token, string $propertyId, array $body): array {
    $url = 'https://analyticsdata.googleapis.com/v1beta/properties/'
         . rawurlencode($propertyId) . ':runReport';
    [$code, $resp] = ga4_http_post(
        $url,
        ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        json_encode($body),
        30
    );
    $data = json_decode((string)$resp, true);
    if ($code !== 200) {
        $msg = $data['error']['message'] ?? substr((string)$resp, 0, 200);
        throw new RuntimeException('GA4 API error (' . $code . '): ' . $msg);
    }
    return $data;
}

// Flatten a runReport response into [[dim1, dim2, ..., metric1, ...], ...]
function ga4_flatten(array $report): array {
    $rows = [];
    foreach (($report['rows'] ?? []) as $r) {
        $vals = [];
        foreach (($r['dimensionValues'] ?? []) as $d) $vals[] = $d['value'] ?? '';
        foreach (($r['metricValues'] ?? []) as $m) $vals[] = $m['value'] ?? '0';
        $rows[] = $vals;
    }
    return $rows;
}

// Pull three reports (users-by-day, top pages, geography) for the last N
// days, cache the combined result as JSON in settings. Returns the summary.
function ga4_sync(PDO $db, int $days = 30): array {
    $propertyId = trim(ga4_setting($db, 'ga4_property_id'));
    if ($propertyId === '') throw new RuntimeException('GA4 property ID not set');
    $token = ga4_access_token($db);

    $range = [['startDate' => $days . 'daysAgo', 'endDate' => 'today']];

    $byDay = ga4_run_report($token, $propertyId, [
        'dateRanges' => $range,
        'dimensions' => [['name' => 'date']],
        'metrics'    => [['name' => 'activeUsers'], ['name' => 'screenPageViews']],
        'orderBys'   => [['dimension' => ['dimensionName' => 'date']]],
    ]);
    $pages = ga4_run_report($token, $propertyId, [
        'dateRanges' => $range,
        'dimensions' => [['name' => 'pagePath']],
        'metrics'    => [['name' => 'screenPageViews']],
        'orderBys'   => [['metric' => ['metricName' => 'screenPageViews'], 'desc' => true]],
        'limit'      => 15,
    ]);
    $geo = ga4_run_report($token, $propertyId, [
        'dateRanges' => $range,
        'dimensions' => [['name' => 'country']],
        'metrics'    => [['name' => 'activeUsers']],
        'orderBys'   => [['metric' => ['metricName' => 'activeUsers'], 'desc' => true]],
        'limit'      => 15,
    ]);
    $totals = ga4_run_report($token, $propertyId, [
        'dateRanges' => $range,
        'metrics'    => [['name' => 'activeUsers'], ['name' => 'newUsers'],
                          ['name' => 'screenPageViews'], ['name' => 'averageSessionDuration']],
    ]);
    $totalsFlat = ga4_flatten($totals);

    $cache = [
        'property_id' => $propertyId,
        'days'        => $days,
        'synced_at'   => date('c'),
        'totals'      => $totalsFlat[0] ?? ['0', '0', '0', '0'],
        'by_day'      => ga4_flatten($byDay),
        'pages'       => ga4_flatten($pages),
        'geo'         => ga4_flatten($geo),
    ];
    ga4_setting($db, 'ga4_cache', json_encode($cache));
    ga4_setting($db, 'ga4_last_sync', date('Y-m-d H:i:s'));
    return ['ok' => true] + $cache;
}
