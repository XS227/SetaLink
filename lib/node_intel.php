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
        "ios_version           TEXT    DEFAULT NULL",   // e.g. "17.5.1"
        "device_model          TEXT    DEFAULT NULL",   // e.g. "iPhone15,3"
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
        // Diagnostic checkpoints (build 68+)
        "tunnel_mode           TEXT    DEFAULT NULL",   // HEV | proxy
        "cp1_readable          TEXT    DEFAULT NULL",   // YES | NO
        "cp4_connections       INTEGER DEFAULT NULL",   // total xray SOCKS5 entries
        "cp4_first_dest        TEXT    DEFAULT NULL",   // first destination seen
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
             nat_type,ip_version,rtt_ms,network_switched,
             tunnel_mode,cp1_readable,cp4_connections,cp4_first_dest,
             ios_version,device_model)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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
        // Diagnostic fields
        $natType,
        $ipVersion,
        ($d['rtt_ms'] ?? null) !== null && $d['rtt_ms'] !== '' ? max(0, (int)$d['rtt_ms']) : null,
        ($d['network_switched'] ?? null) !== null && $d['network_switched'] !== '' ? (int)(bool)$d['network_switched'] : null,
        // Build 68 checkpoint fields
        substr((string)($d['tunnel_mode']    ?? ''), 0, 20) ?: null,
        substr((string)($d['cp1_readable']   ?? ''), 0, 10) ?: null,
        ($d['cp4_connections'] ?? null) !== null && $d['cp4_connections'] !== '' ? max(0, (int)$d['cp4_connections']) : null,
        substr((string)($d['cp4_first_dest'] ?? ''), 0, 120) ?: null,
        // Build 69 device context fields
        substr((string)($d['ios_version']    ?? ''), 0, 20)  ?: null,
        substr((string)($d['device_model']   ?? ''), 0, 30)  ?: null,
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

// ── Diagnostic Sessions (Intelligence Agent) ──────────────────────────────────

/**
 * Create the diagnostic_sessions table if it does not exist.
 */
function ni_init_diag_sessions(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS diagnostic_sessions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id       TEXT    UNIQUE,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now')),

        server_ip        TEXT    DEFAULT NULL,
        server_label     TEXT    DEFAULT NULL,
        tunnel_mode      TEXT    DEFAULT NULL,
        platform         TEXT    DEFAULT NULL,
        app_version      TEXT    DEFAULT NULL,
        build_number     INTEGER DEFAULT NULL,
        country          TEXT    DEFAULT NULL,
        ios_version      TEXT    DEFAULT NULL,
        device_model     TEXT    DEFAULT NULL,
        network_type     TEXT    DEFAULT NULL,
        carrier          TEXT    DEFAULT NULL,

        cp1_result       TEXT    DEFAULT 'UNKNOWN',
        cp1_detail       TEXT    DEFAULT NULL,
        cp2_result       TEXT    DEFAULT 'UNKNOWN',
        cp3_result       TEXT    DEFAULT 'UNKNOWN',
        cp4_result       TEXT    DEFAULT 'UNKNOWN',
        cp4_connections  INTEGER DEFAULT 0,
        cp4_first_dest   TEXT    DEFAULT NULL,

        vps_connections  INTEGER DEFAULT NULL,
        vps_sample       TEXT    DEFAULT NULL,

        conclusion       TEXT    DEFAULT NULL,
        conclusion_code  TEXT    DEFAULT NULL,

        session_duration_secs INTEGER DEFAULT NULL,
        disconnect_reason     TEXT    DEFAULT NULL,
        telemetry_row_id      INTEGER DEFAULT NULL
    )");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_created ON diagnostic_sessions(created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_server  ON diagnostic_sessions(server_ip, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_code    ON diagnostic_sessions(conclusion_code, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_cp1     ON diagnostic_sessions(cp1_result, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_cp4     ON diagnostic_sessions(cp4_result, created_at)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_device  ON diagnostic_sessions(device_model, ios_version)");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS ds_carrier ON diagnostic_sessions(carrier, server_label)");
    // Migrations for existing tables (ALTER TABLE is silently ignored on duplicate columns)
    foreach ([
        "ios_version  TEXT DEFAULT NULL",
        "device_model TEXT DEFAULT NULL",
        "network_type TEXT DEFAULT NULL",
        "carrier      TEXT DEFAULT NULL",
    ] as $col) {
        try { $pdo->exec("ALTER TABLE diagnostic_sessions ADD COLUMN {$col}"); } catch (\Throwable $e) {}
    }
}

/** Human-readable label for a server IP or node_id. */
function ni_server_label(string $nodeId): string
{
    return match (true) {
        str_starts_with($nodeId, '65.109.183') => 'Finland',
        str_starts_with($nodeId, '178.104.77') => 'Germany',
        $nodeId === 'fi-hel'                   => 'Finland',
        $nodeId === 'primary'                  => 'Primary',
        default                                => $nodeId,
    };
}

/**
 * Generate a conclusion from CP1/CP4 evidence.
 * Returns ['conclusion' => '...', 'conclusion_code' => '...']
 */
function ni_generate_conclusion(string $tunnelMode, string $cp1Readable, int $cp4Conns): array
{
    if ($tunnelMode !== 'HEV' && $tunnelMode !== '') {
        return [
            'conclusion'      => "Proxy mode ({$tunnelMode}) — TUN diagnostics not applicable",
            'conclusion_code' => 'proxy_mode',
        ];
    }
    if ($cp1Readable === '') {
        return [
            'conclusion'      => 'No CP data — client predates build-68 instrumentation',
            'conclusion_code' => 'no_data',
        ];
    }
    if ($cp1Readable !== 'YES') {
        return [
            'conclusion'      => "CP1 FAIL (cp1_readable={$cp1Readable}) — iOS not delivering packets to TUN; likely wrong utun fd or routes not applied",
            'conclusion_code' => 'cp1_fail',
        ];
    }
    if ($cp4Conns === 0) {
        return [
            'conclusion'      => 'CP1 PASS · CP4 FAIL — iOS sent packets to TUN but HEV never connected to Xray SOCKS5',
            'conclusion_code' => 'cp4_fail',
        ];
    }
    return [
        'conclusion'      => "CP1 PASS · CP4 PASS — {$cp4Conns} Xray SOCKS5 connection(s); tunnel healthy",
        'conclusion_code' => 'tunnel_ok',
    ];
}

/**
 * Create one diagnostic_sessions row from a disconnect telemetry event.
 *
 * @param array $d            Raw POST data (same fields as ni_record).
 * @param int   $telemetryId  Row ID returned by lastInsertId() after ni_record.
 */
function ni_create_diag_session(PDO $pdo, array $d, int $telemetryId): void
{
    ni_init_diag_sessions($pdo);

    $nodeId      = (string)($d['node_id']      ?? 'unknown');
    $serverLabel = ni_server_label($nodeId);
    $tunnelMode  = (string)($d['tunnel_mode']  ?? '');
    $cp1         = (string)($d['cp1_readable'] ?? '');
    $cp4Conns    = max(0, (int)($d['cp4_connections'] ?? 0));

    $cp1Result = match ($cp1) {
        'YES'   => 'PASS',
        'NO'    => 'FAIL',
        ''      => 'UNKNOWN',
        default => str_starts_with($cp1, 'ERR') ? 'FAIL' : 'UNKNOWN',
    };
    // CP4 is UNKNOWN when we have no CP1 data at all (pre-build-68 clients)
    $cp4Result = $cp1 !== '' ? ($cp4Conns > 0 ? 'PASS' : 'FAIL') : 'UNKNOWN';
    // CP2 (HEV→SOCKS5 connect) and CP3 (SOCKS5 handshake) are inferred from CP4:
    // if Xray logged an accepted connection, both intermediate steps passed.
    $cp2Result = $cp4Result;
    $cp3Result = $cp4Result;

    $cp1Detail = match ($cp1) {
        'YES'   => 'tunFd readable — iOS delivering packets to TUN',
        'NO'    => 'tunFd never readable — iOS not routing to TUN',
        ''      => 'Not measured (pre-build-68)',
        default => $cp1,
    };

    // VPS check: Finland's xray log is local to this server
    $vpsConnections = null;
    $vpsSample      = null;
    if ($nodeId === '65.109.183.7' || $nodeId === 'fi-hel') {
        $logPath = '/var/log/xray/access.log';
        if (is_readable($logPath)) {
            $lines   = file($logPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            $recent  = array_filter(
                array_slice($lines, -200),
                fn($l) => !(str_contains($l, '127.0.0.1:') && str_contains($l, 'api'))
            );
            $vpsConnections = count($recent);
            $vpsSample      = implode("\n", array_slice(array_values($recent), -3)) ?: null;
        }
    }

    $conc      = ni_generate_conclusion($tunnelMode, $cp1, $cp4Conns);
    $sessionId = 'ds-' . substr(hash('sha256', (string)$telemetryId . $nodeId), 0, 12);

    $pdo->prepare(
        "INSERT OR IGNORE INTO diagnostic_sessions
            (session_id, created_at,
             server_ip, server_label, tunnel_mode, platform, app_version, build_number, country,
             ios_version, device_model, network_type, carrier,
             cp1_result, cp1_detail, cp2_result, cp3_result,
             cp4_result, cp4_connections, cp4_first_dest,
             vps_connections, vps_sample,
             conclusion, conclusion_code,
             session_duration_secs, disconnect_reason, telemetry_row_id)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )->execute([
        $sessionId,
        $nodeId,
        $serverLabel,
        $tunnelMode ?: null,
        (string)($d['platform']    ?? '') ?: null,
        (string)($d['app_version'] ?? '') ?: null,
        isset($d['build_number']) && $d['build_number'] !== '' ? (int)$d['build_number'] : null,
        (string)($d['country']     ?? '') ?: null,
        // Build 69: device context
        (string)($d['ios_version']   ?? '') ?: null,
        (string)($d['device_model']  ?? '') ?: null,
        (string)($d['network_type']  ?? '') ?: null,
        (string)($d['carrier_name']  ?? '') ?: null,
        $cp1Result,
        $cp1Detail,
        $cp2Result,
        $cp3Result,
        $cp4Result,
        $cp4Conns,
        (string)($d['cp4_first_dest'] ?? '') ?: null,
        $vpsConnections,
        $vpsSample,
        $conc['conclusion'],
        $conc['conclusion_code'],
        isset($d['session_duration_secs']) && $d['session_duration_secs'] !== '' ? max(0, (int)$d['session_duration_secs']) : null,
        (string)($d['disconnect_reason'] ?? '') ?: null,
        $telemetryId,
    ]);
}

/**
 * Query diagnostic sessions with optional filters.
 *
 * Supported filters:
 *   server         => 'Finland' | 'Germany' | IP string
 *   cp1            => 'PASS' | 'FAIL' | 'UNKNOWN'
 *   cp4            => 'PASS' | 'FAIL' | 'UNKNOWN'
 *   conclusion_code => 'tunnel_ok' | 'cp1_fail' | 'cp4_fail' | 'proxy_mode' | 'no_data'
 *   platform       => 'ios' | 'android'
 *   since          => 'YYYY-MM-DD'
 *   limit          => int (default 50, max 200)
 */
function ni_query_diag_sessions(PDO $pdo, array $filters = []): array
{
    ni_init_diag_sessions($pdo);

    $where  = ['1=1'];
    $params = [];

    if (!empty($filters['server'])) {
        $srv = $filters['server'];
        if (strtolower($srv) === 'finland') {
            $where[] = "(server_label='Finland' OR server_ip='65.109.183.7')";
        } elseif (strtolower($srv) === 'germany') {
            $where[] = "(server_label LIKE 'Germany%' OR server_label='Primary' OR server_ip='178.104.77.231')";
        } else {
            $where[]  = "(server_ip=? OR server_label=?)";
            $params[] = $srv;
            $params[] = $srv;
        }
    }
    if (!empty($filters['cp1'])) {
        $where[]  = "cp1_result = ?";
        $params[] = strtoupper($filters['cp1']);
    }
    if (!empty($filters['cp4'])) {
        $where[]  = "cp4_result = ?";
        $params[] = strtoupper($filters['cp4']);
    }
    if (!empty($filters['conclusion_code'])) {
        $where[]  = "conclusion_code = ?";
        $params[] = $filters['conclusion_code'];
    }
    if (!empty($filters['platform'])) {
        $where[]  = "platform = ?";
        $params[] = $filters['platform'];
    }
    if (!empty($filters['since'])) {
        $where[]  = "created_at >= ?";
        $params[] = $filters['since'];
    }

    $limit = min(200, max(1, (int)($filters['limit'] ?? 50)));
    $sql   = "SELECT * FROM diagnostic_sessions WHERE " . implode(' AND ', $where)
           . " ORDER BY created_at DESC LIMIT {$limit}";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

// ── AI Diagnosis Engine ───────────────────────────────────────────────────────

/**
 * Human-readable cause sentence for a diagnostic session.
 */
function ni_diag_cause(string $conclusionCode, string $cp1Readable, int $cp4Conns): string
{
    return match ($conclusionCode) {
        'tunnel_ok'  => "Tunnel healthy — traffic confirmed iOS → TUN → SOCKS5 → Xray ({$cp4Conns} connections)",
        'cp4_fail'   => "HEV started and received packets from iOS (CP1 PASS), but never established a SOCKS5 connection to Xray on port 10808",
        'cp1_fail'   => str_starts_with($cp1Readable, 'ERR')
            ? "Wrong utun fd (recv returned {$cp1Readable}) — HEV is listening on the incorrect file descriptor; iOS packets never arrived at the TUN"
            : "iOS is not routing packets to the TUN — NEPacketTunnelNetworkSettings routes may not have been applied, or completionHandler was called too early",
        'proxy_mode' => "Proxy mode active — HEV TUN engine is not used, CP diagnostics not applicable",
        'no_data'    => "No CP data — client predates build-68 instrumentation; upgrade to build 68+ to enable diagnostics",
        default      => "Inconclusive — insufficient data to determine cause",
    };
}

/**
 * Confidence percentage (0–100) for a conclusion code.
 * Based on how unambiguous the available CP evidence is.
 */
function ni_diag_confidence(string $conclusionCode, string $cp1Readable): int
{
    return match ($conclusionCode) {
        'tunnel_ok'  => 95,
        'cp4_fail'   => 88,
        'cp1_fail'   => str_starts_with($cp1Readable, 'ERR') ? 92 : 83,
        'proxy_mode' => 99,
        'no_data'    => 0,
        default      => 40,
    };
}

/**
 * Actionable bullet-point suggestions for a given conclusion.
 * Returns string[], each suitable for display as a bullet point.
 */
function ni_diag_suggestions(string $conclusionCode, string $cp1Readable): array
{
    return match ($conclusionCode) {
        'tunnel_ok'  => [
            "Tunnel confirmed healthy — if specific apps fail, investigate at DNS/application layer",
            "Check if the app uses certificate pinning or SNI that bypasses the VPN",
            "Verify exit IP with runTraceTest() to confirm all traffic routes through VPS",
        ],
        'cp4_fail'   => [
            "Verify Xray is listening on 127.0.0.1:10808 BEFORE HEV starts (check XRAY_RESP log line)",
            "Inspect HEV YAML: socks5.port must be 10808, socks5.address must be 127.0.0.1",
            "Check App Group container is writable from the NE sandbox (HEV config temp file)",
            "Look for 'HEV engine exited early rc=' in the tunnel log — non-zero rc = config error",
            "Check VPS /var/log/xray/access.log for any client connections during the test window",
        ],
        'cp1_fail'   => str_starts_with($cp1Readable, 'ERR') ? [
            "utun fd scan returned an error — check fd scan range 0..9 in discoverUtunFd()",
            "Verify the extension has not been sandbox-restricted from reading fd 5",
            "Try logging all open file descriptors at the start of startTunnel to find the utun fd",
        ] : [
            "Verify NEIPv4Settings includes the 0.0.0.0/0 default route in includedRoutes",
            "Ensure setTunnelNetworkSettings completionHandler is only called once with nil error",
            "Confirm excludedRoutes list does not accidentally swallow all traffic",
            "Add a log immediately after completionHandler(nil) to confirm the sequence",
        ],
        'proxy_mode' => [
            "Proxy mode is expected for older devices or the non-HEV code path",
            "To test HEV, ensure the build flag HEV_AVAILABLE is set and xcframework is linked",
        ],
        'no_data'    => [
            "Install build 68+ to activate CP1/CP4 diagnostic instrumentation",
            "Verify telemetry POST reaches https://setalink.no/v1/telemetry/connect after disconnect",
        ],
        default      => ["Insufficient data — run a full disconnect cycle on build 68+ to generate CP evidence"],
    };
}

/**
 * Enrich a diagnostic_sessions row with cause, confidence, and suggestions.
 */
function ni_enrich_session(array $row): array
{
    $code    = (string)($row['conclusion_code'] ?? '');
    $cp1     = (string)($row['cp1_readable']    ?? '');
    $cp4     = (int)($row['cp4_connections']    ?? 0);
    $row['cause']       = ni_diag_cause($code, $cp1, $cp4);
    $row['confidence']  = ni_diag_confidence($code, $cp1);
    $row['suggestions'] = ni_diag_suggestions($code, $cp1);
    return $row;
}

/**
 * Detect cross-session failure patterns.
 * Returns array of pattern alerts: ['type', 'severity', 'message', 'detail']
 */
function ni_diag_patterns(PDO $pdo, int $days = 14): array
{
    ni_init_diag_sessions($pdo);
    $since    = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));
    $patterns = [];

    // Pattern 1: specific device model + iOS version failing on a server
    try {
        $stmt = $pdo->prepare(
            "SELECT device_model, ios_version, server_label,
                    COUNT(*) AS total,
                    SUM(conclusion_code != 'tunnel_ok' AND conclusion_code IS NOT NULL) AS failures,
                    MAX(created_at) AS last_seen
               FROM diagnostic_sessions
              WHERE device_model IS NOT NULL AND ios_version IS NOT NULL
                AND created_at >= ?
              GROUP BY device_model, ios_version, server_label
             HAVING total >= 2 AND failures >= 2
              ORDER BY failures DESC LIMIT 10"
        );
        $stmt->execute([$since]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $total    = (int)$r['total'];
            $failures = (int)$r['failures'];
            $rate     = $total > 0 ? (int)round($failures / $total * 100) : 0;
            if ($rate >= 60) {
                $patterns[] = [
                    'type'    => 'device_ios_server',
                    'severity'=> $rate >= 90 ? 'critical' : 'warn',
                    'message' => "{$r['device_model']} on iOS {$r['ios_version']} fails {$rate}% on {$r['server_label']} ({$failures}/{$total} sessions)",
                    'detail'  => "Last seen: {$r['last_seen']}",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // Pattern 2: build + network type correlation
    try {
        $stmt = $pdo->prepare(
            "SELECT build_number, network_type, server_label,
                    COUNT(*) AS total,
                    SUM(conclusion_code != 'tunnel_ok' AND conclusion_code IS NOT NULL) AS failures
               FROM diagnostic_sessions
              WHERE build_number IS NOT NULL AND network_type IS NOT NULL
                AND created_at >= ?
              GROUP BY build_number, network_type, server_label
             HAVING total >= 2 AND failures >= 2
              ORDER BY failures DESC LIMIT 10"
        );
        $stmt->execute([$since]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $total    = (int)$r['total'];
            $failures = (int)$r['failures'];
            $rate     = $total > 0 ? (int)round($failures / $total * 100) : 0;
            if ($rate >= 70) {
                $net = $r['network_type'] === 'wifi' ? 'WiFi' : 'Cellular';
                $patterns[] = [
                    'type'    => 'build_network',
                    'severity'=> 'warn',
                    'message' => "Build #{$r['build_number']} fails {$rate}% on {$net} → {$r['server_label']} ({$failures}/{$total} sessions)",
                    'detail'  => "Possible carrier or network-path–specific blocking",
                ];
            }
        }
    } catch (\Throwable $_) {}

    // Pattern 3: carrier-specific failures
    try {
        $stmt = $pdo->prepare(
            "SELECT carrier, server_label,
                    COUNT(*) AS total,
                    SUM(conclusion_code != 'tunnel_ok' AND conclusion_code IS NOT NULL) AS failures
               FROM diagnostic_sessions
              WHERE carrier IS NOT NULL AND carrier != ''
                AND created_at >= ?
              GROUP BY carrier, server_label
             HAVING total >= 2 AND failures >= 2
              ORDER BY failures DESC LIMIT 10"
        );
        $stmt->execute([$since]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $total    = (int)$r['total'];
            $failures = (int)$r['failures'];
            $rate     = $total > 0 ? (int)round($failures / $total * 100) : 0;
            if ($rate >= 70) {
                $patterns[] = [
                    'type'    => 'carrier_block',
                    'severity'=> 'critical',
                    'message' => "{$r['carrier']} fails {$rate}% on {$r['server_label']} ({$failures}/{$total} sessions) — possible carrier-level block",
                    'detail'  => "Check if {$r['server_label']} VPS is reachable from {$r['carrier']} network",
                ];
            }
        }
    } catch (\Throwable $_) {}

    return $patterns;
}

/**
 * Full AI diagnosis dataset: recent enriched sessions + pattern alerts.
 */
function ni_ai_diagnosis(PDO $pdo, int $limit = 20, int $days = 14): array
{
    ni_init_diag_sessions($pdo);
    $since = gmdate('Y-m-d H:i:s', strtotime("-{$days} days"));

    $stmt = $pdo->prepare(
        "SELECT * FROM diagnostic_sessions WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?"
    );
    $stmt->execute([$since, min(100, max(1, $limit))]);
    $sessions = array_map('ni_enrich_session', $stmt->fetchAll(PDO::FETCH_ASSOC));

    return [
        'sessions' => $sessions,
        'patterns' => ni_diag_patterns($pdo, $days),
        'summary'  => [
            'total'      => count($sessions),
            'tunnel_ok'  => count(array_filter($sessions, fn($s) => $s['conclusion_code'] === 'tunnel_ok')),
            'cp1_fail'   => count(array_filter($sessions, fn($s) => $s['conclusion_code'] === 'cp1_fail')),
            'cp4_fail'   => count(array_filter($sessions, fn($s) => $s['conclusion_code'] === 'cp4_fail')),
        ],
    ];
}
