<?php
/**
 * Realink Node Intelligence — connect telemetry DB helpers.
 *
 * Shared by public/v1.php (write path) and admin/api.php (read path).
 *
 * Table: connect_telemetry
 *   Records one row per VPN connect attempt, including outcome, platform,
 *   network type, and anonymised ISP/carrier.  No PII is stored.
 *
 * Privacy model:
 *   - No IP stored here (country is derived server-side and stored as 2-letter code)
 *   - ISP and carrier names are SHA-256-hashed to 10 hex chars before storage
 *   - No device_id unless caller explicitly passes one (opt-in, used only for
 *     aggregation, never linked back to a real user in this table)
 */

declare(strict_types=1);

function ni_init_tables(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS connect_telemetry (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        event        TEXT    NOT NULL DEFAULT 'connect_ok',
        node_id      TEXT    NOT NULL DEFAULT 'primary',
        profile_id   TEXT    DEFAULT NULL,
        sni          TEXT    DEFAULT NULL,
        protocol     TEXT    DEFAULT NULL,
        platform     TEXT    DEFAULT NULL,
        app_version  TEXT    DEFAULT NULL,
        build_number INTEGER DEFAULT 0,
        network_type TEXT    DEFAULT NULL,
        isp_hash     TEXT    DEFAULT NULL,
        carrier_hash TEXT    DEFAULT NULL,
        country      TEXT    DEFAULT NULL,
        failure_stage TEXT   DEFAULT NULL,
        latency_ms   INTEGER DEFAULT NULL,
        internet_ok  INTEGER DEFAULT NULL,
        exit_ip_ok   INTEGER DEFAULT NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )");
    // Index for the most common query patterns
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ct_node_created ON connect_telemetry(node_id, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ct_platform     ON connect_telemetry(platform, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ct_event        ON connect_telemetry(event, created_at)");

    // Migrations — new columns added in Intelligence Agent phase.
    // Each ALTER TABLE is wrapped in its own try/catch so "duplicate column" errors
    // (SQLite code 1, message contains "duplicate column name") are silently ignored.
    $newCols = [
        "probe_google          INTEGER DEFAULT NULL",
        "probe_apple           INTEGER DEFAULT NULL",
        "probe_telegram        INTEGER DEFAULT NULL",
        "probe_cloudflare      INTEGER DEFAULT NULL",
        "probe_instagram       INTEGER DEFAULT NULL",
        "disconnect_reason     TEXT    DEFAULT NULL",
        "session_duration_secs INTEGER DEFAULT NULL",
        "bytes_sent            INTEGER DEFAULT NULL",
        "bytes_recv            INTEGER DEFAULT NULL",
        "dns_ok                INTEGER DEFAULT NULL",
        "time_to_connect_ms    INTEGER DEFAULT NULL",
        "error_category        TEXT    DEFAULT NULL",
        "carrier_name          TEXT    DEFAULT NULL",
    ];
    foreach ($newCols as $colDef) {
        try {
            $colName = preg_split('/\s+/', trim($colDef))[0];
            $pdo->exec("ALTER TABLE connect_telemetry ADD COLUMN {$colDef}");
        } catch (\Throwable $e) {
            // "duplicate column name" is expected on re-init — ignore it.
        }
    }
}

/** Anonymise ISP/carrier: first 10 chars of hex SHA-256. */
function ni_anon(string $raw): string
{
    return $raw === '' ? '' : substr(hash('sha256', strtolower(trim($raw))), 0, 10);
}

/** Validate an event value — unknown values become 'connect_fail'. */
function ni_valid_event(string $e): string
{
    return in_array($e, ['connect_ok', 'connect_fail', 'internet_fail', 'probe_fail'], true) ? $e : 'connect_fail';
}

/** Validate platform. */
function ni_valid_platform(string $p): string
{
    return in_array($p, ['android', 'ios'], true) ? $p : 'unknown';
}

/** Validate network_type. */
function ni_valid_network(string $n): string
{
    return in_array($n, ['wifi', 'mobile'], true) ? $n : 'unknown';
}

/**
 * Insert one telemetry row.
 *
 * @param array $d  Associative array; all fields optional except 'event'.
 *                  isp and carrier are anonymised before insert.
 */
/** Allowed error_category values. */
const NI_ERROR_CATEGORIES = [
    'config_error', 'xray_failed', 'proxy_not_ready', 'routing_failed',
    'server_unreachable', 'dns_failed', 'captive_portal', 'app_blocked', 'unknown',
];

function ni_record(PDO $pdo, array $d): void
{
    ni_init_tables($pdo);

    // Validate / coerce error_category
    $errCat = substr((string)($d['error_category'] ?? ''), 0, 40);
    if ($errCat !== '' && !in_array($errCat, NI_ERROR_CATEGORIES, true)) {
        $errCat = 'unknown';
    }

    $pdo->prepare(
        "INSERT INTO connect_telemetry
            (event,node_id,profile_id,sni,protocol,platform,app_version,build_number,
             network_type,isp_hash,carrier_hash,country,failure_stage,latency_ms,
             internet_ok,exit_ip_ok,
             probe_google,probe_apple,probe_telegram,probe_cloudflare,probe_instagram,
             disconnect_reason,session_duration_secs,bytes_sent,bytes_recv,
             dns_ok,time_to_connect_ms,error_category,carrier_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )->execute([
        ni_valid_event((string)($d['event']        ?? 'connect_fail')),
        substr((string)($d['node_id']    ?? 'primary'),  0, 40),
        substr((string)($d['profile_id'] ?? ''),         0, 40) ?: null,
        substr((string)($d['sni']        ?? ''),         0, 120) ?: null,
        substr((string)($d['protocol']   ?? ''),         0, 60)  ?: null,
        ni_valid_platform((string)($d['platform'] ?? '')),
        substr((string)($d['app_version'] ?? ''),        0, 20)  ?: null,
        max(0, (int)($d['build_number']  ?? 0)),
        ni_valid_network((string)($d['network_type'] ?? '')),
        ni_anon((string)($d['isp']     ?? '')) ?: null,
        ni_anon((string)($d['carrier'] ?? '')) ?: null,
        substr((string)($d['country']    ?? ''),         0, 4)   ?: null,
        substr((string)($d['failure_stage'] ?? ''),      0, 40)  ?: null,
        ($d['latency_ms'] ?? null) !== null && $d['latency_ms'] !== '' ? max(0, (int)$d['latency_ms']) : null,
        isset($d['internet_ok']) ? (int)(bool)$d['internet_ok'] : null,
        isset($d['exit_ip_ok'])  ? (int)(bool)$d['exit_ip_ok']  : null,
        // New fields
        ($d['probe_google']    ?? null) !== null ? (int)(bool)$d['probe_google']    : null,
        ($d['probe_apple']     ?? null) !== null ? (int)(bool)$d['probe_apple']     : null,
        ($d['probe_telegram']  ?? null) !== null ? (int)(bool)$d['probe_telegram']  : null,
        ($d['probe_cloudflare']?? null) !== null ? (int)(bool)$d['probe_cloudflare']: null,
        ($d['probe_instagram'] ?? null) !== null ? (int)(bool)$d['probe_instagram'] : null,
        substr((string)($d['disconnect_reason'] ?? ''), 0, 80)  ?: null,
        ($d['session_duration_secs'] ?? null) !== null && $d['session_duration_secs'] !== '' ? max(0, (int)$d['session_duration_secs']) : null,
        ($d['bytes_sent'] ?? null) !== null && $d['bytes_sent'] !== '' ? max(0, (int)$d['bytes_sent']) : null,
        ($d['bytes_recv'] ?? null) !== null && $d['bytes_recv'] !== '' ? max(0, (int)$d['bytes_recv']) : null,
        isset($d['dns_ok']) && $d['dns_ok'] !== null && $d['dns_ok'] !== '' ? (int)(bool)$d['dns_ok'] : null,
        ($d['time_to_connect_ms'] ?? null) !== null && $d['time_to_connect_ms'] !== '' ? max(0, (int)$d['time_to_connect_ms']) : null,
        $errCat ?: null,
        substr((string)($d['carrier_name'] ?? ''), 0, 30) ?: null,
    ]);
}

/**
 * Per-node success rates over the last $days days.
 * Returns array keyed by node_id:
 *   { total, ok, fail, success_rate (0-100), avg_latency_ms, last_event_at }
 */
function ni_node_scores(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows = $pdo->prepare(
        "SELECT node_id,
                COUNT(*)                                        AS total,
                SUM(event='connect_ok')                         AS ok,
                SUM(event IN ('connect_fail','internet_fail','probe_fail')) AS fail,
                AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS avg_latency,
                MAX(created_at)                                 AS last_at
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY node_id
          ORDER BY total DESC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[$r['node_id']] = [
            'total'          => $total,
            'ok'             => $ok,
            'fail'           => (int)$r['fail'],
            'success_rate'   => $total > 0 ? round($ok / $total * 100, 1) : null,
            'avg_latency_ms' => $r['avg_latency'] !== null ? (int)round((float)$r['avg_latency']) : null,
            'last_event_at'  => $r['last_at'],
        ];
    }
    return $out;
}

/**
 * Success rate per node+profile pair.
 */
function ni_node_profile_scores(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows = $pdo->prepare(
        "SELECT node_id, COALESCE(profile_id,'primary') AS profile_id,
                COUNT(*)                              AS total,
                SUM(event='connect_ok')               AS ok,
                AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS avg_latency
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY node_id, profile_id
          ORDER BY total DESC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'node_id'        => $r['node_id'],
            'profile_id'     => $r['profile_id'],
            'total'          => $total,
            'ok'             => $ok,
            'success_rate'   => $total > 0 ? round($ok / $total * 100, 1) : null,
            'avg_latency_ms' => $r['avg_latency'] !== null ? (int)round((float)$r['avg_latency']) : null,
        ];
    }
    return $out;
}

/**
 * Success rate breakdown by platform (android / ios / unknown).
 */
function ni_platform_breakdown(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows = $pdo->prepare(
        "SELECT node_id, COALESCE(platform,'unknown') AS platform,
                COUNT(*)                AS total,
                SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY node_id, platform
          ORDER BY node_id, total DESC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'node_id'      => $r['node_id'],
            'platform'     => $r['platform'],
            'total'        => $total,
            'ok'           => $ok,
            'success_rate' => $total > 0 ? round($ok / $total * 100, 1) : null,
        ];
    }
    return $out;
}

/**
 * ISP breakdown — top ISP hashes by volume and failure rate.
 * @param string|null $node_id  Filter to a specific node; null = all nodes.
 */
function ni_isp_breakdown(PDO $pdo, ?string $node_id = null, int $days = 7): array
{
    ni_init_tables($pdo);
    $since  = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $where  = $node_id !== null ? "AND node_id = ?" : "";
    $params = $node_id !== null ? [$since, $node_id] : [$since];
    $rows   = $pdo->prepare(
        "SELECT COALESCE(isp_hash,'unknown') AS isp_hash,
                country,
                COUNT(*)                AS total,
                SUM(event='connect_ok') AS ok,
                AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS avg_latency
           FROM connect_telemetry
          WHERE created_at >= ? {$where}
            AND isp_hash IS NOT NULL
          GROUP BY isp_hash, country
          ORDER BY total DESC
          LIMIT 50"
    );
    $rows->execute($params);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'isp_hash'       => $r['isp_hash'],
            'country'        => $r['country'],
            'total'          => $total,
            'ok'             => $ok,
            'fail'           => $total - $ok,
            'success_rate'   => $total > 0 ? round($ok / $total * 100, 1) : null,
            'avg_latency_ms' => $r['avg_latency'] !== null ? (int)round((float)$r['avg_latency']) : null,
        ];
    }
    return $out;
}

/**
 * Recent failure events for debugging.
 */
function ni_recent_failures(PDO $pdo, int $limit = 100): array
{
    ni_init_tables($pdo);
    $rows = $pdo->prepare(
        "SELECT id, event, node_id, profile_id, sni, protocol, platform,
                network_type, country, failure_stage, latency_ms, internet_ok, created_at
           FROM connect_telemetry
          WHERE event != 'connect_ok'
          ORDER BY created_at DESC
          LIMIT ?"
    );
    $rows->execute([min(500, $limit)]);
    return $rows->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Daily timeline — total events and success rate per day.
 * Used for the admin chart.
 */
function ni_timeline(PDO $pdo, int $days = 30): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d', strtotime("-{$days} days"));
    $rows  = $pdo->prepare(
        "SELECT date(created_at) AS day,
                COUNT(*)                AS total,
                SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE date(created_at) >= ?
          GROUP BY day
          ORDER BY day ASC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'day'          => $r['day'],
            'total'        => $total,
            'ok'           => $ok,
            'fail'         => $total - $ok,
            'success_rate' => $total > 0 ? round($ok / $total * 100, 1) : null,
        ];
    }
    return $out;
}

/**
 * Network-type breakdown (wifi vs mobile).
 */
function ni_network_breakdown(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows  = $pdo->prepare(
        "SELECT COALESCE(network_type,'unknown') AS network_type,
                COUNT(*)                AS total,
                SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY network_type
          ORDER BY total DESC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'network_type' => $r['network_type'],
            'total'        => $total,
            'ok'           => $ok,
            'success_rate' => $total > 0 ? round($ok / $total * 100, 1) : null,
        ];
    }
    return $out;
}

/**
 * Country breakdown — top countries by volume.
 */
function ni_country_breakdown(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows  = $pdo->prepare(
        "SELECT COALESCE(country,'?') AS country,
                COUNT(*)                AS total,
                SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY country
          ORDER BY total DESC
          LIMIT 30"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'country'      => $r['country'],
            'total'        => $total,
            'ok'           => $ok,
            'success_rate' => $total > 0 ? round($ok / $total * 100, 1) : null,
        ];
    }
    return $out;
}

/**
 * Per-build success rate.
 * Returns rows: build_number, platform, total, ok, success_rate, avg_latency_ms
 */
function ni_build_breakdown(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $rows  = $pdo->prepare(
        "SELECT build_number, platform,
                COUNT(*) AS total,
                SUM(event='connect_ok') AS ok,
                AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) AS avg_latency
           FROM connect_telemetry
          WHERE created_at >= ? AND build_number > 0
          GROUP BY build_number, platform
          ORDER BY build_number DESC, total DESC"
    );
    $rows->execute([$since]);
    $out = [];
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'build_number'   => (int)$r['build_number'],
            'platform'       => $r['platform'],
            'total'          => $total,
            'ok'             => $ok,
            'success_rate'   => $total > 0 ? round($ok / $total * 100, 1) : null,
            'avg_latency_ms' => $r['avg_latency'] !== null ? (int)round((float)$r['avg_latency']) : null,
        ];
    }
    return $out;
}

/**
 * Per-probe success rate across the 5 tracked destination apps.
 * Returns rows: probe, total, ok, success_rate
 */
function ni_probe_breakdown(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $probes = ['google', 'apple', 'telegram', 'cloudflare', 'instagram'];
    $out    = [];
    foreach ($probes as $name) {
        $col  = "probe_{$name}";
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS total, SUM({$col}) AS ok
               FROM connect_telemetry
              WHERE created_at >= ? AND {$col} IS NOT NULL"
        );
        $stmt->execute([$since]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$r || (int)$r['total'] === 0) continue;
        $total = (int)$r['total'];
        $ok    = (int)$r['ok'];
        $out[] = [
            'probe'        => $name,
            'total'        => $total,
            'ok'           => $ok,
            'success_rate' => round($ok / $total * 100, 1),
        ];
    }
    return $out;
}

/**
 * Rule-based intelligence agent — generates natural language insight strings
 * from telemetry patterns over the last $days days.
 *
 * Returns array of ['level' => 'warn'|'ok'|'info', 'message' => '...']
 */
function ni_agent_insights(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));

    // Check total event count first — return early if no data
    $cnt = (int)$pdo->prepare("SELECT COUNT(*) FROM connect_telemetry WHERE created_at >= ?")->execute([$since])
        ?: 0;
    // Use a proper query for count
    $cntStmt = $pdo->prepare("SELECT COUNT(*) FROM connect_telemetry WHERE created_at >= ?");
    $cntStmt->execute([$since]);
    $cnt = (int)$cntStmt->fetchColumn();

    if ($cnt === 0) {
        return [['level' => 'info', 'message' => 'No telemetry data yet — connect events will appear here once users connect.']];
    }

    $insights = [];

    // ── 1. Build comparison: latest vs previous build ────────────────────
    $buildStmt = $pdo->prepare(
        "SELECT build_number, COUNT(*) AS total, SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ? AND build_number > 0
          GROUP BY build_number
          ORDER BY build_number DESC
          LIMIT 2"
    );
    $buildStmt->execute([$since]);
    $builds = $buildStmt->fetchAll(PDO::FETCH_ASSOC);
    if (count($builds) >= 2) {
        $latest = $builds[0];
        $prev   = $builds[1];
        $latestTotal = (int)$latest['total'];
        $prevTotal   = (int)$prev['total'];
        if ($latestTotal >= 10 && $prevTotal >= 10) {
            $latestRate = round((int)$latest['ok'] / $latestTotal * 100, 1);
            $prevRate   = round((int)$prev['ok']   / $prevTotal   * 100, 1);
            $diff = $latestRate - $prevRate;
            if ($diff >= 10) {
                $insights[] = ['level' => 'ok', 'message' =>
                    "Build #{$latest['build_number']} improved success rate from {$prevRate}% to {$latestRate}% vs build #{$prev['build_number']}"];
            } elseif ($diff <= -10) {
                $absDiff = abs(round($diff, 1));
                $insights[] = ['level' => 'warn', 'message' =>
                    "Build #{$latest['build_number']} success rate dropped by {$absDiff}% vs build #{$prev['build_number']} ({$prevRate}% → {$latestRate}%)"];
            }
        }
    }

    // ── 2. Platform comparison: Android vs iOS ───────────────────────────
    $platStmt = $pdo->prepare(
        "SELECT platform, COUNT(*) AS total, SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ? AND platform IN ('android','ios')
          GROUP BY platform"
    );
    $platStmt->execute([$since]);
    $platRows = [];
    foreach ($platStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $platRows[$r['platform']] = $r;
    }
    if (isset($platRows['android'], $platRows['ios'])) {
        $andTotal = (int)$platRows['android']['total'];
        $iosTotal = (int)$platRows['ios']['total'];
        if ($andTotal >= 10 && $iosTotal >= 10) {
            $andRate = round((int)$platRows['android']['ok'] / $andTotal * 100, 1);
            $iosRate = round((int)$platRows['ios']['ok']     / $iosTotal * 100, 1);
            $diff = abs($andRate - $iosRate);
            if ($diff >= 15) {
                if ($iosRate < $andRate) {
                    $insights[] = ['level' => 'warn', 'message' =>
                        "iOS connects {$diff}% less reliably than Android ({$iosRate}% vs {$andRate}%) — check iOS build or proxy settings"];
                } else {
                    $insights[] = ['level' => 'warn', 'message' =>
                        "Android connects {$diff}% less reliably than iOS ({$andRate}% vs {$iosRate}%) — check Android build"];
                }
            }
        }
    }

    // ── 3. WiFi vs cellular ───────────────────────────────────────────────
    $netStmt = $pdo->prepare(
        "SELECT network_type, COUNT(*) AS total, SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ? AND network_type IN ('wifi','mobile')
          GROUP BY network_type"
    );
    $netStmt->execute([$since]);
    $netRows = [];
    foreach ($netStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $netRows[$r['network_type']] = $r;
    }
    if (isset($netRows['wifi'], $netRows['mobile'])) {
        $wifiTotal   = (int)$netRows['wifi']['total'];
        $mobileTotal = (int)$netRows['mobile']['total'];
        if ($wifiTotal >= 10 && $mobileTotal >= 10) {
            $wifiRate   = round((int)$netRows['wifi']['ok']   / $wifiTotal   * 100, 1);
            $mobileRate = round((int)$netRows['mobile']['ok'] / $mobileTotal * 100, 1);
            $diff = $wifiRate - $mobileRate;
            if ($diff >= 20) {
                $insights[] = ['level' => 'warn', 'message' =>
                    "WiFi connections {$diff}% more reliable than cellular ({$wifiRate}% vs {$mobileRate}%) — VPN may be blocked on some carriers"];
            }
        }
    }

    // ── 4. Disconnect reasons ─────────────────────────────────────────────
    $discStmt = $pdo->prepare(
        "SELECT disconnect_reason, COUNT(*) AS cnt
           FROM connect_telemetry
          WHERE created_at >= ? AND disconnect_reason IS NOT NULL AND disconnect_reason != ''
          GROUP BY disconnect_reason
          ORDER BY cnt DESC
          LIMIT 5"
    );
    $discStmt->execute([$since]);
    $discRows = $discStmt->fetchAll(PDO::FETCH_ASSOC);
    $discTotal = array_sum(array_column($discRows, 'cnt'));
    foreach ($discRows as $dr) {
        $pct = $discTotal > 0 ? round((int)$dr['cnt'] / $discTotal * 100, 1) : 0;
        if ((int)$dr['cnt'] >= 10 && $pct >= 30) {
            $insights[] = ['level' => 'warn', 'message' =>
                "Disconnect reason '{$dr['disconnect_reason']}' accounts for {$pct}% of session ends"];
        }
    }

    // ── 5. Error categories ───────────────────────────────────────────────
    $failTotalStmt = $pdo->prepare(
        "SELECT COUNT(*) FROM connect_telemetry WHERE created_at >= ? AND event != 'connect_ok'"
    );
    $failTotalStmt->execute([$since]);
    $failTotal = (int)$failTotalStmt->fetchColumn();

    if ($failTotal >= 10) {
        $errStmt = $pdo->prepare(
            "SELECT error_category, COUNT(*) AS cnt
               FROM connect_telemetry
              WHERE created_at >= ? AND error_category IS NOT NULL AND event != 'connect_ok'
              GROUP BY error_category
              ORDER BY cnt DESC
              LIMIT 5"
        );
        $errStmt->execute([$since]);
        foreach ($errStmt->fetchAll(PDO::FETCH_ASSOC) as $er) {
            $pct = round((int)$er['cnt'] / $failTotal * 100, 1);
            if ($pct >= 20) {
                $insights[] = ['level' => 'warn', 'message' =>
                    "Error category '{$er['error_category']}' is causing {$pct}% of failures ({$er['cnt']} events)"];
            }
        }
    }

    // ── 6. Probe-based insights ───────────────────────────────────────────
    // Fetch aggregated probe stats
    $probeData = [];
    foreach (['google', 'apple', 'telegram', 'cloudflare', 'instagram'] as $name) {
        $col  = "probe_{$name}";
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS total, SUM({$col}) AS ok
               FROM connect_telemetry
              WHERE created_at >= ? AND {$col} IS NOT NULL"
        );
        $stmt->execute([$since]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($r && (int)$r['total'] >= 10) {
            $t = (int)$r['total'];
            $o = (int)$r['ok'];
            $probeData[$name] = ['total' => $t, 'ok' => $o, 'rate' => round($o / $t * 100, 1)];
        }
    }
    if (isset($probeData['telegram'], $probeData['google'])) {
        if ($probeData['telegram']['rate'] < 50 && $probeData['google']['rate'] > 80) {
            $x = round(100 - $probeData['telegram']['rate'], 1);
            $insights[] = ['level' => 'warn', 'message' =>
                "Telegram connectivity fails for {$x}% of sessions — MTProto may need UDP relay"];
        }
    }
    if (isset($probeData['instagram']) && $probeData['instagram']['rate'] < 70) {
        $x = round(100 - $probeData['instagram']['rate'], 1);
        $insights[] = ['level' => 'warn', 'message' =>
            "Instagram shows partial connectivity issues ({$x}% failure rate) — IP reputation may be affecting Meta CDN"];
    }

    // ── 7. Country-specific low success rates ────────────────────────────
    $countryStmt = $pdo->prepare(
        "SELECT COALESCE(country,'?') AS country, COUNT(*) AS total, SUM(event='connect_ok') AS ok
           FROM connect_telemetry
          WHERE created_at >= ?
          GROUP BY country
          HAVING total >= 10
          ORDER BY total DESC
          LIMIT 20"
    );
    $countryStmt->execute([$since]);
    foreach ($countryStmt->fetchAll(PDO::FETCH_ASSOC) as $cr) {
        $total = (int)$cr['total'];
        $rate  = round((int)$cr['ok'] / $total * 100, 1);
        if ($rate < 60) {
            $insights[] = ['level' => 'warn', 'message' =>
                "Low success rate in {$cr['country']}: only {$rate}% of {$total} connect attempts succeeded"];
        }
    }

    if (empty($insights)) {
        $insights[] = ['level' => 'ok', 'message' => "No anomalies detected in the last {$days} days — all patterns look normal."];
    }

    return $insights;
}
