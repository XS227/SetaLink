#!/usr/bin/env php
<?php
/**
 * ReaLink VPS Helper — provisioning WORKER.
 *
 * Runs as the OPERATOR user (holds the node SSH key), NOT as the web user.
 * Drains the vps_helpers queue written by the web tier:
 *   status=pending   → select a healthy node, provision.sh --json → active
 *   status=revoking  → provision.sh --revoke                       → revoked
 *
 * This is the ONLY component that touches node SSH. Idempotent, safe to run
 * from cron every minute. All outcomes are written to the audit log.
 *
 * Usage:  php vps-helper-worker.php [--once]   (cron uses no args)
 */
declare(strict_types=1);

const DB_PATH     = '/var/www/setalink/data/analytics.db';
const ENGINE_DIR  = '/opt/realink/vps-helper';
const LOCK_FILE   = '/tmp/realink-vps-helper-worker.lock';
const AUDIT_LOG   = '/var/log/realink/vps-helper-audit.log';
// Provisioning candidates in preference order. Finland works from Iran and is
// the only node with automated provisioning; Germany is x-ui (manual) + blocked
// from Iran, so it is intentionally NOT an automated candidate yet.
const NODE_CANDIDATES = ['finland'];

require_once '/var/www/setalink/lib/vps_helper.php';

function wlog(string $m): void {
    $line = date('c') . ' ' . $m . "\n";
    @file_put_contents(AUDIT_LOG, $line, FILE_APPEND);
    if (in_array('--verbose', $GLOBALS['argv'], true)) fwrite(STDERR, $line);
}

// single-instance lock
$lock = fopen(LOCK_FILE, 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { exit(0); }

$db = new PDO('sqlite:' . DB_PATH, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$db->exec("PRAGMA journal_mode=WAL");
$db->exec("PRAGMA busy_timeout=5000");
vh_init($db);

/** TCP reachability of a node's public :443 (fast health gate). */
function node_healthy(string $node): bool {
    $addr = trim((string)shell_exec(
        'bash -c ' . escapeshellarg('. ' . ENGINE_DIR . '/nodes.env; echo "${' . strtoupper($node) . '_ADDRESS:-}:${' . strtoupper($node) . '_PORT:-443}"')
    ));
    if ($addr === '' || $addr[0] === ':') return false;
    [$host, $port] = explode(':', $addr);
    $fp = @fsockopen($host, (int)$port, $errno, $errstr, 4);
    if ($fp) { fclose($fp); return true; }
    return false;
}

function select_node(): ?string {
    foreach (NODE_CANDIDATES as $n) if (node_healthy($n)) return $n;
    return null;
}

function run_engine(array $args): array {
    $cmd = 'cd ' . escapeshellarg(ENGINE_DIR) . ' && ./provision.sh';
    foreach ($args as $a) $cmd .= ' ' . escapeshellarg($a);
    $cmd .= ' 2>>' . escapeshellarg(AUDIT_LOG);
    $out = shell_exec($cmd);
    $j = json_decode(trim((string)$out), true);
    return is_array($j) ? $j : ['_error' => 'engine produced no JSON'];
}

// ── provision pending ────────────────────────────────────────────────────────
foreach ($db->query("SELECT * FROM vps_helpers WHERE status='pending' ORDER BY updated_at ASC")->fetchAll() as $row) {
    $device = $row['device_id']; $label = $row['label'];
    $node = select_node();
    if ($node === null) {
        $db->prepare("UPDATE vps_helpers SET error='no healthy node', updated_at=? WHERE device_id=?")
           ->execute([time(), $device]);
        vh_audit($db, 'provision-deferred', $device, '', "vpsh-$label", 'worker', '', 'no healthy node');
        wlog("defer $device: no healthy node");
        continue;
    }
    $res = run_engine(['--node', $node, '--label', $label, '--json']);
    if (isset($res['install_oneliner']) && isset($res['uuid'])) {
        $db->prepare("UPDATE vps_helpers SET status='active', node=?, exit_ip=?, email=?,
                      install_oneliner=?, error='', provisioned_at=?, updated_at=? WHERE device_id=?")
           ->execute([$node, $res['exit_ip'] ?? '', $res['email'] ?? "vpsh-$label",
                      $res['install_oneliner'], time(), time(), $device]);
        vh_audit($db, 'provisioned', $device, $node, $res['email'] ?? "vpsh-$label", 'worker', '', 'exit=' . ($res['exit_ip'] ?? ''));
        wlog("provisioned $device on $node (vpsh-$label)");
    } else {
        $errmsg = substr((string)($res['_error'] ?? 'unknown'), 0, 200);
        $db->prepare("UPDATE vps_helpers SET status='error', error=?, updated_at=? WHERE device_id=?")
           ->execute([$errmsg, time(), $device]);
        vh_audit($db, 'provision-failed', $device, $node, "vpsh-$label", 'worker', '', $errmsg);
        wlog("FAILED $device on $node: $errmsg");
    }
}

// ── revoke ───────────────────────────────────────────────────────────────────
foreach ($db->query("SELECT * FROM vps_helpers WHERE status='revoking' ORDER BY updated_at ASC")->fetchAll() as $row) {
    $device = $row['device_id']; $label = $row['label'];
    $node = $row['node'] ?: (select_node() ?? NODE_CANDIDATES[0]);
    $res = run_engine(['--node', $node, '--revoke', '--label', $label, '--json']);
    // revoke is best-effort idempotent; mark revoked regardless of transient node errors
    $db->prepare("UPDATE vps_helpers SET status='revoked', install_oneliner='', revoked_at=?, updated_at=? WHERE device_id=?")
       ->execute([time(), time(), $device]);
    vh_audit($db, 'revoked', $device, $node, $row['email'] ?: "vpsh-$label", 'worker', '',
             isset($res['revoked']) ? 'ok' : substr((string)($res['_error'] ?? 'node-warn'), 0, 120));
    wlog("revoked $device on $node (vpsh-$label)");
}

flock($lock, LOCK_UN);
fclose($lock);
