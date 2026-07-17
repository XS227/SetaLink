<?php
/**
 * Ads Performance Comparison — Phase 1 (collect + compare, decide later).
 *
 * Strategy:
 *   AdMob  → metrics derived in real time from the existing ad_reward_events table
 *            (every confirmed rewarded view is already logged there).
 *   AdsGram → metrics pushed daily by Agent B's Shahnameh bot server via
 *              push-adsgram-perf endpoint; stored in ad_perf_daily.
 *
 * KPIs tracked: active_users, rewarded_views, revenue_usd, ecpm_usd, fill_rate,
 *               gb_granted, avg_watch_time_s.
 * Conversion (Telegram→RealGram) derived from devices table at query time.
 */

function adp_init_table(PDO $pdo): void {
    adp_ensure_linked_at($pdo);
    $pdo->exec("CREATE TABLE IF NOT EXISTS ad_perf_daily (
        date             TEXT    NOT NULL,
        platform         TEXT    NOT NULL,
        active_users     INTEGER NOT NULL DEFAULT 0,
        rewarded_views   INTEGER NOT NULL DEFAULT 0,
        revenue_usd      REAL    NOT NULL DEFAULT 0.0,
        ecpm_usd         REAL    NOT NULL DEFAULT 0.0,
        fill_rate        REAL    NOT NULL DEFAULT 0.0,
        gb_granted       REAL    NOT NULL DEFAULT 0.0,
        avg_watch_time_s REAL    NOT NULL DEFAULT 0.0,
        PRIMARY KEY (date, platform)
    )");
}

function adp_upsert(PDO $pdo, string $date, string $platform, array $d): void {
    $pdo->prepare(
        "INSERT INTO ad_perf_daily
             (date, platform, active_users, rewarded_views, revenue_usd, ecpm_usd,
              fill_rate, gb_granted, avg_watch_time_s)
         VALUES (:date,:platform,:au,:rv,:rev,:ecpm,:fr,:gb,:awt)
         ON CONFLICT(date, platform) DO UPDATE SET
             active_users     = excluded.active_users,
             rewarded_views   = excluded.rewarded_views,
             revenue_usd      = excluded.revenue_usd,
             ecpm_usd         = excluded.ecpm_usd,
             fill_rate        = excluded.fill_rate,
             gb_granted       = excluded.gb_granted,
             avg_watch_time_s = excluded.avg_watch_time_s"
    )->execute([
        ':date'     => $date,
        ':platform' => $platform,
        ':au'       => (int)($d['active_users']     ?? 0),
        ':rv'       => (int)($d['rewarded_views']   ?? 0),
        ':rev'      => (float)($d['revenue_usd']    ?? 0.0),
        ':ecpm'     => (float)($d['ecpm_usd']       ?? 0.0),
        ':fr'       => min(1.0, max(0.0, (float)($d['fill_rate'] ?? 0.0))),
        ':gb'       => (float)($d['gb_granted']     ?? 0.0),
        ':awt'      => (float)($d['avg_watch_time_s'] ?? 0.0),
    ]);
}

/**
 * Compute AdMob daily series from ad_reward_events (real-time, no snapshot needed).
 * Returns array keyed by ISO date, each value an assoc array of metrics.
 */
function adp_admob_series(PDO $pdo, int $days, float $ecpm): array {
    $rows = $pdo->query(
        "SELECT
             date(confirmed_at)                AS d,
             COUNT(DISTINCT device_id)         AS active_users,
             COUNT(*)                          AS rewarded_views,
             SUM(reward_bytes)/1073741824.0    AS gb_granted
         FROM ad_reward_events
         WHERE status='confirmed'
           AND confirmed_at >= datetime('now', '-{$days} days')
         GROUP BY date(confirmed_at)"
    )->fetchAll(PDO::FETCH_ASSOC);

    $out = [];
    foreach ($rows as $r) {
        $rv = (int)$r['rewarded_views'];
        $out[(string)$r['d']] = [
            'active_users'     => (int)$r['active_users'],
            'rewarded_views'   => $rv,
            'revenue_usd'      => round($rv * $ecpm / 1000, 4),
            'ecpm_usd'         => $ecpm,
            'fill_rate'        => 0.0,   // not capturable from SSV events alone
            'gb_granted'       => round((float)$r['gb_granted'], 4),
            'avg_watch_time_s' => 0.0,   // not logged
        ];
    }
    return $out;
}

/**
 * Read AdsGram daily series from ad_perf_daily (pushed by Agent B).
 */
function adp_adsgram_series(PDO $pdo, int $days): array {
    $rows = $pdo->query(
        "SELECT date, active_users, rewarded_views, revenue_usd, ecpm_usd,
                fill_rate, gb_granted, avg_watch_time_s
         FROM ad_perf_daily
         WHERE platform='adsgram'
           AND date >= date('now', '-{$days} days')
         ORDER BY date"
    )->fetchAll(PDO::FETCH_ASSOC);

    $out = [];
    foreach ($rows as $r) {
        $out[$r['date']] = [
            'active_users'     => (int)$r['active_users'],
            'rewarded_views'   => (int)$r['rewarded_views'],
            'revenue_usd'      => (float)$r['revenue_usd'],
            'ecpm_usd'         => (float)$r['ecpm_usd'],
            'fill_rate'        => (float)$r['fill_rate'],
            'gb_granted'       => (float)$r['gb_granted'],
            'avg_watch_time_s' => (float)$r['avg_watch_time_s'],
        ];
    }
    return $out;
}

/**
 * Add real_linked_at column to devices table (safe migration, idempotent).
 * Called from adp_init_table so future link events get timestamped.
 */
function adp_ensure_linked_at(PDO $pdo): void {
    try { $pdo->exec("ALTER TABLE devices ADD COLUMN real_linked_at TEXT DEFAULT ''"); } catch (\Exception $e) {}
}

/**
 * Daily series of new REAL-ID links (devices first linked per day).
 * Uses real_linked_at if populated; falls back to empty array (no history yet).
 */
function adp_conversion_series(PDO $pdo, int $days): array {
    $rows = $pdo->query(
        "SELECT date(real_linked_at) AS d, COUNT(*) AS n
         FROM devices
         WHERE real_linked_at IS NOT NULL AND real_linked_at <> ''
           AND real_linked_at >= datetime('now', '-{$days} days')
         GROUP BY date(real_linked_at)"
    )->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) $out[$r['d']] = (int)$r['n'];
    return $out;
}

/** Aggregate a daily-series map into totals + derived metrics. */
function adp_totals(array $series): array {
    $t = ['active_users' => 0, 'rewarded_views' => 0, 'revenue_usd' => 0.0,
          'gb_granted' => 0.0, 'fill_rate_sum' => 0.0, 'fill_days' => 0,
          'awt_sum' => 0.0, 'awt_days' => 0, 'active_days' => 0];
    foreach ($series as $d) {
        $t['active_users']   = max($t['active_users'], (int)$d['active_users']); // peak
        $t['rewarded_views'] += (int)$d['rewarded_views'];
        $t['revenue_usd']    += (float)$d['revenue_usd'];
        $t['gb_granted']     += (float)$d['gb_granted'];
        if ($d['fill_rate'] > 0) { $t['fill_rate_sum'] += $d['fill_rate']; $t['fill_days']++; }
        if ($d['avg_watch_time_s'] > 0) { $t['awt_sum'] += $d['avg_watch_time_s']; $t['awt_days']++; }
        if ($d['rewarded_views'] > 0) $t['active_days']++;
    }
    $rv = $t['rewarded_views'];
    return [
        'active_users'     => $t['active_users'],
        'rewarded_views'   => $rv,
        'revenue_usd'      => round($t['revenue_usd'], 2),
        'revenue_per_user' => $t['active_users'] > 0 ? round($t['revenue_usd'] / $t['active_users'], 4) : 0.0,
        'ecpm_usd'         => $t['active_days'] > 0 ? round($t['revenue_usd'] / $t['active_days'] / max(1, $rv / max(1, $t['active_days'])) * 1000, 2) : 0.0,
        'fill_rate'        => $t['fill_days'] > 0 ? round($t['fill_rate_sum'] / $t['fill_days'], 4) : null,
        'gb_granted'       => round($t['gb_granted'], 3),
        'avg_watch_time_s' => $t['awt_days'] > 0 ? round($t['awt_sum'] / $t['awt_days'], 1) : null,
        'roi'              => $t['gb_granted'] > 0 ? round($t['revenue_usd'] / ($t['gb_granted'] * 0.02), 2) : null,
    ];
}

/**
 * Compute NOC alerts by comparing two 7-day windows.
 * Returns array of [level, platform, metric, msg, change].
 */
function adp_alerts(PDO $pdo, float $ecpm): array {
    $alerts = [];

    // Compute last-7d vs prev-7d for AdMob
    $am_cur  = adp_totals(adp_admob_series($pdo, 7,  $ecpm));
    $am_prev_rows = $pdo->query(
        "SELECT date(confirmed_at) AS d, COUNT(DISTINCT device_id) AS au,
                COUNT(*) AS rv, SUM(reward_bytes)/1073741824.0 AS gb
         FROM ad_reward_events WHERE status='confirmed'
           AND confirmed_at >= datetime('now','-14 days')
           AND confirmed_at <  datetime('now','-7 days')
         GROUP BY d"
    )->fetchAll(PDO::FETCH_ASSOC);
    $am_prev_s = [];
    foreach ($am_prev_rows as $r) {
        $rv = (int)$r['rv'];
        $am_prev_s[$r['d']] = ['active_users'=>(int)$r['au'],'rewarded_views'=>$rv,
          'revenue_usd'=>round($rv*$ecpm/1000,4),'ecpm_usd'=>$ecpm,
          'fill_rate'=>0,'gb_granted'=>round((float)$r['gb'],4),'avg_watch_time_s'=>0];
    }
    $am_prev = adp_totals($am_prev_s);

    // AdsGram last-7d vs prev-7d
    $ag_cur  = adp_totals(adp_adsgram_series($pdo, 7));
    $ag_prev_rows = $pdo->query(
        "SELECT date, active_users, rewarded_views, revenue_usd, ecpm_usd, fill_rate, gb_granted
         FROM ad_perf_daily WHERE platform='adsgram'
           AND date >= date('now','-14 days') AND date < date('now','-7 days')"
    )->fetchAll(PDO::FETCH_ASSOC);
    $ag_prev_s = [];
    foreach ($ag_prev_rows as $r) {
        $ag_prev_s[$r['date']] = ['active_users'=>(int)$r['active_users'],
          'rewarded_views'=>(int)$r['rewarded_views'],'revenue_usd'=>(float)$r['revenue_usd'],
          'ecpm_usd'=>(float)$r['ecpm_usd'],'fill_rate'=>(float)$r['fill_rate'],
          'gb_granted'=>(float)$r['gb_granted'],'avg_watch_time_s'=>0];
    }
    $ag_prev = adp_totals($ag_prev_s);

    $check = function(array $cur, array $prev, string $platform, string $key, string $label,
                       float $drop_thresh = 0.15, ?string $rise_label = null) use (&$alerts) {
        $c = (float)($cur[$key]  ?? 0);
        $p = (float)($prev[$key] ?? 0);
        if ($p <= 0 || $c <= 0) return;
        $change = ($c - $p) / $p;
        if ($change < -$drop_thresh) {
            $pct = abs(round($change * 100));
            $alerts[] = ['level' => ($pct >= 35 ? 'error' : 'warn'), 'platform' => $platform,
                'metric' => $key,
                'msg'    => "{$platform}: {$label} falt {$pct}% (7d vs forrige 7d)"];
        }
        if ($rise_label !== null && $change > 0.20) {
            $pct = round($change * 100);
            $alerts[] = ['level' => 'info', 'platform' => $platform, 'metric' => $key,
                'msg'   => "{$platform}: {$label} steg {$pct}% ↑ — " . $rise_label];
        }
    };

    $check($am_cur, $am_prev, 'AdMob',   'revenue_usd',    'Revenue',       0.15);
    $check($am_cur, $am_prev, 'AdMob',   'rewarded_views', 'Rewarded views',0.20);
    $check($ag_cur, $ag_prev, 'AdsGram', 'revenue_usd',    'Revenue',       0.15);
    $check($ag_cur, $ag_prev, 'AdsGram', 'ecpm_usd',       'eCPM',          0.10);
    $check($ag_cur, $ag_prev, 'AdsGram', 'fill_rate',      'Fill rate',     0.10);

    // Conversion alert
    $linked_cur  = (int)$pdo->query("SELECT COUNT(*) FROM devices WHERE real_linked_at >= datetime('now','-7 days')")->fetchColumn();
    $linked_prev = (int)$pdo->query("SELECT COUNT(*) FROM devices WHERE real_linked_at >= datetime('now','-14 days') AND real_linked_at < datetime('now','-7 days')")->fetchColumn();
    if ($linked_prev > 0 && $linked_cur > 0) {
        $change = ($linked_cur - $linked_prev) / $linked_prev;
        if ($change > 0.25)
            $alerts[] = ['level'=>'info','platform'=>'Konvertering','metric'=>'conversion',
                'msg' => "Konvertering Telegram→RealGram steg " . round($change*100) . "% ↑ (7d)"];
        elseif ($change < -0.20)
            $alerts[] = ['level'=>'warn','platform'=>'Konvertering','metric'=>'conversion',
                'msg' => "Konvertering Telegram→RealGram falt " . round(abs($change)*100) . "% (7d)"];
    }

    return $alerts;
}

/**
 * Hakim — rule-based AI recommendation engine (Phase 1).
 * Pure logic over KPI totals; no external API call.
 */
function adp_hakim(array $am_t, array $ag_t, bool $ag_has_data, int $days): array {
    if (!$ag_has_data) {
        return [
            'recommendation' => 'waiting',
            'label'          => 'Venter på AdsGram-data',
            'confidence'     => 'low',
            'rationale'      => [
                'AdsGram-statistikk er ikke mottatt ennå.',
                'Agent B setter opp daglig push via push-adsgram-perf (se TASK_SPLIT B-16).',
                'Anbefaling kan ikke gis uten sammenlignbare tall fra begge plattformer.',
            ],
            'kpis'   => ['AdMob har ' . ($am_t['rewarded_views'] ?? 0) . ' bekreftede visninger så langt.'],
            'action' => 'Vent til AdsGram-data er tilgjengelig — minst 7 dager.',
        ];
    }

    $am_arpdau = (float)($am_t['revenue_per_user'] ?? 0);
    $ag_arpdau = (float)($ag_t['revenue_per_user'] ?? 0);
    $am_roi    = (float)($am_t['roi'] ?? 0);
    $ag_roi    = (float)($ag_t['roi'] ?? 0);
    $am_fill   = $am_t['fill_rate'];
    $ag_fill   = $ag_t['fill_rate'];

    $score_am = 0; $score_ag = 0;
    $rationale = []; $kpis = [];

    if ($am_arpdau > 0 && $ag_arpdau > 0) {
        $ratio = $am_arpdau / max($ag_arpdau, 0.00001);
        if ($ratio > 1.20) {
            $score_am += 2;
            $pct = round(($ratio - 1) * 100);
            $rationale[] = "AdMob ARPDAU er {$pct}% høyere enn AdsGram — brukerne i appen er mer lønnsomme.";
            $kpis[] = 'ARPDAU · AdMob: $' . number_format($am_arpdau, 4) . ' / AdsGram: $' . number_format($ag_arpdau, 4);
        } elseif ($ratio < 0.83) {
            $score_ag += 2;
            $pct = round((1/$ratio - 1) * 100);
            $rationale[] = "AdsGram ARPDAU er {$pct}% høyere enn AdMob — bot-brukerne gir mer inntekt per person.";
            $kpis[] = 'ARPDAU · AdsGram: $' . number_format($ag_arpdau, 4) . ' / AdMob: $' . number_format($am_arpdau, 4);
        } else {
            $rationale[] = 'ARPDAU er omtrent likt på begge plattformer — ingen klar vinner ennå.';
            $kpis[] = 'ARPDAU · AdMob: $' . number_format($am_arpdau, 4) . ' / AdsGram: $' . number_format($ag_arpdau, 4);
        }
    } elseif ($am_arpdau > 0) {
        $kpis[] = 'ARPDAU · AdMob: $' . number_format($am_arpdau, 4) . ' (AdsGram: ingen data)';
    }

    if ($am_roi > 0 && $ag_roi > 0) {
        if ($am_roi > $ag_roi * 1.2) {
            $score_am++;
            $rationale[] = "AdMob ROI ({$am_roi}×) er sterkere — reklame dekker kostnadene bedre.";
            $kpis[] = "ROI · AdMob: {$am_roi}× / AdsGram: {$ag_roi}×";
        } elseif ($ag_roi > $am_roi * 1.2) {
            $score_ag++;
            $rationale[] = "AdsGram ROI ({$ag_roi}×) er sterkere — lav egress-kostnad i boten gir bedre margin.";
            $kpis[] = "ROI · AdsGram: {$ag_roi}× / AdMob: {$am_roi}×";
        }
    }

    if ($ag_fill !== null && $ag_fill > 0.85) {
        $score_ag++;
        $rationale[] = 'AdsGram fill rate er sterk (' . round($ag_fill * 100) . '%) — god annonsørdekning.';
        $kpis[] = 'Fill rate AdsGram: ' . round($ag_fill * 100) . '%';
    }
    if ($am_fill !== null && $am_fill < 0.65) {
        $score_ag++;
        $rationale[] = 'AdMob fill rate er lav (' . round($am_fill * 100) . '%) — mulig geo/kategori-mismatch.';
        $kpis[] = 'Fill rate AdMob: ' . round($am_fill * 100) . '%';
    }

    $confidence = $days < 7 ? 'low' : ($days >= 30 ? 'high' : 'medium');
    $suffix     = $days < 14 ? ' — samle minst 14 dager til for høyere sikkerhet' : '';

    if ($score_am > $score_ag + 1) {
        return ['recommendation' => 'realink', 'label' => 'Flytt mer trafikk til RealGram',
            'confidence' => $confidence,
            'rationale'  => $rationale,
            'kpis'       => $kpis,
            'action'     => 'Øk AdMob-budsjett og fremhev RealGram-onboarding fra Telegram.' . $suffix];
    }
    if ($score_ag > $score_am + 1) {
        return ['recommendation' => 'adsgram', 'label' => 'Behold AdsGram som primærkanal',
            'confidence' => $confidence,
            'rationale'  => $rationale,
            'kpis'       => $kpis,
            'action'     => 'Prioriter Telegram-bot og Shahnameh Mini App.' . $suffix];
    }
    $rationale[] = 'Ingen plattform er klart bedre i denne perioden.';
    return ['recommendation' => 'both', 'label' => 'Kjør begge parallelt',
        'confidence' => $confidence,
        'rationale'  => $rationale,
        'kpis'       => $kpis,
        'action'     => 'Fortsett A/B-testing.' . $suffix];
}
