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
function ni_record(PDO $pdo, array $d): void
{
    ni_init_tables($pdo);
    $pdo->prepare(
        "INSERT INTO connect_telemetry
            (event,node_id,profile_id,sni,protocol,platform,app_version,build_number,
             network_type,isp_hash,carrier_hash,country,failure_stage,latency_ms,
             internet_ok,exit_ip_ok)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
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
        ($d['latency_ms'] !== null && $d['latency_ms'] !== '') ? max(0, (int)$d['latency_ms']) : null,
        isset($d['internet_ok']) ? (int)(bool)$d['internet_ok'] : null,
        isset($d['exit_ip_ok'])  ? (int)(bool)$d['exit_ip_ok']  : null,
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
