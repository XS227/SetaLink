<?php
declare(strict_types=1);
/**
 * Admin — VPS Helper management. Standalone page (same access posture as the
 * rest of /_setalink-admin/, gated by nginx Basic-auth). Lists provisioned
 * helpers, and provisions/revokes via the shared queue (the cron worker does
 * the actual node work). The admin only ever sees the final one-line install
 * command — never a raw UUID, node private key or provision.sh.
 */
require_once __DIR__ . '/../lib/vps_helper.php';

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function admindb(): PDO {
    $db = new PDO('sqlite:' . realpath(__DIR__ . '/../data') . '/analytics.db', null, null,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL'); $db->exec('PRAGMA busy_timeout=3000');
    vh_init($db);
    return $db;
}

// CSRF: per-page nonce in a cookie (page is already Basic-auth gated).
$csrfCookie = $_COOKIE['vh_csrf'] ?? '';
if ($csrfCookie === '') { $csrfCookie = bin2hex(random_bytes(16)); setcookie('vh_csrf', $csrfCookie, 0, '/'); }

$flash = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals($csrfCookie, (string)($_POST['csrf'] ?? ''))) {
        http_response_code(403); exit('CSRF');
    }
    $db     = admindb();
    $device = trim((string)($_POST['device_id'] ?? ''));
    $act    = (string)($_POST['do'] ?? '');
    $ip     = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if ($act === 'provision') {
        $r = vh_request_provision($db, $device, 'admin', $ip);
        $flash = $r['ok'] ? "Queued provisioning for {$device} — the worker runs within a minute."
                          : "Error: {$r['error']}";
    } elseif ($act === 'revoke') {
        $r = vh_request_revoke($db, $device, 'admin', $ip);
        $flash = $r['ok'] ? "Queued revoke for {$device}." : "Error: {$r['error']}";
    }
    // PRG so refresh doesn't repost
    header('Location: ' . $_SERVER['PHP_SELF'] . '?msg=' . rawurlencode($flash));
    exit;
}
$flash = (string)($_GET['msg'] ?? '');

$db = admindb();
$rows = $db->query("SELECT * FROM vps_helpers ORDER BY updated_at DESC")->fetchAll();
$audit = $db->query("SELECT * FROM vps_helper_audit ORDER BY id DESC LIMIT 25")->fetchAll();
$statusColor = ['active' => '#238636', 'pending' => '#9e6a03', 'revoking' => '#9e6a03',
                'revoked' => '#6e7681', 'error' => '#da3633'];
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VPS Helper — Realink Admin</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:2rem;max-width:1000px;margin:0 auto}
  a{color:#58a6ff} h1{font-size:1.3rem} .muted{color:#8b949e}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:1.1rem 1.3rem;margin:1rem 0}
  table{width:100%;border-collapse:collapse;font-size:.8rem}
  th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid #21262d;vertical-align:top}
  th{color:#8b949e;font-weight:600}
  .pill{display:inline-block;padding:.1rem .5rem;border-radius:20px;color:#fff;font-size:.68rem;font-weight:700}
  input,button{font:inherit} input[type=text]{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:.45rem .6rem;min-width:280px}
  .btn{background:#238636;color:#fff;padding:.45rem .8rem;border:none;border-radius:8px;font-weight:600;cursor:pointer}
  .btn.rev{background:#6e2020}
  code{font-family:ui-monospace,monospace;font-size:.7rem;color:#8b949e;word-break:break-all}
  details summary{cursor:pointer;color:#58a6ff}
  .flash{background:#0d2818;border:1px solid #238636;border-radius:8px;padding:.6rem .9rem;margin:.6rem 0}
  .back{display:inline-block;margin-bottom:1rem}
  .cmdbox{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:.5rem;margin-top:.4rem}
</style></head><body>
<a class="back" href="/_setalink-admin/index.php">‹ Admin</a>
<h1>🖥️ VPS Helper — server-side exit for the VPS/SSH case</h1>
<p class="muted" style="max-width:760px">
  For users who SSH into their own VPS (Termius) and run tools like Claude Code <em>there</em>.
  That traffic is on the VPS, not the phone, so mobile Smart Mode/per-app bypass can't help and the
  VPS's own IP is often sanctioned. This provisions a dedicated, revocable node identity and hands the
  user <strong>one install command</strong>. Termius stays direct; only the tools they point at the
  proxy exit via ReaLink. This is fully separate from the mobile VPN and Smart Mode.
</p>
<?php if ($flash): ?><div class="flash"><?= h($flash) ?></div><?php endif; ?>

<div class="card">
  <form method="post" style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
    <input type="hidden" name="csrf" value="<?= h($csrfCookie) ?>">
    <input type="hidden" name="do" value="provision">
    <input type="text" name="device_id" placeholder="device_id (from the user's app)" required>
    <button class="btn" type="submit">Provision helper</button>
    <span class="muted">Auto-selects a healthy node · re-provisioning reuses the same identity.</span>
  </form>
</div>

<div class="card">
  <table>
    <tr><th>device</th><th>status</th><th>node</th><th>exit IP</th><th>identity</th><th>created</th><th>install command</th><th></th></tr>
    <?php foreach ($rows as $r): $c = $statusColor[$r['status']] ?? '#6e7681'; ?>
    <tr>
      <td><code><?= h(substr((string)$r['device_id'], 0, 28)) ?></code></td>
      <td><span class="pill" style="background:<?= $c ?>"><?= h($r['status']) ?></span></td>
      <td><?= h((string)($r['node'] ?: '—')) ?></td>
      <td><?= h((string)($r['exit_ip'] ?: '—')) ?></td>
      <td><code><?= h((string)($r['email'] ?: '—')) ?></code></td>
      <td class="muted"><?= $r['created_at'] ? h(date('Y-m-d H:i', (int)$r['created_at'])) : '—' ?></td>
      <td style="max-width:320px">
        <?php if ($r['status'] === 'active' && $r['install_oneliner']): ?>
          <details><summary>show one-line install</summary>
            <div class="cmdbox"><code><?= h((string)$r['install_oneliner']) ?></code></div>
          </details>
        <?php elseif ($r['status'] === 'error'): ?>
          <span class="muted">error: <?= h((string)$r['error']) ?></span>
        <?php else: ?><span class="muted">—</span><?php endif; ?>
      </td>
      <td>
        <?php if (!in_array($r['status'], ['revoked', 'revoking'], true)): ?>
        <form method="post" onsubmit="return confirm('Revoke this helper?')">
          <input type="hidden" name="csrf" value="<?= h($csrfCookie) ?>">
          <input type="hidden" name="do" value="revoke">
          <input type="hidden" name="device_id" value="<?= h((string)$r['device_id']) ?>">
          <button class="btn rev" type="submit">Revoke</button>
        </form>
        <?php endif; ?>
      </td>
    </tr>
    <?php endforeach; ?>
    <?php if (!$rows): ?><tr><td colspan="8" class="muted">No helpers provisioned yet.</td></tr><?php endif; ?>
  </table>
</div>

<div class="card">
  <div class="muted" style="margin-bottom:.5rem">Recent audit events</div>
  <table>
    <tr><th>time</th><th>event</th><th>device</th><th>node</th><th>identity</th><th>actor</th><th>detail</th></tr>
    <?php foreach ($audit as $a): ?>
    <tr>
      <td class="muted"><?= h(date('m-d H:i', (int)$a['ts'])) ?></td>
      <td><?= h((string)$a['event']) ?></td>
      <td><code><?= h(substr((string)$a['device_id'], 0, 18)) ?></code></td>
      <td><?= h((string)$a['node']) ?></td>
      <td><code><?= h((string)$a['email']) ?></code></td>
      <td><?= h((string)$a['actor']) ?></td>
      <td class="muted"><?= h((string)$a['detail']) ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>
</body></html>
