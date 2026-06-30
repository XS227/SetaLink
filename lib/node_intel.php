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
        "nat_type              TEXT    DEFAULT NULL",
        "ip_version            TEXT    DEFAULT NULL",
        "rtt_ms                INTEGER DEFAULT NULL",
        "network_switched      INTEGER DEFAULT NULL",
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

    // Validate new enum fields
    $natType = (string)($d['nat_type'] ?? '');
    $natType = in_array($natType, ['full_cone', 'symmetric', 'port_restricted', 'unknown'], true) ? $natType : null;

    $ipVersion = (string)($d['ip_version'] ?? '');
    $ipVersion = in_array($ipVersion, ['ipv4', 'ipv6', 'dual', 'unknown'], true) ? $ipVersion : null;

    $pdo->prepare(
        "INSERT INTO connect_telemetry
            (event,node_id,profile_id,sni,protocol,platform,app_version,build_number,
             network_type,isp_hash,carrier_hash,country,failure_stage,latency_ms,
             internet_ok,exit_ip_ok,
             probe_google,probe_apple,probe_telegram,probe_cloudflare,probe_instagram,
             disconnect_reason,session_duration_secs,bytes_sent,bytes_recv,
             dns_ok,time_to_connect_ms,error_category,carrier_name,
             nat_type,ip_version,rtt_ms,network_switched)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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
        // New diagnostic fields
        $natType,
        $ipVersion,
        ($d['rtt_ms'] ?? null) !== null && $d['rtt_ms'] !== '' ? max(0, (int)$d['rtt_ms']) : null,
        ($d['network_switched'] ?? null) !== null && $d['network_switched'] !== '' ? (int)(bool)$d['network_switched'] : null,
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

/**
 * AI Recommendations engine — generates actionable, prioritised recommendations
 * from 8 telemetry pattern detectors.
 *
 * Each recommendation:
 *   type     => 'route|infra|protocol|security|platform'
 *   severity => 'critical|warn|info'
 *   title    => short headline
 *   body     => supporting evidence
 *   action   => concrete next step
 *
 * Returns array sorted critical → warn → info. Empty if insufficient data.
 */
function ni_recommendations(PDO $pdo, int $days = 7): array
{
    ni_init_tables($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));

    // Require at least 5 events to generate any recommendation
    $cntStmt = $pdo->prepare("SELECT COUNT(*) FROM connect_telemetry WHERE created_at >= ?");
    $cntStmt->execute([$since]);
    if ((int)$cntStmt->fetchColumn() < 5) return [];

    $recs = [];

    // ── Pattern 1: Carrier routing mismatch (ROUTE, warn) ────────────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT carrier_name, carrier_hash, node_id,
                    COUNT(*) AS total, SUM(event='connect_ok') AS ok
               FROM connect_telemetry
              WHERE created_at >= :since AND carrier_name IS NOT NULL AND carrier_name != ''
              GROUP BY carrier_hash, node_id
             HAVING total >= 5"
        );
        $stmt->execute([':since' => $since]);
        $byCarrier = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $r['rate'] = (int)$r['total'] > 0 ? (int)$r['ok'] / (int)$r['total'] * 100 : 0;
            $byCarrier[$r['carrier_hash']][] = $r;
        }
        foreach ($byCarrier as $nodes) {
            if (count($nodes) < 2) continue;
            $best = $worst = null;
            foreach ($nodes as $n) {
                if ($best  === null || $n['rate'] > $best['rate'])  $best  = $n;
                if ($worst === null || $n['rate'] < $worst['rate']) $worst = $n;
            }
            if ($best['node_id'] === $worst['node_id']) continue;
            $diff = $best['rate'] - $worst['rate'];
            if ($diff >= 20 && (int)$best['total'] >= 5 && (int)$worst['total'] >= 5) {
                $badRate  = round($worst['rate'], 1);
                $goodRate = round($best['rate'], 1);
                $recs[] = [
                    'type'     => 'route',
                    'severity' => 'warn',
                    'title'    => "Route {$worst['carrier_name']} to {$best['node_id']}",
                    'body'     => "{$worst['carrier_name']}: {$badRate}% success on {$worst['node_id']}, {$goodRate}% on {$best['node_id']} ({$worst['total']} sessions)",
                    'action'   => "Add carrier-based routing rule in server config or recommend users switch to {$best['node_id']}",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 2: Infrastructure RTT spike (INFRA, critical/warn) ───────────
    try {
        $recentStmt = $pdo->prepare(
            "SELECT node_id, AVG(rtt_ms) AS avg_rtt, COUNT(*) AS cnt
               FROM connect_telemetry
              WHERE created_at >= datetime('now','-6 hours') AND rtt_ms IS NOT NULL AND rtt_ms > 0
              GROUP BY node_id HAVING cnt >= 5"
        );
        $recentStmt->execute();
        $recent = [];
        foreach ($recentStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $recent[$r['node_id']] = $r;
        }
        $histStmt = $pdo->prepare(
            "SELECT node_id, AVG(rtt_ms) AS avg_rtt_hist, COUNT(*) AS cnt
               FROM connect_telemetry
              WHERE created_at >= :since AND created_at < datetime('now','-6 hours')
                AND rtt_ms IS NOT NULL AND rtt_ms > 0
              GROUP BY node_id HAVING cnt >= 10"
        );
        $histStmt->execute([':since' => $since]);
        foreach ($histStmt->fetchAll(PDO::FETCH_ASSOC) as $h) {
            $nodeId = $h['node_id'];
            if (!isset($recent[$nodeId])) continue;
            $current = (float)$recent[$nodeId]['avg_rtt'];
            $hist    = (float)$h['avg_rtt_hist'];
            if ($hist <= 0) continue;
            $ratio = $current / $hist;
            $sev = $ratio >= 2.0 ? 'critical' : ($ratio >= 1.5 ? 'warn' : null);
            if ($sev === null) continue;
            $recs[] = [
                'type'     => 'infra',
                'severity' => $sev,
                'title'    => "{$nodeId} latency spike — " . (int)round($current) . "ms vs " . (int)round($hist) . "ms 7-day avg",
                'body'     => "RTT " . ($ratio >= 2.0 ? 'jumped' : 'elevated') . " to " . (int)round($current) . "ms (was " . (int)round($hist) . "ms historical avg)",
                'action'   => "Check server load, connectivity, or add backup node",
            ];
        }
    } catch (\Throwable $_) {}

    // ── Pattern 3: Telegram blocked on cellular (PROTOCOL, warn) ─────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT
               SUM(CASE WHEN network_type='mobile' AND probe_telegram=0 THEN 1 ELSE 0 END) AS tg_fail_mobile,
               SUM(CASE WHEN network_type='mobile' AND probe_telegram IS NOT NULL THEN 1 ELSE 0 END) AS tg_tested_mobile
             FROM connect_telemetry WHERE created_at >= :since"
        );
        $stmt->execute([':since' => $since]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            $tested = (int)$r['tg_tested_mobile'];
            $fail   = (int)$r['tg_fail_mobile'];
            if ($tested >= 5 && $fail / $tested > 0.60) {
                $pct = round($fail / $tested * 100, 1);
                $recs[] = [
                    'type'     => 'protocol',
                    'severity' => 'warn',
                    'title'    => "Telegram blocked on cellular ({$pct}% fail rate)",
                    'body'     => "{$pct}% of Telegram sessions fail on mobile networks ({$fail}/{$tested} sessions)",
                    'action'   => "UDP relay or SOCKS5 proxy for MTProto traffic may be needed",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 4: IP reputation — probe failure by node (SECURITY, warn) ────
    try {
        $stmt = $pdo->prepare(
            "SELECT node_id,
               SUM(CASE WHEN probe_instagram=0 THEN 1 ELSE 0 END) AS ig_fail,
               SUM(CASE WHEN probe_instagram IS NOT NULL THEN 1 ELSE 0 END) AS ig_total,
               SUM(CASE WHEN probe_telegram=0 THEN 1 ELSE 0 END) AS tg_fail,
               SUM(CASE WHEN probe_telegram IS NOT NULL THEN 1 ELSE 0 END) AS tg_total
             FROM connect_telemetry WHERE created_at >= :since
             GROUP BY node_id"
        );
        $stmt->execute([':since' => $since]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $igTotal = (int)$r['ig_total'];
            $tgTotal = (int)$r['tg_total'];
            $igFail  = (int)$r['ig_fail'];
            $tgFail  = (int)$r['tg_fail'];
            $igRate  = $igTotal >= 5 ? round($igFail / $igTotal * 100, 1) : null;
            $tgRate  = $tgTotal >= 5 ? round($tgFail / $tgTotal * 100, 1) : null;
            if (($igRate !== null && $igRate > 65) || ($tgRate !== null && $tgRate > 65)) {
                $igDisplay = $igRate !== null ? "{$igRate}%" : "n/a";
                $tgDisplay = $tgRate !== null ? "{$tgRate}%" : "n/a";
                $recs[] = [
                    'type'     => 'security',
                    'severity' => 'warn',
                    'title'    => "{$r['node_id']} exit IP has reputation issues",
                    'body'     => "Instagram: {$igDisplay} fail, Telegram: {$tgDisplay} fail. Hetzner IPs can be flagged by Meta/Telegram.",
                    'action'   => "Request new IP from provider or add IP rotation for {$r['node_id']}",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 5: Build regression (PLATFORM, critical/info) ────────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT build_number, COUNT(*) AS total, SUM(event='connect_ok') AS ok
               FROM connect_telemetry WHERE created_at >= :since AND build_number > 0
              GROUP BY build_number HAVING total >= 5
              ORDER BY build_number DESC LIMIT 3"
        );
        $stmt->execute([':since' => $since]);
        $builds = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (count($builds) >= 2) {
            $latest     = $builds[0];
            $prev       = $builds[1];
            $latestRate = (int)$latest['total'] > 0 ? round((int)$latest['ok'] / (int)$latest['total'] * 100, 1) : 0;
            $prevRate   = (int)$prev['total']   > 0 ? round((int)$prev['ok']   / (int)$prev['total']   * 100, 1) : 0;
            $drop = round($prevRate - $latestRate, 1);
            $gain = round($latestRate - $prevRate, 1);
            if ($drop >= 15) {
                $recs[] = [
                    'type'     => 'platform',
                    'severity' => 'critical',
                    'title'    => "Build #{$latest['build_number']} regression — success rate dropped {$drop}%",
                    'body'     => "Build #{$latest['build_number']}: {$latestRate}% vs Build #{$prev['build_number']}: {$prevRate}% success rate",
                    'action'   => "Investigate and hotfix or revert build #{$latest['build_number']}",
                ];
            } elseif ($gain >= 10) {
                $recs[] = [
                    'type'     => 'platform',
                    'severity' => 'info',
                    'title'    => "Build #{$latest['build_number']} improved success rate by {$gain}%",
                    'body'     => "Build #{$latest['build_number']}: {$latestRate}% vs Build #{$prev['build_number']}: {$prevRate}% success rate",
                    'action'   => "Push update notification to users still on build #{$prev['build_number']}",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 6: Network switch failures (PROTOCOL, warn) ──────────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT
               SUM(CASE WHEN network_switched=1 AND event!='connect_ok' THEN 1 ELSE 0 END) AS switch_fail,
               SUM(network_switched=1) AS switch_total,
               SUM(CASE WHEN network_switched=0 AND event!='connect_ok' THEN 1 ELSE 0 END) AS noswitch_fail,
               SUM(network_switched=0) AS noswitch_total
             FROM connect_telemetry WHERE created_at >= :since"
        );
        $stmt->execute([':since' => $since]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            $switchTotal   = (int)$r['switch_total'];
            $switchFail    = (int)$r['switch_fail'];
            $noswitchTotal = (int)$r['noswitch_total'];
            $noswitchFail  = (int)$r['noswitch_fail'];
            if ($switchTotal >= 5) {
                $switchRate   = $switchFail / $switchTotal;
                $noswitchRate = $noswitchTotal > 0 ? $noswitchFail / $noswitchTotal : 0;
                if ($switchRate > 0.50 && ($noswitchRate < 0.001 || $switchRate >= $noswitchRate * 2)) {
                    $pct = round($switchRate * 100, 1);
                    $recs[] = [
                        'type'     => 'protocol',
                        'severity' => 'warn',
                        'title'    => "WiFi→Mobile switches cause {$pct}% session failures",
                        'body'     => "Sessions where network changed during connect: {$switchFail}/{$switchTotal} failed",
                        'action'   => "Implement reconnect-on-network-change or always-on VPN mode",
                    ];
                }
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 7: NAT type issues (PROTOCOL, warn/info) ─────────────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT nat_type, COUNT(*) AS total, SUM(event='connect_ok') AS ok
               FROM connect_telemetry WHERE created_at >= :since AND nat_type IS NOT NULL
              GROUP BY nat_type HAVING total >= 5"
        );
        $stmt->execute([':since' => $since]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if ($r['nat_type'] !== 'symmetric') continue;
            $natTotal    = (int)$r['total'];
            $natOk       = (int)$r['ok'];
            $natFail     = $natTotal - $natOk;
            $successRate = $natTotal > 0 ? round($natOk / $natTotal * 100, 1) : 0;
            if ($successRate < 70) {
                $pct = round($natFail / $natTotal * 100, 1);
                $recs[] = [
                    'type'     => 'protocol',
                    'severity' => $successRate < 50 ? 'warn' : 'info',
                    'title'    => "Symmetric NAT detected in {$pct}% of failures",
                    'body'     => "Symmetric NAT restricts UDP. {$natTotal} sessions with symmetric NAT, {$natFail} failed.",
                    'action'   => "Reality/VLESS over TCP is already configured — ensure UDP fallback is disabled",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // ── Pattern 8: IPv6 performance (INFRA, info/warn) ───────────────────────
    try {
        $stmt = $pdo->prepare(
            "SELECT ip_version, COUNT(*) AS total, SUM(event='connect_ok') AS ok
               FROM connect_telemetry WHERE created_at >= :since AND ip_version IS NOT NULL
              GROUP BY ip_version HAVING total >= 5"
        );
        $stmt->execute([':since' => $since]);
        $ipVersions = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $total = (int)$r['total'];
            $ok    = (int)$r['ok'];
            $ipVersions[$r['ip_version']] = [
                'rate' => $total > 0 ? round($ok / $total * 100, 1) : 0,
            ];
        }
        if (isset($ipVersions['ipv4'], $ipVersions['ipv6'])) {
            $ipv4Rate = $ipVersions['ipv4']['rate'];
            $ipv6Rate = $ipVersions['ipv6']['rate'];
            $diff = round(abs($ipv6Rate - $ipv4Rate), 1);
            if ($ipv6Rate > $ipv4Rate + 10) {
                $recs[] = [
                    'type'     => 'infra',
                    'severity' => 'info',
                    'title'    => "IPv6 users connect {$diff}% more reliably than IPv4",
                    'body'     => "IPv6 success rate: {$ipv6Rate}% vs IPv4: {$ipv4Rate}%",
                    'action'   => "Prioritise IPv6 addressing on server for better performance",
                ];
            } elseif ($ipv4Rate > $ipv6Rate + 10) {
                $recs[] = [
                    'type'     => 'infra',
                    'severity' => 'warn',
                    'title'    => "IPv6 users have {$diff}% lower success rate — check IPv6 connectivity on server",
                    'body'     => "IPv6 success rate: {$ipv6Rate}% vs IPv4: {$ipv4Rate}%",
                    'action'   => "Check IPv6 connectivity on server or disable dual-stack for this node",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // Sort: critical → warn → info
    $order = ['critical' => 0, 'warn' => 1, 'info' => 2];
    usort($recs, fn($a, $b) => ($order[$a['severity']] ?? 3) <=> ($order[$b['severity']] ?? 3));

    return $recs;
}
