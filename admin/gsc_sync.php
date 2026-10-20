<?php
// Google Search Console → keyword_ranks sync (pure PHP, no Composer).
//
// Auth uses a SERVICE ACCOUNT: a JSON key placed OUTSIDE the web root at
// GSC_KEY_PATH. We mint an RS256 JWT, exchange it for an access token, then call
// the Search Analytics API for real average positions per query per day and write
// them as snapshots (source='gsc') into keyword_ranks — the same table the manual
// tracker uses, so the chart just fills in with real data.
//
// SETUP (one-time, done by the owner in their Google account):
//   1. Google Cloud Console → create/pick a project → enable "Google Search
//      Console API".
//   2. Create a Service Account → Keys → Add key → JSON → download.
//   3. In Search Console (search.google.com/search-console) for the property,
//      Settings → Users and permissions → add the service account e-mail
//      (…@….iam.gserviceaccount.com) with "Full" or "Restricted" access.
//   4. Upload the JSON to the server at GSC_KEY_PATH (chmod 600, owner www-data).
//   5. Set the property URL in admin (default https://setalink.no/). For a
//      Domain property use "sc-domain:setalink.no".

const GSC_KEY_PATH = '/var/www/setalink/data/gsc-service-account.json';
const GSC_SCOPE    = 'https://www.googleapis.com/auth/webmasters.readonly';

function gsc_b64url(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}

// HTTP POST via streams (the server PHP has no curl extension). Returns
// [statusCode, body]. ignore_errors=true so we still read the body on 4xx/5xx.
function gsc_http_post(string $url, array $headers, string $body, int $timeout = 30): array {
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

function gsc_setting(PDO $db, string $key, ?string $set = null, string $default = ''): string {
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

function gsc_key_present(): bool {
    return is_readable(GSC_KEY_PATH) && filesize(GSC_KEY_PATH) > 100;
}

// Mint (and cache) an OAuth access token from the service-account key.
function gsc_access_token(PDO $db): string {
    // Reuse a cached token until ~2 min before expiry.
    $cached = gsc_setting($db, 'gsc_token');
    $exp    = (int) gsc_setting($db, 'gsc_token_exp', null, '0');
    if ($cached && $exp > time() + 120) return $cached;

    if (!gsc_key_present()) throw new RuntimeException('GSC service-account key missing at ' . GSC_KEY_PATH);
    $sa = json_decode((string)file_get_contents(GSC_KEY_PATH), true);
    if (!isset($sa['client_email'], $sa['private_key'])) throw new RuntimeException('GSC key JSON malformed');

    $now = time();
    $header = gsc_b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claim  = gsc_b64url(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => GSC_SCOPE,
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $signingInput = $header . '.' . $claim;
    $sig = '';
    if (!openssl_sign($signingInput, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('GSC JWT signing failed');
    }
    $jwt = $signingInput . '.' . gsc_b64url($sig);

    [$code, $resp] = gsc_http_post(
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
        throw new RuntimeException('GSC token exchange failed (' . $code . '): ' . substr((string)$resp, 0, 200));
    }
    gsc_setting($db, 'gsc_token', $data['access_token']);
    gsc_setting($db, 'gsc_token_exp', (string)($now + (int)($data['expires_in'] ?? 3600)));
    return $data['access_token'];
}

// Query the Search Analytics API. $body is the request payload array.
function gsc_query(string $token, string $siteUrl, array $body): array {
    $url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/'
         . rawurlencode($siteUrl) . '/searchAnalytics/query';
    [$code, $resp] = gsc_http_post(
        $url,
        ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
        json_encode($body),
        30
    );
    $data = json_decode((string)$resp, true);
    if ($code !== 200) {
        $msg = $data['error']['message'] ?? substr((string)$resp, 0, 200);
        throw new RuntimeException('GSC API error (' . $code . '): ' . $msg);
    }
    return $data['rows'] ?? [];
}

// Refresh 90 finalized days of per-day, per-query position data and write real
// snapshots for every tracked keyword. Returns a summary (for the admin UI).
function gsc_sync(PDO $db): array {
    seo_ranks_init($db);
    $db->exec('PRAGMA busy_timeout=15000');
    $db->exec('CREATE TABLE IF NOT EXISTS gsc_daily (
        site_url TEXT NOT NULL, date TEXT NOT NULL, clicks INTEGER NOT NULL,
        impressions INTEGER NOT NULL, position REAL, PRIMARY KEY(site_url,date))');
    $siteUrl = gsc_setting($db, 'gsc_site_url', null, 'sc-domain:realgram.no');
    gsc_setting($db, 'gsc_last_attempt', gmdate('Y-m-d H:i:s'));
    try {
        $token = gsc_access_token($db);
        $end = gmdate('Y-m-d', time() - 3 * 86400);
        $start = gmdate('Y-m-d', time() - 92 * 86400);
        $rows = [];
        for ($offset=0; ; $offset+=25000) {
            $page = gsc_query($token, $siteUrl, [
                'startDate'=>$start, 'endDate'=>$end, 'dimensions'=>['date','query'],
                'rowLimit'=>25000, 'startRow'=>$offset, 'type'=>'web', 'dataState'=>'final']);
            $rows = array_merge($rows, $page);
            if (count($page)<25000) break;
        }
        // Query rows exclude anonymized queries: obtain property totals separately.
        $daily = gsc_query($token, $siteUrl, [
            'startDate'=>$start, 'endDate'=>$end, 'dimensions'=>['date'],
            'type'=>'web', 'dataState'=>'final', 'aggregationType'=>'byProperty']);
        $tracked=[];
        foreach ($db->query('SELECT keyword,lang FROM keyword_ranks GROUP BY keyword')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $tracked[gsc_norm($r['keyword'])]=[$r['keyword'],$r['lang']];
        }
        // Replace only after every Google request succeeds; roll back on any write error.
        $db->beginTransaction();
        $db->prepare("DELETE FROM keyword_ranks WHERE source='gsc' AND date(captured_at) BETWEEN ? AND ?")->execute([$start,$end]);
        $ins=$db->prepare("INSERT INTO keyword_ranks (keyword,lang,position,impressions,clicks,source,captured_at) VALUES (?,?,?,?,?,'gsc',?)");
        $grouped=[]; $discovered=[];
        foreach ($rows as $r) {
            $date=$r['keys'][0]??''; $q=$r['keys'][1]??'';
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/',$date) || $q==='') continue;
            $norm=gsc_norm($q);
            if (!isset($tracked[$norm])) {
                $tracked[$norm]=[$q,preg_match('/[\x{0600}-\x{06ff}]/u',$q)?'fa':'en'];
                $discovered[$q]=true;
            }
            $key=$date."\0".$norm;
            if (!isset($grouped[$key])) $grouped[$key]=['date'=>$date,'norm'=>$norm,'impressions'=>0,'clicks'=>0,'weighted'=>0.0];
            $impressions=(int)($r['impressions']??0);
            $grouped[$key]['impressions']+=$impressions;
            $grouped[$key]['clicks']+=(int)($r['clicks']??0);
            $grouped[$key]['weighted']+=(float)($r['position']??0)*$impressions;
        }
        $matched=[];
        foreach ($grouped as $r) {
            if ($r['impressions']<=0) continue;
            [$keyword,$lang]=$tracked[$r['norm']];
            $ins->execute([$keyword,$lang,round($r['weighted']/$r['impressions'],1),$r['impressions'],$r['clicks'],$r['date'].' 12:00:00']);
            $matched[$keyword]=true;
        }
        $db->prepare('DELETE FROM gsc_daily WHERE site_url=? AND date BETWEEN ? AND ?')->execute([$siteUrl,$start,$end]);
        $put=$db->prepare('INSERT INTO gsc_daily (site_url,date,clicks,impressions,position) VALUES (?,?,?,?,?)');
        foreach ($daily as $r) $put->execute([$siteUrl,$r['keys'][0],(int)$r['clicks'],(int)$r['impressions'],(float)$r['position']]);
        gsc_setting($db,'gsc_window_start',$start);
        gsc_setting($db,'gsc_window_end',$end);
        gsc_setting($db,'gsc_last_sync',gmdate('Y-m-d H:i:s'));
        gsc_setting($db,'gsc_last_error','');
        $db->commit();
        return ['ok'=>true,'site_url'=>$siteUrl,'window'=>"$start … $end",
            'rows'=>count($rows),'snapshots'=>count($grouped),'keywords_hit'=>count($matched),
            'discovered'=>array_keys($discovered),'top_untracked'=>[]];
    } catch (\Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        try { gsc_setting($db,'gsc_last_error',substr($e->getMessage(),0,500)); } catch (\Throwable $ignored) {}
        throw $e;
    }
}

// Normalize a query/keyword for matching: trim, collapse spaces, drop ZWNJ,
// lowercase (Latin). Persian keywords match despite minor whitespace differences.
function gsc_norm(string $s): string {
    $s = str_replace(["\u{200c}", "\u{200f}", "\u{200e}"], ['', '', ''], $s); // ZWNJ + RTL/LTR marks
    $s = str_replace(['ي','ك'], ['ی','ک'], $s);
    $s = preg_replace('/\s+/u', ' ', trim($s));
    // mb_strtolower only matters for Latin queries; Persian has no case. Fall
    // back to ASCII strtolower when mbstring is unavailable.
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}
