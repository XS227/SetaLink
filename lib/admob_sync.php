<?php
/**
 * AdMob Reporting API sync (pure PHP, no Composer) — real provider revenue for
 * /admin/monetization, replacing the eCPM-guess in lib/ads_perf.php.
 *
 * Auth is standard OAuth 2.0 user consent (authorization-code + refresh token),
 * NOT a service account — unlike GA4/GSC (admin/ga4_sync.php, admin/gsc_sync.php),
 * the AdMob API has no delegated service-account access model. This means a
 * one-time human consent step is unavoidable; there is no credential I can
 * generate myself that skips it.
 *
 * SETUP (one-time, done by the account owner — see docs/realgram/MONETIZATION_REPORTING.md):
 *   1. Google Cloud Console → a project with the AdMob API enabled.
 *   2. Create an OAuth 2.0 Client ID (type: Web application), with an
 *      Authorized redirect URI of https://setalink.no/admin/admob_oauth_callback.php
 *   3. Put {"client_id":"...","client_secret":"..."} in ADMOB_CLIENT_CONFIG_PATH
 *      (root-only file, never committed — same posture as setalink.env).
 *   4. In RealGram Admin → Monetization → Configuration, click "Connect AdMob"
 *      and complete Google's consent screen once. The resulting refresh token
 *      is stored in ADMOB_TOKEN_PATH (0640, same permission pattern as
 *      data/gsc-service-account.json) — never in the database, never returned
 *      by any admin/api.php JSON response.
 *
 * Until both files exist, admob_connected() is false and the admin UI shows
 * "Not configured" — never a fabricated revenue number.
 */

declare(strict_types=1);

const ADMOB_CLIENT_CONFIG_PATH = '/etc/setalink/admob-oauth-client.json';
const ADMOB_TOKEN_PATH         = '/var/www/setalink/data/admob-oauth.json';
const ADMOB_SCOPE              = 'https://www.googleapis.com/auth/admob.readonly';
const ADMOB_REDIRECT_PATH      = '/admin/admob_oauth_callback.php';
const ADMOB_API_BASE           = 'https://admob.googleapis.com/v1';

function admob_http(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 30): array {
    $opts = ['method' => $method, 'header' => implode("\r\n", $headers), 'timeout' => $timeout, 'ignore_errors' => true];
    if ($body !== null) $opts['content'] = $body;
    $ctx  = stream_context_create(['http' => $opts]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $code = (int)$m[1];
    }
    return [$code, (string)$resp];
}

function admob_client_config(): ?array {
    if (!is_readable(ADMOB_CLIENT_CONFIG_PATH)) return null;
    $j = json_decode((string)file_get_contents(ADMOB_CLIENT_CONFIG_PATH), true);
    if (!is_array($j) || empty($j['client_id']) || empty($j['client_secret'])) return null;
    return $j;
}

function admob_client_configured(): bool {
    return admob_client_config() !== null;
}

function admob_token_store(): array {
    if (!is_readable(ADMOB_TOKEN_PATH)) return [];
    $j = json_decode((string)file_get_contents(ADMOB_TOKEN_PATH), true);
    return is_array($j) ? $j : [];
}

function admob_token_save(array $data): bool {
    $dir = dirname(ADMOB_TOKEN_PATH);
    if (!is_writable($dir)) return false;
    $ok = @file_put_contents(ADMOB_TOKEN_PATH, json_encode($data, JSON_PRETTY_PRINT)) !== false;
    if ($ok) @chmod(ADMOB_TOKEN_PATH, 0640);
    return $ok;
}

function admob_connected(): bool {
    $t = admob_token_store();
    return !empty($t['refresh_token']);
}

/** Redirect URI, derived from the current request unless overridden. Kept stable
 *  and explicit since it must exactly match the OAuth client's registered URI. */
function admob_redirect_uri(): string {
    return 'https://setalink.no' . ADMOB_REDIRECT_PATH;
}

/** Build the Google consent-screen URL. $state should be a CSRF-bound nonce the
 *  caller verifies on callback (mirrors admin/api.php's existing CSRF pattern). */
function admob_authorize_url(string $state): ?string {
    $cfg = admob_client_config();
    if (!$cfg) return null;
    $q = http_build_query([
        'client_id'              => $cfg['client_id'],
        'redirect_uri'           => admob_redirect_uri(),
        'response_type'          => 'code',
        'scope'                  => ADMOB_SCOPE,
        'access_type'            => 'offline',
        'prompt'                 => 'consent',   // force refresh_token on every (re)connect
        'state'                  => $state,
        'include_granted_scopes' => 'true',
    ]);
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . $q;
}

/** Exchange an authorization code for tokens; persists the refresh token. */
function admob_exchange_code(string $code): array {
    $cfg = admob_client_config();
    if (!$cfg) throw new \RuntimeException('AdMob OAuth client not configured (' . ADMOB_CLIENT_CONFIG_PATH . ')');
    [$http_code, $resp] = admob_http('POST', 'https://oauth2.googleapis.com/token',
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'code'          => $code,
            'client_id'     => $cfg['client_id'],
            'client_secret' => $cfg['client_secret'],
            'redirect_uri'  => admob_redirect_uri(),
            'grant_type'    => 'authorization_code',
        ])
    );
    $data = json_decode($resp, true);
    if ($http_code !== 200 || empty($data['refresh_token'])) {
        $msg = $data['error_description'] ?? $data['error'] ?? substr($resp, 0, 200);
        throw new \RuntimeException('AdMob token exchange failed (' . $http_code . '): ' . $msg);
    }
    admob_token_save([
        'refresh_token'   => $data['refresh_token'],
        'access_token'    => $data['access_token'] ?? '',
        'access_token_exp'=> time() + (int)($data['expires_in'] ?? 3600),
        'connected_at'    => gmdate('c'),
        'scope'           => $data['scope'] ?? ADMOB_SCOPE,
    ]);
    return ['connected' => true];
}

function admob_disconnect(): bool {
    if (!file_exists(ADMOB_TOKEN_PATH)) return true;
    return @unlink(ADMOB_TOKEN_PATH);
}

/** Cached access token, refreshed via the stored refresh_token when stale. */
function admob_access_token(): string {
    $cfg = admob_client_config();
    if (!$cfg) throw new \RuntimeException('AdMob OAuth client not configured');
    $store = admob_token_store();
    if (empty($store['refresh_token'])) throw new \RuntimeException('AdMob not connected — run the Connect AdMob flow first');

    if (!empty($store['access_token']) && (int)($store['access_token_exp'] ?? 0) > time() + 60) {
        return (string)$store['access_token'];
    }

    [$http_code, $resp] = admob_http('POST', 'https://oauth2.googleapis.com/token',
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'refresh_token' => $store['refresh_token'],
            'client_id'     => $cfg['client_id'],
            'client_secret' => $cfg['client_secret'],
            'grant_type'    => 'refresh_token',
        ])
    );
    $data = json_decode($resp, true);
    if ($http_code !== 200 || empty($data['access_token'])) {
        $msg = $data['error_description'] ?? $data['error'] ?? substr($resp, 0, 200);
        // A revoked/expired refresh token surfaces here — caller should show
        // "reconnect AdMob" rather than a generic sync failure.
        throw new \RuntimeException('AdMob token refresh failed (' . $http_code . '): ' . $msg);
    }
    $store['access_token']     = $data['access_token'];
    $store['access_token_exp'] = time() + (int)($data['expires_in'] ?? 3600);
    admob_token_save($store);
    return (string)$data['access_token'];
}

/** List AdMob publisher accounts reachable by the connected credential. */
function admob_list_accounts(string $token): array {
    [$code, $resp] = admob_http('GET', ADMOB_API_BASE . '/accounts', ['Authorization: Bearer ' . $token]);
    $data = json_decode($resp, true);
    if ($code !== 200) throw new \RuntimeException('AdMob accounts.list failed (' . $code . '): ' . substr($resp, 0, 200));
    return $data['account'] ?? [];
}

/**
 * One networkReport:generate call. The AdMob API streams a JSON array of
 * {header:...} / {row:{dimensionValues,metricValues}} / {footer:...} objects —
 * this flattens it to [[dim1val, dim2val, ..., metric1val, ...], ...] plus the
 * dimension/metric name order, so callers don't need to know the wire format.
 */
function admob_network_report(string $token, string $publisherId, string $startDate, string $endDate, array $dimensions, array $metrics): array {
    $url  = ADMOB_API_BASE . '/accounts/' . rawurlencode($publisherId) . '/networkReport:generate';
    [$sy, $sm, $sd] = array_map('intval', explode('-', $startDate));
    [$ey, $em, $ed] = array_map('intval', explode('-', $endDate));
    $body = json_encode([
        'reportSpec' => [
            'dateRange'  => [
                'startDate' => ['year' => $sy, 'month' => $sm, 'day' => $sd],
                'endDate'   => ['year' => $ey, 'month' => $em, 'day' => $ed],
            ],
            'dimensions' => $dimensions,
            'metrics'    => $metrics,
            'sortConditions' => [['dimension' => 'DATE', 'order' => 'ASCENDING']],
            'localizationSettings' => ['currencyCode' => 'USD', 'languageCode' => 'en-US'],
        ],
    ]);
    [$code, $resp] = admob_http('POST', $url,
        ['Authorization: Bearer ' . $token, 'Content-Type: application/json'], $body, 60);
    if ($code !== 200) {
        $data = json_decode($resp, true);
        $msg = $data['error']['message'] ?? substr($resp, 0, 300);
        throw new \RuntimeException('AdMob networkReport.generate failed (' . $code . '): ' . $msg);
    }
    $stream = json_decode($resp, true);
    $rows = [];
    foreach ((is_array($stream) ? $stream : []) as $chunk) {
        if (!isset($chunk['row'])) continue; // skip header/footer chunks
        $r = ['dimensions' => [], 'metrics' => []];
        foreach (($chunk['row']['dimensionValues'] ?? []) as $k => $v) $r['dimensions'][$k] = $v['value'] ?? '';
        foreach (($chunk['row']['metricValues'] ?? [])    as $k => $v) $r['metrics'][$k]    = $v['integerValue'] ?? ($v['microsValue'] ?? ($v['doubleValue'] ?? '0'));
        $rows[] = $r;
    }
    return $rows;
}

/**
 * Pull the last $days of AdMob network report data (per date/app/ad-unit/platform/
 * format), write it into ad_daily_metrics tagged PROVIDER_API, and record sync
 * status in settings (admob_last_sync / admob_last_error). Never throws to the
 * caller for a failed sync — returns ['ok'=>false,'error'=>...] so cron/admin can
 * show the failure without a 500.
 */
function admob_sync(PDO $pdo, int $days = 30): array {
    am_init_tables($pdo);
    try {
        if (!admob_client_configured()) throw new \RuntimeException('OAuth client not configured');
        $token = admob_access_token();
        $cfg   = am_config($pdo);
        $pubId = trim((string)$cfg['admob_reporting_account']);
        if ($pubId === '') {
            $accounts = admob_list_accounts($token);
            $pubId = (string)($accounts[0]['publisherId'] ?? '');
            if ($pubId === '') throw new \RuntimeException('no AdMob publisher account reachable by this credential');
            am_save_config($pdo, ['admob_reporting_account' => $pubId]);
        }

        $end   = gmdate('Y-m-d');
        $start = gmdate('Y-m-d', strtotime("-{$days} days"));
        $rows  = admob_network_report($token, $pubId, $start, $end,
            ['DATE', 'APP', 'AD_UNIT', 'PLATFORM', 'FORMAT'],
            ['AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS', 'ESTIMATED_EARNINGS']
        );

        $written = 0;
        foreach ($rows as $r) {
            $d = $r['dimensions'];
            $m = $r['metrics'];
            $date = $d['DATE'] ?? '';
            if (!preg_match('/^\d{8}$/', $date)) continue;
            $date = substr($date, 0, 4) . '-' . substr($date, 4, 2) . '-' . substr($date, 6, 2);
            $platform = strtolower((string)($d['PLATFORM'] ?? ''));
            am_daily_metric_upsert($pdo, [
                'date' => $date, 'provider' => 'admob',
                'platform' => $platform, 'ad_unit_id' => (string)($d['AD_UNIT'] ?? ''),
                'requests' => (int)($m['AD_REQUESTS'] ?? 0), 'matched_requests' => (int)($m['MATCHED_REQUESTS'] ?? 0),
                'impressions' => (int)($m['IMPRESSIONS'] ?? 0), 'clicks' => (int)($m['CLICKS'] ?? 0),
                // ESTIMATED_EARNINGS comes back in micros (1e6 = 1 unit of account currency).
                'revenue' => ((int)($m['ESTIMATED_EARNINGS'] ?? 0)) / 1000000.0,
                'currency' => 'USD', 'source_type' => 'PROVIDER_API',
            ]);
            $written++;
        }

        $st = $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))");
        $st->execute(['admob_last_sync', gmdate('c')]);
        $st->execute(['admob_last_error', '']);
        return ['ok' => true, 'rows_written' => $written, 'publisher_id' => $pubId];
    } catch (\Exception $e) {
        try {
            $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('admob_last_error',?,datetime('now'))")
                ->execute([$e->getMessage()]);
        } catch (\Exception $e2) { /* ignore */ }
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

function admob_sync_status(PDO $pdo): array {
    $st = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ('admob_last_sync','admob_last_error')");
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    return [
        'client_configured' => admob_client_configured(),
        'connected'         => admob_connected(),
        'last_sync'         => $rows['admob_last_sync'] ?? null,
        'last_error'        => $rows['admob_last_error'] ?? '',
    ];
}
