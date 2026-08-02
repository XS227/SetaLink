<?php
/**
 * ReaLink VPS Helper — shared backend library.
 *
 * Case 2 of the routing problem (see vps-helper/README.md): tools running ON a
 * user's own VPS (e.g. Claude Code / Anthropic) cannot be fixed by phone-side
 * per-app bypass. This library backs the thin wrapper that provisions a
 * dedicated, revocable node identity per device and returns ONE install
 * command — the end user never touches a UUID, profile or provision.sh.
 *
 * SECURITY MODEL
 *   * This library (called from www-data via the web tier) NEVER touches node
 *     SSH keys. It only enqueues intent in analytics.db. A separate cron worker
 *     running as an unprivileged operator user (with the node key) performs the
 *     actual provisioning via vps-helper/provision.sh. Web tier ⇢ queue ⇢ worker.
 *   * The node's shared/reusable credentials (privateKey, bootstrap UUID) are
 *     never read or exposed here. Only per-device 'vpsh-<label>' identities.
 *   * Additive only: its own tables, its own endpoint files. The mobile bootstrap
 *     / Smart Mode / per-app bypass code paths are untouched.
 */
declare(strict_types=1);

const VH_ENGINE_DIR   = '/opt/realink/vps-helper';   // provision.sh + nodes.env (OFF webroot)
const VH_DEVICE_RE    = '/^[A-Za-z0-9._:-]{6,128}$/';
// Abuse limits (per UTC day).
const VH_MAX_PER_DEVICE_DAY = 8;
const VH_MAX_PER_IP_DAY     = 20;
const VH_MAX_GLOBAL_DAY     = 200;
const VH_MAX_ACTIVE_GLOBAL  = 500;                   // hard ceiling on live helpers

function vh_init(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS vps_helpers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id      TEXT NOT NULL UNIQUE,
        label          TEXT NOT NULL,
        node           TEXT    DEFAULT '',
        exit_ip        TEXT    DEFAULT '',
        email          TEXT    DEFAULT '',
        status         TEXT    NOT NULL DEFAULT 'pending',
        install_oneliner TEXT  DEFAULT '',
        error          TEXT    DEFAULT '',
        actor          TEXT    DEFAULT '',
        request_ip     TEXT    DEFAULT '',
        created_at     INTEGER DEFAULT 0,
        updated_at     INTEGER DEFAULT 0,
        provisioned_at INTEGER DEFAULT 0,
        revoked_at     INTEGER DEFAULT 0
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS vps_helper_audit (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        INTEGER,
        event     TEXT,
        device_id TEXT,
        node      TEXT,
        email     TEXT,
        actor     TEXT,
        ip        TEXT,
        detail    TEXT
    )");
    $db->exec("CREATE TABLE IF NOT EXISTS vps_helper_ratelimit (
        rl_key       TEXT PRIMARY KEY,
        window_start INTEGER,
        cnt          INTEGER
    )");
}

/** Deterministic, non-reversible per-device label → node email 'vpsh-<label>'.
 *  Stable so re-provisioning REPLACES the same node identity (no unbounded
 *  client growth) and never leaks the raw device id into the node config. */
function vh_label(string $deviceId): string {
    return substr(hash('sha256', 'realink-vpsh|' . $deviceId), 0, 12);
}

function vh_audit(PDO $db, string $event, string $deviceId, string $node,
                  string $email, string $actor, string $ip, string $detail = ''): void {
    $st = $db->prepare("INSERT INTO vps_helper_audit(ts,event,device_id,node,email,actor,ip,detail)
                        VALUES(?,?,?,?,?,?,?,?)");
    $st->execute([time(), $event, $deviceId, $node, $email, $actor, $ip, $detail]);
}

/** Sliding per-day counter. Returns true if still under the cap (and counts it). */
function vh_rate_ok(PDO $db, string $key, int $max): bool {
    $day = (int)floor(time() / 86400);
    $rl  = "$key:$day";
    $db->prepare("INSERT INTO vps_helper_ratelimit(rl_key,window_start,cnt) VALUES(?,?,0)
                  ON CONFLICT(rl_key) DO NOTHING")->execute([$rl, $day]);
    $cur = (int)$db->query("SELECT cnt FROM vps_helper_ratelimit WHERE rl_key=" . $db->quote($rl))->fetchColumn();
    if ($cur >= $max) return false;
    $db->prepare("UPDATE vps_helper_ratelimit SET cnt=cnt+1 WHERE rl_key=?")->execute([$rl]);
    return true;
}

function vh_get(PDO $db, string $deviceId): ?array {
    $st = $db->prepare("SELECT * FROM vps_helpers WHERE device_id=?");
    $st->execute([$deviceId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function vh_valid_device(string $deviceId): bool {
    return (bool)preg_match(VH_DEVICE_RE, $deviceId);
}

/**
 * Enqueue a provisioning request (idempotent per device). Returns [ok,row|error].
 * Rate-limited and abuse-guarded. Does NOT contact any node — the worker does.
 */
function vh_request_provision(PDO $db, string $deviceId, string $actor, string $ip): array {
    if (!vh_valid_device($deviceId)) return ['ok' => false, 'error' => 'invalid device_id'];
    if (!vh_rate_ok($db, "dev:$deviceId", VH_MAX_PER_DEVICE_DAY)) return ['ok' => false, 'error' => 'rate limit (device)'];
    if (!vh_rate_ok($db, "ip:$ip", VH_MAX_PER_IP_DAY))            return ['ok' => false, 'error' => 'rate limit (ip)'];
    if (!vh_rate_ok($db, "global", VH_MAX_GLOBAL_DAY))            return ['ok' => false, 'error' => 'service busy, try later'];

    $active = (int)$db->query("SELECT COUNT(*) FROM vps_helpers WHERE status IN('active','pending')")->fetchColumn();
    $existing = vh_get($db, $deviceId);
    if (!$existing && $active >= VH_MAX_ACTIVE_GLOBAL) return ['ok' => false, 'error' => 'capacity reached'];

    $label = vh_label($deviceId);
    $now   = time();
    if ($existing) {
        // re-provision: reset to pending, keep the same stable label/identity
        $db->prepare("UPDATE vps_helpers SET status='pending', error='', actor=?, request_ip=?,
                      updated_at=?, install_oneliner='' WHERE device_id=?")
           ->execute([$actor, $ip, $now, $deviceId]);
    } else {
        $db->prepare("INSERT INTO vps_helpers(device_id,label,status,actor,request_ip,created_at,updated_at)
                      VALUES(?,?,'pending',?,?,?,?)")
           ->execute([$deviceId, $label, $actor, $ip, $now, $now]);
    }
    vh_audit($db, 'provision-requested', $deviceId, '', "vpsh-$label", $actor, $ip);
    return ['ok' => true, 'row' => vh_get($db, $deviceId)];
}

/** Enqueue revoke (worker removes the node identity). Idempotent. */
function vh_request_revoke(PDO $db, string $deviceId, string $actor, string $ip): array {
    if (!vh_valid_device($deviceId)) return ['ok' => false, 'error' => 'invalid device_id'];
    $row = vh_get($db, $deviceId);
    if (!$row) return ['ok' => false, 'error' => 'no helper for this device'];
    if (in_array($row['status'], ['revoked', 'revoking'], true)) return ['ok' => true, 'row' => $row];
    $db->prepare("UPDATE vps_helpers SET status='revoking', updated_at=?, install_oneliner='' WHERE device_id=?")
       ->execute([time(), $deviceId]);
    vh_audit($db, 'revoke-requested', $deviceId, (string)$row['node'], (string)$row['email'], $actor, $ip);
    return ['ok' => true, 'row' => vh_get($db, $deviceId)];
}

/** Device-facing view: never leaks internal columns; oneliner only when active. */
function vh_public_view(?array $row): array {
    if (!$row) return ['status' => 'none'];
    $out = [
        'status'       => $row['status'],
        'node'         => $row['node'] ?: null,
        'exit_ip'      => $row['exit_ip'] ?: null,
        'created_at'   => (int)$row['created_at'],
        'updated_at'   => (int)$row['updated_at'],
    ];
    if ($row['status'] === 'active' && $row['install_oneliner']) {
        $out['install_command'] = $row['install_oneliner'];
    }
    if ($row['status'] === 'error' && $row['error']) {
        $out['error'] = 'provisioning failed, please retry';
    }
    return $out;
}
