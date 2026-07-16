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

    // Phase 2: self-registration. A one-time, time-limited enrollment token
    // an admin hands to a NEW gateway device out of band (e.g. pasted into
    // its provisioning script at setup time) — separate from the permanent
    // per-node heartbeat token, and single-use. See st_create_enrollment_token()
    // / st_redeem_enrollment_token(). SQLite has no portable "ADD COLUMN IF
    // NOT EXISTS" — new columns on the already-existing starlink_nodes table
    // go through the same try/exec/catch pattern already used elsewhere in
    // this codebase (see lib/ads_recovery.php:ar_init_tables()), not a new
    // migration mechanism.
    $pdo->exec("CREATE TABLE IF NOT EXISTS starlink_enrollment_tokens (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        token_sha256     TEXT NOT NULL UNIQUE,
        display_name     TEXT NOT NULL DEFAULT '',
        country          TEXT NOT NULL DEFAULT 'Norway',
        created_by       TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at       TEXT NOT NULL,
        consumed_at      TEXT DEFAULT NULL,
        consumed_node_id TEXT DEFAULT NULL
    )");
    foreach ([
        "ALTER TABLE starlink_nodes ADD COLUMN wg_public_key    TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE starlink_nodes ADD COLUMN enrolled_via     TEXT NOT NULL DEFAULT 'manual'", // 'manual' | 'self-enroll'
        "ALTER TABLE starlink_nodes ADD COLUMN enrolled_platform TEXT NOT NULL DEFAULT ''",       // windows | macos | linux, self-enroll only
    ] as $m) { try { $pdo->exec($m); } catch (\Exception $e) {} }

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
    // max_sessions <= 0 means NO capacity (admin throttled to zero), not
    // unlimited — `starlink-update-node` allows setting it to 0 explicitly
    // (max(0, ...)), and the old `$max <= 0 || ...` read that as "no cap."
    return $max > 0 && $cur < $max;
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

// ── Phase 2: self-registration ──────────────────────────────────────────────
//
// Manual provisioning (Phase 1, unchanged) stays available: an admin can
// still seed/edit a node row directly and hand out a heartbeat token via
// starlink-generate-token. Self-enrollment is an ADDITIONAL path, not a
// replacement — a brand-new gateway device with no node_id yet can enroll
// itself given a one-time token, instead of an admin hand-creating its row.

const STARLINK_ENROLLMENT_TTL_SECS = 24 * 3600; // unused enrollment token expires in 24h

/** Admin action: mint a one-time enrollment token for a new gateway device.
 *  Returned in plaintext ONCE — only its SHA-256 is persisted. Unlike the
 *  heartbeat token this is intentionally a fast hash, not password_hash():
 *  the token has 192 bits of its own entropy (bin2hex(random_bytes(24)),
 *  same generation as the heartbeat secret) so it doesn't need slow hashing
 *  to resist brute force, and a fast hash is what makes direct-lookup-by-
 *  value (WHERE token_sha256 = ?) possible without scanning every row. */
function st_create_enrollment_token(PDO $pdo, string $actor, string $displayName = '', string $country = 'Norway'): string {
    $token = bin2hex(random_bytes(24));
    $hash  = hash('sha256', $token);
    $expiresAt = gmdate('Y-m-d H:i:s', time() + STARLINK_ENROLLMENT_TTL_SECS);
    $pdo->prepare("INSERT INTO starlink_enrollment_tokens
        (token_sha256, display_name, country, created_by, expires_at)
        VALUES (?, ?, ?, ?, ?)")
        ->execute([$hash, $displayName, $country, $actor, $expiresAt]);
    st_log($pdo, '(new)', $actor, 'create-enrollment-token', $displayName !== '' ? $displayName : '(unnamed)');
    return $token;
}

/** Redeem a one-time enrollment token: create the node row (auto-assigned
 *  node_id), capture the gateway's WireGuard public key + platform, issue
 *  its permanent heartbeat token, and burn the enrollment token so it can
 *  never be reused. Returns null on any invalid/expired/already-used token
 *  — deliberately no distinction in the error (avoid leaking which case it
 *  was to an unauthenticated caller). New nodes are disabled/testing by
 *  default, exactly like the Phase 1 manual seed — self-enrollment gets a
 *  node INTO the catalog, it does not make it live; an admin still has to
 *  flip `enabled`. Does NOT touch the live WireGuard interface — the
 *  gateway's public key is stored for an admin to review and apply via
 *  `wg set` (or a future dedicated action), not auto-applied from this web
 *  request. Mutating the host's live network config from an unprivileged
 *  PHP process is a materially different risk than a DB write, and this
 *  repo's own Rule 7 already requires a human sign-off for exactly that
 *  kind of change — enrollment automates identity/credentials, not the
 *  network layer itself. */
function st_redeem_enrollment_token(PDO $pdo, string $token, array $gatewayInfo = []): ?array {
    if ($token === '') return null;
    $hash = hash('sha256', $token);
    $st = $pdo->prepare("SELECT * FROM starlink_enrollment_tokens WHERE token_sha256 = ?");
    $st->execute([$hash]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) return null;
    if ($row['consumed_at'] !== null) return null;
    if (strtotime((string)$row['expires_at']) < time()) return null;

    // Auto-assign the next free starlink-no-NN id — sequential, not random,
    // so the admin node list stays human-scannable (same convention as the
    // Phase 1 seed 'starlink-no-01'). Loop guards against a gap left by a
    // deleted node reusing an id out of order.
    $n = 1;
    do {
        $nodeId = sprintf('starlink-no-%02d', $n);
        $exists = $pdo->prepare("SELECT 1 FROM starlink_nodes WHERE node_id = ?");
        $exists->execute([$nodeId]);
        $taken = (bool)$exists->fetchColumn();
        $n++;
    } while ($taken);

    $displayName = $row['display_name'] !== '' ? $row['display_name'] : "Norway Starlink #{$nodeId}";
    $wgPublicKey = substr((string)($gatewayInfo['wg_public_key'] ?? ''), 0, 128);
    $platform    = substr((string)($gatewayInfo['platform']     ?? ''), 0, 64);

    $pdo->prepare("INSERT INTO starlink_nodes
        (node_id, display_name, country, node_type, role, enabled, testing_state,
         nominal_capacity_kbps, allocated_kbps, max_sessions, wg_public_key,
         enrolled_via, enrolled_platform)
        VALUES (?, ?, ?, 'STARLINK', 'EXIT_ONLY', 0, 'testing', 100000, 10000, 1, ?, 'self-enroll', ?)"
    )->execute([$nodeId, $displayName, $row['country'], $wgPublicKey, $platform]);

    $heartbeatSecret = st_generate_heartbeat_token($pdo, $nodeId);

    $pdo->prepare("UPDATE starlink_enrollment_tokens SET consumed_at = datetime('now'), consumed_node_id = ? WHERE id = ?")
        ->execute([$nodeId, $row['id']]);

    st_log($pdo, $nodeId, 'gateway-self-enroll', 'enroll',
        "platform={$platform}, via token created by {$row['created_by']}");

    return [
        'node_id'         => $nodeId,
        'heartbeat_token' => "starlink-node-{$nodeId}:{$heartbeatSecret}",
    ];
}

/** Admin visibility: pending (unconsumed, unexpired) enrollment tokens.
 *  Never returns the raw token — that's a Phase-2-launch-time secret shown
 *  once to the admin, not something re-readable afterward. */
function st_list_pending_enrollments(PDO $pdo): array {
    $rows = $pdo->query("SELECT id, display_name, country, created_by, created_at, expires_at
                          FROM starlink_enrollment_tokens
                          WHERE consumed_at IS NULL
                          ORDER BY created_at DESC")->fetchAll(PDO::FETCH_ASSOC);
    $now = time();
    foreach ($rows as &$r) { $r['expired'] = strtotime((string)$r['expires_at']) < $now; }
    unset($r);
    return $rows;
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

/** The safe subset of a node's admin-controlled config, handed back to the
 *  gateway on every heartbeat response so admin changes (enable/disable,
 *  maintenance, session/bandwidth limits) propagate without a gateway
 *  redeploy — closing the loop the push-heartbeat model would otherwise
 *  leave one-directional. Never includes heartbeat_token_hash or anything
 *  else secret. The VPS remains the actual enforcement point (st_routable()
 *  gates new sessions server-side) — this is visibility/future-use for the
 *  gateway, not a second place that decides routing. */
function st_gateway_config(array $node): array {
    return [
        'enabled'          => (int)($node['enabled'] ?? 0) === 1,
        'maintenance_mode' => (int)($node['maintenance_mode'] ?? 0) === 1,
        'testing_state'    => (string)($node['testing_state'] ?? 'testing'),
        'max_sessions'     => (int)($node['max_sessions'] ?? 0),
        'allocated_kbps'   => (int)($node['allocated_kbps'] ?? 0),
    ];
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
