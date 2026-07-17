<?php
/**
 * ReaLink Node Console (Phase 1) -- generic, node-type-agnostic command
 * queue for remotely operating VPN gateway nodes without SSH/RDP/PowerShell
 * exposure. Rides the EXISTING heartbeat channel (see
 * public/starlink-heartbeat.php, lib/starlink.php:st_gateway_config()) --
 * the node already polls the server every ~30s and gets admin-controlled
 * config back; this adds a `commands` array to that same response.
 *
 * Deliberately generic from day one: nothing here is Starlink-specific.
 * NC_COMMAND_REGISTRY is keyed by command, not node type, and each entry
 * lists which node_types it applies to -- adding Desktop/Raspberry Pi
 * support later means adding a node-type-specific EXECUTOR script
 * (deploy/starlink/gateway/... equivalent for that platform) that speaks
 * the same wire protocol, not touching this file's schema or API shape.
 *
 * Security model (Phase 1 scope -- see docs/NODE_CONSOLE_ARCHITECTURE.md):
 *   - No arbitrary shell, ever. command_key must be a registry entry;
 *     unknown keys are rejected server-side AND the node-side executor is
 *     itself an allowlist switch, never an exec-a-string-from-the-server
 *     path -- two independent enforcement points, not one.
 *   - Commands are HMAC-signed with a short-lived expiry. The node verifies
 *     the signature before executing anything (see nc_verify_token()).
 *   - Dangerous commands (reboot/shutdown/factory-reset -- NOT implemented
 *     in Phase 1, registry has none yet) require 'confirm' => 'double' and
 *     the admin API enforces a second explicit confirmation flag.
 *   - RBAC is NOT implemented here -- see the architecture doc's honest
 *     "not built yet" section. Phase 1 trust boundary is the existing
 *     single-tier admin-panel session (admin/api.php's $auth_user), same as
 *     every other admin action in this codebase today.
 */

declare(strict_types=1);

/** Registry of safe, predefined commands. Node-type-agnostic on purpose --
 *  see file header. Phase 1 ships only the low-risk subset; everything
 *  requiring 'confirm' => 'double' is deliberately NOT in this list yet
 *  (reboot/shutdown/update/factory-reset are future-phase work, gated on
 *  the signing+audit path being proven on these first). */
const NC_COMMAND_REGISTRY = [
    'wg_status'         => ['label' => 'WireGuard Status',  'node_types' => ['starlink', 'desktop', 'pi'], 'confirm' => 'none',   'dangerous' => false],
    'network_status'    => ['label' => 'Network Status',    'node_types' => ['starlink', 'desktop', 'pi'], 'confirm' => 'none',   'dangerous' => false],
    'last_100_logs'     => ['label' => 'Last 100 Logs',     'node_types' => ['starlink', 'desktop', 'pi'], 'confirm' => 'none',   'dangerous' => false],
    'refresh_telemetry' => ['label' => 'Refresh Telemetry', 'node_types' => ['starlink', 'desktop', 'pi'], 'confirm' => 'none',   'dangerous' => false],
    'restart_wireguard' => ['label' => 'Restart WireGuard', 'node_types' => ['starlink', 'desktop', 'pi'], 'confirm' => 'single', 'dangerous' => false],
];

const NC_COMMAND_TTL_SECS = 300; // command tokens expire 5 min after enqueue if never picked up/executed

function nc_init_tables(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS node_commands (
        command_id       TEXT PRIMARY KEY,
        node_id          TEXT    NOT NULL,
        command_key      TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'pending',
        requested_by     TEXT    DEFAULT NULL,
        token_signature  TEXT    NOT NULL,
        token_expires_at TEXT    NOT NULL,
        enqueued_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        picked_up_at     TEXT    DEFAULT NULL,
        completed_at     TEXT    DEFAULT NULL,
        duration_ms      INTEGER DEFAULT NULL,
        exit_code        INTEGER DEFAULT NULL,
        output           TEXT    DEFAULT NULL
    )");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS nc_node_status ON node_commands(node_id, status)");

    // Every execution -- admin-commanded OR watchdog self-heal -- lands
    // here. This is the table the Network Genome / Telemetry Trust Engine
    // reads from (see lib/node_intel.php's ni_rebuild_genome()). Node-level,
    // not device-level -- no privacy-model overlap with connect_telemetry.
    $pdo->exec("CREATE TABLE IF NOT EXISTS node_command_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id         TEXT    NOT NULL,
        command_key     TEXT    NOT NULL,
        success         INTEGER NOT NULL,
        duration_ms     INTEGER DEFAULT NULL,
        recovery_action TEXT    DEFAULT NULL,
        health_before   TEXT    DEFAULT NULL,
        health_after    TEXT    DEFAULT NULL,
        automatic       INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    )");
    @$pdo->exec("CREATE INDEX IF NOT EXISTS nce_node_created ON node_command_events(node_id, created_at)");
}

/** Separate secret from admin/api.php's CSRF secret on purpose -- a leaked
 *  command-signing key should not also compromise admin session CSRF, and
 *  vice versa (same "different key from X" principle as elsewhere in this
 *  repo's coordination docs). */
function nc_command_secret(): string
{
    $path = '/etc/setalink/admin/node-command.secret';
    if (is_readable($path)) {
        $s = trim((string)file_get_contents($path));
        if ($s !== '') return $s;
    }
    return hash('sha256', 'setalink-node-command:' . gethostname() . ':' . __DIR__);
}

function nc_command_allowed(string $commandKey, string $nodeType): bool
{
    $entry = NC_COMMAND_REGISTRY[$commandKey] ?? null;
    return $entry !== null && in_array($nodeType, $entry['node_types'], true);
}

function nc_sign_token(string $commandId, string $nodeId, string $commandKey, string $expiresAt): string
{
    return hash_hmac('sha256', "{$commandId}|{$nodeId}|{$commandKey}|{$expiresAt}", nc_command_secret());
}

function nc_verify_token(string $commandId, string $nodeId, string $commandKey, string $expiresAt, string $token): bool
{
    if (strtotime($expiresAt) < time()) return false; // expired, independent of signature validity
    return hash_equals(nc_sign_token($commandId, $nodeId, $commandKey, $expiresAt), $token);
}

/**
 * Enqueue a command for a node. Caller (admin/api.php) is responsible for
 * the confirmation-flag check on 'confirm' => 'single'/'double' entries --
 * this function only enforces the allowlist (node_type + registry
 * membership), never a raw/unvalidated command_key.
 *
 * Returns null if the command_key/node_type combination isn't allowed.
 */
function nc_enqueue_command(PDO $pdo, string $nodeId, string $nodeType, string $commandKey, ?string $requestedBy = null): ?array
{
    nc_init_tables($pdo);
    if (!nc_command_allowed($commandKey, $nodeType)) return null;

    $commandId = bin2hex(random_bytes(12));
    $expiresAt = gmdate('Y-m-d H:i:s', time() + NC_COMMAND_TTL_SECS);
    $token = nc_sign_token($commandId, $nodeId, $commandKey, $expiresAt);

    $pdo->prepare(
        "INSERT INTO node_commands (command_id, node_id, command_key, requested_by, token_signature, token_expires_at)
         VALUES (?,?,?,?,?,?)"
    )->execute([$commandId, $nodeId, $commandKey, $requestedBy, $token, $expiresAt]);

    return [
        'command_id' => $commandId, 'node_id' => $nodeId, 'command_key' => $commandKey,
        'token' => $token, 'expires_at' => $expiresAt,
    ];
}

/**
 * Pending commands for a node, called from the heartbeat response builder.
 * Transitions each returned row pending -> running (best-effort, at-least-
 * once delivery -- acceptable for Phase 1's idempotent, read-mostly command
 * set; none of the shipped commands are unsafe to run twice).
 */
function nc_pending_commands_for_node(PDO $pdo, string $nodeId): array
{
    nc_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT command_id, command_key, token_signature, token_expires_at
           FROM node_commands WHERE node_id = ? AND status = 'pending' AND token_expires_at >= datetime('now')
          ORDER BY enqueued_at ASC LIMIT 5"
    );
    $st->execute([$nodeId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) return [];

    $ids = array_column($rows, 'command_id');
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $pdo->prepare("UPDATE node_commands SET status='running', picked_up_at=datetime('now') WHERE command_id IN ($ph)")
        ->execute($ids);

    return array_map(fn($r) => [
        'command_id'  => $r['command_id'],
        'command_key' => $r['command_key'],
        'token'       => $r['token_signature'],
        'expires_at'  => $r['token_expires_at'],
    ], $rows);
}

/** Also expires anything that's been 'running' too long without a report
 *  back (node went offline mid-command) -- called opportunistically, same
 *  cheap-probabilistic-trigger pattern as ni_telemetry_rotate(). */
function nc_expire_stale_commands(PDO $pdo): void
{
    try {
        if (random_int(1, 20) !== 1) return;
        $pdo->exec(
            "UPDATE node_commands SET status='timed_out', completed_at=datetime('now')
              WHERE status IN ('pending','running') AND token_expires_at < datetime('now')"
        );
    } catch (\Throwable $e) {}
}

/**
 * Node reports a result for an admin-enqueued command. Verifies the
 * signature+expiry+node match before accepting anything -- a node cannot
 * report a result for a command_id it wasn't actually issued (prevents a
 * compromised/spoofed node from injecting fake success into the audit log
 * or the Genome).
 */
function nc_report_command_result(
    PDO $pdo, string $nodeId, string $commandId, string $token,
    bool $success, ?int $exitCode, string $output, ?int $durationMs,
    ?string $healthBefore = null, ?string $healthAfter = null
): bool {
    nc_init_tables($pdo);
    $st = $pdo->prepare("SELECT command_key, token_signature, token_expires_at FROM node_commands WHERE command_id = ? AND node_id = ?");
    $st->execute([$commandId, $nodeId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) return false;
    if (!nc_verify_token($commandId, $nodeId, $row['command_key'], $row['token_expires_at'], $token)) return false;
    if (!hash_equals($row['token_signature'], $token)) return false; // redundant with nc_verify_token, defense in depth

    $pdo->prepare(
        "UPDATE node_commands SET status=?, completed_at=datetime('now'), duration_ms=?, exit_code=?, output=?
          WHERE command_id = ?"
    )->execute([$success ? 'completed' : 'failed', $durationMs, $exitCode, substr($output, 0, 8000), $commandId]);

    nc_record_command_event($pdo, $nodeId, $row['command_key'], $success, $durationMs, null, $healthBefore, $healthAfter, false);
    return true;
}

/**
 * Watchdog self-heal report -- no command_id/token involved (nothing was
 * server-enqueued; the node decided on its own to repair something). Only
 * needs valid per-node heartbeat auth (checked by the caller,
 * public/starlink-command-result.php, same as it already does for
 * heartbeat.php). This is the "Watchdog Integration" the architecture
 * calls for: what failed, how repaired, duration, success -- straight into
 * node_command_events, same table adaptive routing's Genome reads.
 */
function nc_report_self_heal(
    PDO $pdo, string $nodeId, string $recoveryAction, bool $success,
    ?int $durationMs, ?string $healthBefore = null, ?string $healthAfter = null
): void {
    nc_init_tables($pdo);
    nc_record_command_event($pdo, $nodeId, $recoveryAction, $success, $durationMs, $recoveryAction, $healthBefore, $healthAfter, true);
}

function nc_record_command_event(
    PDO $pdo, string $nodeId, string $commandKey, bool $success, ?int $durationMs,
    ?string $recoveryAction, ?string $healthBefore, ?string $healthAfter, bool $automatic
): void {
    $pdo->prepare(
        "INSERT INTO node_command_events
            (node_id, command_key, success, duration_ms, recovery_action, health_before, health_after, automatic)
         VALUES (?,?,?,?,?,?,?,?)"
    )->execute([$nodeId, $commandKey, (int)$success, $durationMs, $recoveryAction, $healthBefore, $healthAfter, (int)$automatic]);
}

/** Recent command-queue rows for the admin Node Card / audit view. */
function nc_recent_commands(PDO $pdo, ?string $nodeId = null, int $limit = 50): array
{
    nc_init_tables($pdo);
    if ($nodeId !== null) {
        $st = $pdo->prepare("SELECT * FROM node_commands WHERE node_id = ? ORDER BY enqueued_at DESC LIMIT ?");
        $st->bindValue(1, $nodeId);
        $st->bindValue(2, $limit, PDO::PARAM_INT);
    } else {
        $st = $pdo->prepare("SELECT * FROM node_commands ORDER BY enqueued_at DESC LIMIT ?");
        $st->bindValue(1, $limit, PDO::PARAM_INT);
    }
    $st->execute();
    return $st->fetchAll(PDO::FETCH_ASSOC);
}

/** Recent node_command_events -- the Genome/Trust-facing audit trail,
 *  including watchdog self-heals (automatic=1). */
function nc_recent_events(PDO $pdo, ?string $nodeId = null, int $limit = 100): array
{
    nc_init_tables($pdo);
    if ($nodeId !== null) {
        $st = $pdo->prepare("SELECT * FROM node_command_events WHERE node_id = ? ORDER BY created_at DESC LIMIT ?");
        $st->bindValue(1, $nodeId);
        $st->bindValue(2, $limit, PDO::PARAM_INT);
    } else {
        $st = $pdo->prepare("SELECT * FROM node_command_events ORDER BY created_at DESC LIMIT ?");
        $st->bindValue(1, $limit, PDO::PARAM_INT);
    }
    $st->execute();
    return $st->fetchAll(PDO::FETCH_ASSOC);
}
