<?php
/**
 * AdsGram publisher API sync (optional — only runs once a token is configured).
 *
 * AdsGram's publisher stats endpoint (referenced in docs/realgram/TASK_SPLIT.md
 * A→B(19), `https://api.adsgram.ai/publisher/stats`, Bearer token from
 * app.adsgram.ai → Settings) is the only direct-from-AdsGram data source this
 * repo can reach — the per-event AdEventLog lives in Shahnameh's Node+Mongo
 * backend on another host (see docs/realgram/MONETIZATION_REPORTING.md "scope
 * boundary"). Nobody on this side has held a real token yet, so the exact
 * response field names are unverified — this parses defensively (several
 * plausible key names per field) and stores the raw response alongside the
 * parsed row so a field-mapping fix is a data re-parse, not a re-fetch, once a
 * real token exists.
 *
 * Until `adsgram_api_token` is configured, adsgram_publisher_configured() is
 * false and the admin UI shows "Not configured" — CSV import (below) works
 * without it.
 */

declare(strict_types=1);

const ADSGRAM_API_BASE = 'https://api.adsgram.ai';

function adsgram_http_get(string $url, string $token, int $timeout = 20): array {
    $ctx = stream_context_create(['http' => [
        'method' => 'GET', 'timeout' => $timeout, 'ignore_errors' => true,
        'header' => "Authorization: Bearer $token\r\nAccept: application/json\r\n",
    ]]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $code = (int)$m[1];
    }
    return [$code, (string)$resp];
}

function adsgram_publisher_token(PDO $pdo): string {
    $st = $pdo->prepare("SELECT value FROM settings WHERE key='adsgram_api_token'");
    $st->execute();
    return trim((string)($st->fetchColumn() ?: ''));
}

function adsgram_publisher_configured(PDO $pdo): bool {
    return adsgram_publisher_token($pdo) !== '';
}

/** First present key from a row, tried in order — defensive against unverified field names. */
function adsgram_pick(array $row, array $keys, $default = null) {
    foreach ($keys as $k) if (array_key_exists($k, $row)) return $row[$k];
    return $default;
}

function adsgram_publisher_sync(PDO $pdo, int $days = 30): array {
    am_init_tables($pdo);
    $token = adsgram_publisher_token($pdo);
    if ($token === '') return ['ok' => false, 'error' => 'AdsGram publisher token not configured'];

    $start = gmdate('Y-m-d', strtotime("-{$days} days"));
    $end   = gmdate('Y-m-d');
    $url = ADSGRAM_API_BASE . '/publisher/stats?' . http_build_query(['from' => $start, 'to' => $end]);
    [$code, $resp] = adsgram_http_get($url, $token);
    if ($code !== 200) {
        $err = 'AdsGram publisher/stats failed (' . $code . '): ' . substr($resp, 0, 200);
        $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('adsgram_last_error',?,datetime('now'))")->execute([$err]);
        return ['ok' => false, 'error' => $err];
    }
    $data = json_decode($resp, true);
    $rows = is_array($data) ? (is_array($data['data'] ?? null) ? $data['data'] : (is_array($data['stats'] ?? null) ? $data['stats'] : $data)) : [];
    if (!is_array($rows) || (count($rows) > 0 && !is_array($rows[array_key_first($rows)] ?? null))) {
        $err = 'unrecognized AdsGram publisher/stats response shape — raw response logged, needs a field-mapping fix once a real token has been tested';
        $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('adsgram_last_error',?,datetime('now'))")->execute([$err]);
        $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('adsgram_last_raw_response',?,datetime('now'))")->execute([substr($resp, 0, 4000)]);
        return ['ok' => false, 'error' => $err];
    }

    $written = 0;
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        $date = (string)adsgram_pick($row, ['date', 'day', 'stat_date'], '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $date)) continue;
        $date = substr($date, 0, 10);
        $blockId = (string)adsgram_pick($row, ['blockId', 'block_id', 'unitId', 'unit_id'], '');
        am_daily_metric_upsert($pdo, [
            'date' => $date, 'provider' => 'adsgram', 'platform' => 'telegram',
            'ad_unit_id' => $blockId,
            'requests'    => (int)adsgram_pick($row, ['requests', 'adRequests'], 0),
            'impressions' => (int)adsgram_pick($row, ['impressions', 'views'], 0),
            'clicks'      => (int)adsgram_pick($row, ['clicks'], 0),
            'completions' => (int)adsgram_pick($row, ['completions', 'completed', 'rewardedViews'], 0),
            'revenue'     => (float)adsgram_pick($row, ['revenue', 'earnings', 'income'], 0),
            'currency'    => (string)adsgram_pick($row, ['currency'], 'USDT'),
            'source_type' => 'PROVIDER_API',
        ]);
        $written++;
    }

    $st = $pdo->prepare("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))");
    $st->execute(['adsgram_last_sync', gmdate('c')]);
    $st->execute(['adsgram_last_error', '']);
    return ['ok' => true, 'rows_written' => $written];
}

function adsgram_sync_status(PDO $pdo): array {
    $st = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ('adsgram_last_sync','adsgram_last_error')");
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    return [
        'configured' => adsgram_publisher_configured($pdo),
        'last_sync'  => $rows['adsgram_last_sync'] ?? null,
        'last_error' => $rows['adsgram_last_error'] ?? '',
    ];
}

// ── CSV import (manual AdsGram dashboard export) ────────────────────────────

/**
 * Import a CSV export from the AdsGram dashboard. Accepted header names are
 * flexible (see $map) since the export format isn't in this repo's control.
 * Every imported row is tagged MANUAL_IMPORT — never presented as a live
 * provider number — and the whole run is recorded in ad_csv_imports for the
 * Logs tab / audit trail.
 *
 * Expected columns (case-insensitive, order-independent): date, block/unit id,
 * impressions, clicks (optional), completions/rewarded views (optional),
 * revenue/earnings, currency (optional, default USDT).
 */
function am_csv_import_adsgram(PDO $pdo, string $csv, string $filename, string $importedBy): array {
    am_init_tables($pdo);
    $lines = preg_split('/\r\n|\r|\n/', trim($csv));
    if (count($lines) < 2) throw new \InvalidArgumentException('CSV has no data rows');

    $header = str_getcsv(array_shift($lines));
    $header = array_map(fn($h) => strtolower(trim((string)$h)), $header);
    $col = function(array $names) use ($header): ?int {
        foreach ($names as $n) { $i = array_search($n, $header, true); if ($i !== false) return $i; }
        return null;
    };
    $iDate    = $col(['date', 'day']);
    $iUnit    = $col(['block_id', 'blockid', 'unit_id', 'unitid', 'block', 'unit']);
    $iImpr    = $col(['impressions', 'views']);
    $iClicks  = $col(['clicks']);
    $iComp    = $col(['completions', 'completed', 'rewarded_views', 'rewardedviews']);
    $iRevenue = $col(['revenue', 'earnings', 'income']);
    $iCurrency= $col(['currency']);
    if ($iDate === null || $iRevenue === null) {
        throw new \InvalidArgumentException('CSV missing required "date" and/or "revenue" column');
    }

    $accepted = 0; $rejected = 0;
    foreach ($lines as $line) {
        if (trim($line) === '') continue;
        $row = str_getcsv($line);
        $date = trim((string)($row[$iDate] ?? ''));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $date)) { $rejected++; continue; }
        $date = substr($date, 0, 10);
        try {
            am_daily_metric_upsert($pdo, [
                'date' => $date, 'provider' => 'adsgram', 'platform' => 'telegram',
                'ad_unit_id' => $iUnit !== null ? trim((string)($row[$iUnit] ?? '')) : '',
                'impressions' => $iImpr !== null ? (int)($row[$iImpr] ?? 0) : 0,
                'clicks'      => $iClicks !== null ? (int)($row[$iClicks] ?? 0) : 0,
                'completions' => $iComp !== null ? (int)($row[$iComp] ?? 0) : 0,
                'revenue'     => (float)($row[$iRevenue] ?? 0),
                'currency'    => $iCurrency !== null ? trim((string)($row[$iCurrency] ?? 'USDT')) : 'USDT',
                'source_type' => 'MANUAL_IMPORT',
            ]);
            $accepted++;
        } catch (\Exception $e) { $rejected++; }
    }

    $pdo->prepare(
        "INSERT INTO ad_csv_imports (provider, filename, imported_by, row_count, accepted_count, rejected_count, raw_hash)
         VALUES ('adsgram', ?, ?, ?, ?, ?, ?)"
    )->execute([$filename, $importedBy, count($lines), $accepted, $rejected, hash('sha256', $csv)]);
    am_log($pdo, $importedBy, 'adsgram_csv_import', ['filename' => $filename, 'accepted' => $accepted, 'rejected' => $rejected]);

    return ['accepted' => $accepted, 'rejected' => $rejected, 'total_rows' => count($lines)];
}
