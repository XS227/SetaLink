<?php
/**
 * Starlink exit-node registry, health policy, and heartbeat ingestion.
 *
 * "Starlink" is a node TYPE (STARLINK), distinct from the direct-egress VPS
 * nodes (primary, fi-hel): a Starlink node never terminates a client's Reality
 * connection itself. The client always dials an existing VPS node; a
 * server-side Xray routing rule (keyed to a dedicated per-node VLESS UUID)
 * decides whether that session's egress goes over a WireGuard tunnel to the
 * Starlink gateway instead of the VPS's normal direct outbound. See
 * docs/STARLINK_NODE_ARCHITECTURE.md for the full design.
 *
 * Device gating reuses the existing node_allowlist/node_usage tables
 * (public/v1.php) — a Starlink node is just another node_id there. This file
 * only owns the Starlink-specific telemetry/config table and health policy.
 */

declare(strict_types=1);

const STARLINK_HEARTBEAT_FRESH_SECS   = 90;    // no heartbeat within this window => OFFLINE
const STARLINK_DEGRADED_LOSS_PCT      = 2.0;   // packet loss >= this => DEGRADED
const STARLINK_DEGRADED_LATENCY_MS    = 250;   // latency >= this => DEGRADED
const STARLINK_DEGRADED_DISCONNECTS   = 3;     // recent disconnects >= this => DEGRADED

function st_init_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS starlink_nodes (
        node_id               TEXT PRIMARY KEY,
        display_name          TEXT NOT NULL,
        country               TEXT NOT NULL DEFAULT 'Norway',
        node_type             TEXT NOT NULL DEFAULT 'STARLINK',
        role                  TEXT NOT NULL DEFAULT 'EXIT_ONLY',
        enabled               INTEGER NOT NULL DEFAULT 0,
        testing_state         TEXT NOT NULL DEFAULT 'testing',   -- testing | live
        maintenance_mode      INTEGER NOT NULL DEFAULT 0,
        vless_uuid            TEXT NOT NULL DEFAULT '',          -- dedicated UUID routed to this node's exit
        heartbeat_token_hash  TEXT NOT NULL DEFAULT '',          -- password_hash() of the gateway's bearer secret
        tunnel_status         TEXT NOT NULL DEFAULT 'down',      -- up | down
        last_heartbeat_at     TEXT DEFAULT NULL,
        public_ipv4           TEXT DEFAULT NULL,
        public_ipv6           TEXT DEFAULT NULL,
        exit_ip               TEXT DEFAULT NULL,
        latency_ms            INTEGER DEFAULT NULL,
        packet_loss_pct       REAL DEFAULT NULL,
        recent_disconnects    INTEGER NOT NULL DEFAULT 0,
        measured_download_kbps INTEGER DEFAULT NULL,
        measured_upload_kbps   INTEGER DEFAULT NULL,
        nominal_capacity_kbps  INTEGER NOT NULL DEFAULT 100000,  -- 100 Mbps nominal link
        allocated_kbps         INTEGER NOT NULL DEFAULT 10000,   -- 10 Mbps conservative PoC allocation (raise via admin panel after stability testing)
        current_usage_kbps     INTEGER DEFAULT NULL,
        current_sessions       INTEGER NOT NULL DEFAULT 0,
        max_sessions            INTEGER NOT NULL DEFAULT 1,
        uptime_secs             INTEGER DEFAULT NULL,
        software_version        TEXT DEFAULT NULL,
        last_error              TEXT DEFAULT NULL,
        created_at              TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS starlink_admin_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id    TEXT NOT NULL,
        actor      TEXT NOT NULL DEFAULT '',
        action     TEXT NOT NULL,
        detail     TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )");

    // Seed the Phase 1 test node if it doesn't exist yet. Disabled/testing by
    // default — an admin must explicitly enable it (task requirement).
    // Conservative PoC limits (1 session / 10 Mbps) per the Windows-gateway
    // test plan in docs/STARLINK_WINDOWS_GATEWAY.md — raise to 3/20000 via
    // the existing starlink-update-node admin action only after stability
    // testing passes, not by editing this seed.
    $exists = $pdo->query("SELECT 1 FROM starlink_nodes WHERE node_id = 'starlink-no-01'")->fetchColumn();
    if (!$exists) {
        $pdo->prepare("INSERT INTO starlink_nodes
            (node_id, display_name, country, node_type, role, enabled, testing_state,
             nominal_capacity_kbps, allocated_kbps, max_sessions)
            VALUES (?, ?, 'Norway', 'STARLINK', 'EXIT_ONLY', 0, 'testing', 100000, 10000, 1)"
        )->execute(['starlink-no-01', 'Norway Starlink #01']);
    }
}

function st_log(PDO $pdo, string $nodeId, string $actor, string $action, string $detail = ''): void {
    $pdo->prepare("INSERT INTO starlink_admin_log (node_id, actor, action, detail) VALUES (?,?,?,?)")
        ->execute([$nodeId, $actor, $action, $detail]);
}

function st_get(PDO $pdo, string $nodeId): ?array {
    $st = $pdo->prepare("SELECT * FROM starlink_nodes WHERE node_id = ?");
    $st->execute([$nodeId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function st_all(PDO $pdo): array {
    return $pdo->query("SELECT * FROM starlink_nodes ORDER BY node_id")->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * Health state per docs/STARLINK_NODE_ARCHITECTURE.md §5:
 *   MAINTENANCE > OFFLINE > DEGRADED > ONLINE
 */
function st_health_state(array $node): string {
    if ((int)($node['maintenance_mode'] ?? 0) === 1) return 'MAINTENANCE';

    $lastHb = $node['last_heartbeat_at'] ?? null;
    $ageSecs = $lastHb ? (time() - strtotime($lastHb)) : null;
    $tunnelUp = ($node['tunnel_status'] ?? 'down') === 'up';

    if ($ageSecs === null || $ageSecs > STARLINK_HEARTBEAT_FRESH_SECS || !$tunnelUp) {
        return 'OFFLINE';
    }

    $loss = $node['packet_loss_pct'] !== null ? (float)$node['packet_loss_pct'] : 0.0;
    $lat  = $node['latency_ms'] !== null ? (int)$node['latency_ms'] : 0;
    $disc = (int)($node['recent_disconnects'] ?? 0);

    if ($loss >= STARLINK_DEGRADED_LOSS_PCT
        || $lat >= STARLINK_DEGRADED_LATENCY_MS
        || $disc >= STARLINK_DEGRADED_DISCONNECTS) {
        return 'DEGRADED';
    }

    return 'ONLINE';
}

/** Whether new sessions may be routed to this node right now. */
function st_routable(array $node): bool {
    if ((int)($node['enabled'] ?? 0) !== 1) return false;
    if (st_health_state($node) !== 'ONLINE') return false;
    $cur = (int)($node['current_sessions'] ?? 0);
    $max = (int)($node['max_sessions'] ?? 0);
    return $max <= 0 || $cur < $max;
}

/** Generate a new heartbeat secret for a node. Returns the PLAINTEXT secret
 *  (show it once to the admin) — only the hash is stored. */
function st_generate_heartbeat_token(PDO $pdo, string $nodeId): string {
    $secret = bin2hex(random_bytes(24));
    $hash   = password_hash($secret, PASSWORD_DEFAULT);
    $pdo->prepare("UPDATE starlink_nodes SET heartbeat_token_hash = ?, updated_at = datetime('now') WHERE node_id = ?")
        ->execute([$hash, $nodeId]);
    return $secret;
}

function st_verify_heartbeat_token(array $node, string $secret): bool {
    $hash = (string)($node['heartbeat_token_hash'] ?? '');
    if ($hash === '' || $secret === '') return false;
    return password_verify($secret, $hash);
}

/** Apply a heartbeat payload from the Starlink gateway. Only whitelisted
 *  numeric/string fields are accepted; unknown fields are ignored. */
function st_apply_heartbeat(PDO $pdo, string $nodeId, array $payload): void {
    $fields = [
        'tunnel_status'          => 'string',
        'public_ipv4'            => 'string',
        'public_ipv6'            => 'string',
        'exit_ip'                => 'string',
        'latency_ms'             => 'int',
        'packet_loss_pct'        => 'float',
        'recent_disconnects'     => 'int',
        'measured_download_kbps' => 'int',
        'measured_upload_kbps'   => 'int',
        'current_usage_kbps'     => 'int',
        'current_sessions'       => 'int',
        'uptime_secs'            => 'int',
        'software_version'       => 'string',
        'last_error'             => 'string',
    ];
    $set = ["last_heartbeat_at = datetime('now')", "updated_at = datetime('now')"];
    $args = [];
    foreach ($fields as $key => $type) {
        if (!array_key_exists($key, $payload)) continue;
        $val = $payload[$key];
        if ($type === 'int')   $val = $val === null ? null : (int)$val;
        if ($type === 'float') $val = $val === null ? null : (float)$val;
        if ($type === 'string') $val = $val === null ? null : substr((string)$val, 0, 512);
        $set[] = "$key = ?";
        $args[] = $val;
    }
    if (empty($args)) { $args = []; }
    $args[] = $nodeId;
    $pdo->prepare("UPDATE starlink_nodes SET " . implode(', ', $set) . " WHERE node_id = ?")
        ->execute($args);
}

/** Build the client-facing ServerRecord meta (no secrets) for a Starlink node,
 *  or null if it shouldn't be shown to this device at all. */
function st_meta(array $node): array {
    return [
        'id'       => $node['node_id'],
        'country'  => $node['country'],
        'city'     => 'Starlink · Beta',
        'flag'     => '🛰️',
        'ping'     => (int)($node['latency_ms'] ?? 0),
        'load'     => 0,
        'protocol' => 'Reality',
        'transport'=> 'reality',
        'tags'     => ['Beta', 'Starlink'],
        'premium'  => false,
        'nodeType' => 'STARLINK',
        'beta'     => true,
    ];
}
