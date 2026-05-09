<?php
// SetaLink admin dashboard. Single-file PHP page that:
//   - reads server status + user list via the setalink-cli sudo wrapper
//   - handles add/remove/disable/enable as form POSTs (CSRF-protected)
//   - renders a simple HTML page with stats + table + add form
//
// Auth is enforced upstream by nginx (auth_basic). PHP-FPM sees the
// authenticated user in $_SERVER['PHP_AUTH_USER'] / $_SERVER['REMOTE_USER'].
// We use that as the namespace for the CSRF cookie.
declare(strict_types=1);

const CLI = '/usr/bin/sudo -n /var/www/setalink/admin/setalink-cli';
const USERNAME_RE = '/^[a-z0-9][a-z0-9._-]{0,31}$/';
const VALID_PACKAGES = ['5GB', '10GB', '15GB', 'unlimited'];

// -------------------------------------------------------------------------
// CSRF: deterministic per-admin token derived from a server-side secret +
// the basic-auth username. Stored in a cookie so any tab carrying the
// authenticated session has it; required as a hidden field on every POST.
// -------------------------------------------------------------------------
$secret_path = '/etc/setalink/admin/csrf.secret';
$csrf_secret = is_readable($secret_path) ? trim((string)file_get_contents($secret_path)) : '';
$auth_user   = (string)($_SERVER['PHP_AUTH_USER'] ?? $_SERVER['REMOTE_USER'] ?? '');
$csrf_token  = hash_hmac('sha256', $auth_user, $csrf_secret);

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $sent = (string)($_POST['_csrf'] ?? '');
    if ($csrf_secret === '' || !hash_equals($csrf_token, $sent)) {
        http_response_code(403);
        exit('csrf token mismatch');
    }
}
setcookie('_csrf', $csrf_token, [
    'path'     => '/_setalink-admin/',
    'secure'   => true,
    'httponly' => false,  // form needs to read it via the hidden field below
    'samesite' => 'Strict',
]);

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
function cli_run(string $action, array $args = []): array {
    $cmd = CLI . ' ' . escapeshellarg($action);
    foreach ($args as $a) {
        $cmd .= ' ' . escapeshellarg($a);
    }
    $cmd .= ' 2>&1';
    exec($cmd, $out, $rc);
    return ['rc' => $rc, 'output' => implode("\n", $out)];
}

function cli_json(string $action, array $args = []): array {
    $r = cli_run($action, $args);
    if ($r['rc'] !== 0) {
        return ['_error' => $r['output']];
    }
    $j = json_decode($r['output'], true);
    return is_array($j) ? $j : ['_error' => 'unparseable cli output'];
}

function valid_username(string $n): bool {
    return (bool)preg_match(USERNAME_RE, $n);
}

function valid_package(string $p): bool {
    return in_array($p, VALID_PACKAGES, true);
}

function flash_redirect(string $kind, string $msg): void {
    header('Location: ./?flash=' . urlencode($kind) . '&msg=' . urlencode($msg));
    exit;
}

// Compact byte formatter: 0 → "0 B", 1.5 GB → "1.5 GB", etc.
function fmt_bytes($b): string {
    $b = (int)$b;
    if ($b <= 0) return '0 B';
    $units = ['B','KB','MB','GB','TB'];
    $i = 0;
    $v = (float)$b;
    while ($v >= 1024 && $i < count($units) - 1) { $v /= 1024; $i++; }
    return ($v >= 100 ? number_format($v, 0) : number_format($v, 1)) . ' ' . $units[$i];
}

// Relative-time formatter: "5m ago", "3h ago", "2d ago", or "—"
function fmt_relative(?string $iso): string {
    if (!$iso) return '—';
    $t = strtotime($iso);
    if ($t === false) return '—';
    $delta = time() - $t;
    if ($delta < 0)        return 'just now';
    if ($delta < 60)       return $delta . 's ago';
    if ($delta < 3600)     return (int)($delta / 60)   . 'm ago';
    if ($delta < 86400)    return (int)($delta / 3600) . 'h ago';
    if ($delta < 86400*30) return (int)($delta / 86400). 'd ago';
    return date('Y-m-d', $t);
}

// -------------------------------------------------------------------------
// POST handlers — every action is gated by CSRF check above.
// -------------------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    $name   = trim((string)($_POST['name'] ?? ''));
    $pkg    = trim((string)($_POST['package'] ?? ''));

    $allowed_actions = ['add', 'remove', 'disable', 'enable',
                        'reset-traffic', 'change-package', 'regen-link'];
    if (!in_array($action, $allowed_actions, true)) {
        flash_redirect('error', 'unknown action');
    }
    if (!valid_username($name)) {
        flash_redirect('error', 'invalid username (a-z 0-9 . _ -, max 32 chars, starts alnum)');
    }
    if ($action === 'add' && $pkg === '') $pkg = 'unlimited';
    if ($action === 'add' && !valid_package($pkg)) {
        flash_redirect('error', 'invalid package');
    }
    if ($action === 'change-package' && !valid_package($pkg)) {
        flash_redirect('error', 'invalid package');
    }

    // Build CLI args per action.
    $args = [$name];
    if ($action === 'add' || $action === 'change-package') {
        $args[] = $pkg;
    }

    $r = cli_run($action, $args);
    if ($r['rc'] === 0) {
        $detail = ($action === 'change-package' || $action === 'add')
                ? "{$action}: {$name} → {$pkg}"
                : "{$action}: {$name}";
        flash_redirect('ok', $detail);
    } else {
        // Trim noisy ANSI / show last line
        $tail = trim((string)preg_replace('/\x1b\[[0-9;]*m/', '', $r['output']));
        $tail = substr($tail, -300);
        flash_redirect('error', "{$action} failed: {$tail}");
    }
}

// -------------------------------------------------------------------------
// GET — render dashboard
// -------------------------------------------------------------------------
$status = cli_json('status');
$list   = cli_json('list');
$flash_kind = (string)($_GET['flash'] ?? '');
$flash_msg  = (string)($_GET['msg']   ?? '');

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>SetaLink admin</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
    <h1>SetaLink admin</h1>
    <small>signed in as <code><?=h($auth_user)?></code></small>
</header>

<?php if ($flash_kind): ?>
    <div class="flash flash-<?=h($flash_kind)?>"><?=h($flash_msg)?></div>
<?php endif; ?>

<?php if (isset($status['_error'])): ?>
    <div class="flash flash-error">status error: <?=h($status['_error'])?></div>
<?php else: ?>
<section class="cards">
    <div class="card">
        <div class="card-label">users</div>
        <div class="card-value"><?=h((string)($status['users']['total'] ?? 0))?>
             <span class="card-sub">/ <?=h((string)($status['users']['max'] ?? 50))?></span></div>
    </div>
    <div class="card">
        <div class="card-label">active</div>
        <div class="card-value card-ok"><?=h((string)($status['users']['active'] ?? 0))?></div>
    </div>
    <div class="card">
        <div class="card-label">disabled</div>
        <div class="card-value card-warn"><?=h((string)($status['users']['disabled'] ?? 0))?></div>
    </div>
    <div class="card">
        <div class="card-label">public port</div>
        <div class="card-value"><?=h((string)($status['ports']['public'] ?? '?'))?></div>
        <div class="card-sub">xray internal :<?=h((string)($status['ports']['xray_internal'] ?? '?'))?></div>
    </div>
    <div class="card">
        <div class="card-label">services</div>
        <div class="card-value">
            <?php foreach (['xray','nginx','ufw'] as $svc):
                $st = (string)($status['services'][$svc] ?? '?');
                $cls = ($st === 'active') ? 'svc-ok' : 'svc-bad';
                ?><span class="svc <?=h($cls)?>"><?=h($svc)?>:<?=h($st)?></span> <?php endforeach; ?>
        </div>
    </div>
    <div class="card">
        <div class="card-label">REALITY SNI</div>
        <div class="card-value-small"><?=h((string)($status['sni'] ?? '?'))?></div>
        <div class="card-sub">host <?=h((string)($status['host'] ?? '?'))?></div>
    </div>
</section>
<?php endif; ?>

<section class="add-form">
    <h2>add user</h2>
    <form method="POST" action="">
        <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
        <input type="hidden" name="action" value="add">
        <label>username
            <input type="text" name="name" required pattern="[a-z0-9][a-z0-9._\-]{0,31}"
                   maxlength="32" autocomplete="off"
                   title="a-z 0-9 . _ -, max 32 chars, starts alnum">
        </label>
        <label>package
            <select name="package">
                <?php foreach (VALID_PACKAGES as $p): ?>
                    <option value="<?=h($p)?>"<?=$p === 'unlimited' ? ' selected' : ''?>><?=h($p)?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <button type="submit">add</button>
    </form>
</section>

<section class="users-table">
    <h2>users</h2>
    <?php if (isset($list['_error'])): ?>
        <div class="flash flash-error">list error: <?=h($list['_error'])?></div>
    <?php elseif (empty($list['users'])): ?>
        <p class="empty">no users yet — add one above.</p>
    <?php else: ?>
        <table>
        <thead><tr>
            <th>username</th><th>package</th><th>used / quota</th>
            <th>remaining</th><th>%</th><th>status</th>
            <th>created</th><th>last seen</th><th>actions</th>
        </tr></thead>
        <tbody>
        <?php foreach ($list['users'] as $u):
            $name      = (string)$u['name'];
            $is_dis    = (bool)$u['disabled'];
            $pkg       = (string)($u['package_name'] ?? 'unlimited');
            $used      = (int)($u['used_bytes']   ?? 0);
            $quota     = (int)($u['quota_bytes']  ?? 0);
            $remaining = $u['remaining_bytes']; // null when unlimited
            $percent   = $u['usage_percent'];   // null when unlimited
            $last_seen = $u['last_seen_at'] ?? null;

            // Width for the usage bar (0..100)
            $bar_pct = ($percent === null) ? 0 : max(0, min(100, (int)$percent));
            // Color band by usage
            $bar_class = 'bar-ok';
            if ($percent !== null) {
                if ($percent >= 90)      $bar_class = 'bar-bad';
                else if ($percent >= 70) $bar_class = 'bar-warn';
            }
        ?>
            <tr class="<?=$is_dis ? 'row-dis' : 'row-ok'?>">
                <td><code><?=h($name)?></code>
                    <div class="small mono uuid"><?=h((string)$u['uuid'])?></div></td>
                <td><span class="pkg pkg-<?=h(strtolower($pkg))?>"><?=h($pkg)?></span></td>
                <td class="small">
                    <?=h(fmt_bytes($used))?>
                    <?php if ($quota > 0): ?>/ <?=h(fmt_bytes($quota))?><?php else: ?><span class="muted"> / ∞</span><?php endif; ?>
                </td>
                <td class="small">
                    <?php if ($remaining !== null): ?>
                        <?=h(fmt_bytes((int)$remaining))?>
                    <?php else: ?>
                        <span class="muted">—</span>
                    <?php endif; ?>
                </td>
                <td class="small">
                    <?php if ($percent !== null): ?>
                        <div class="bar-wrap"><div class="bar <?=h($bar_class)?>" style="width: <?=$bar_pct?>%"></div></div>
                        <span class="bar-pct"><?=h((string)$percent)?>%</span>
                    <?php else: ?>
                        <span class="muted">—</span>
                    <?php endif; ?>
                </td>
                <td><?=$is_dis
                        ? '<span class="badge badge-warn">disabled</span>'
                        : '<span class="badge badge-ok">active</span>'?></td>
                <td class="small"><?=h(date('Y-m-d', strtotime((string)($u['created'] ?? 'now'))))?></td>
                <td class="small"><?=h(fmt_relative($last_seen))?></td>
                <td class="actions">
                    <div class="actions-row">
                        <a class="link-btn" href="qr.php?name=<?=h(urlencode($name))?>" target="_blank">QR</a>
                        <button type="button" class="link-btn copy-btn"
                                data-link-url="qr.php?name=<?=h(urlencode($name))?>&fmt=link">copy link</button>
                    </div>

                    <details class="row-details">
                        <summary class="link-btn">more…</summary>
                        <div class="row-details-body">
                            <?php if ($is_dis): ?>
                                <form method="POST" action="" class="inline">
                                    <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                    <input type="hidden" name="action" value="enable">
                                    <input type="hidden" name="name" value="<?=h($name)?>">
                                    <button type="submit" class="btn-ok">enable</button>
                                </form>
                            <?php else: ?>
                                <form method="POST" action="" class="inline">
                                    <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                    <input type="hidden" name="action" value="disable">
                                    <input type="hidden" name="name" value="<?=h($name)?>">
                                    <button type="submit" class="btn-warn">disable</button>
                                </form>
                            <?php endif; ?>

                            <form method="POST" action="" class="inline">
                                <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                <input type="hidden" name="action" value="reset-traffic">
                                <input type="hidden" name="name" value="<?=h($name)?>">
                                <button type="submit" class="btn-neutral">reset usage</button>
                            </form>

                            <form method="POST" action="" class="inline pkg-form">
                                <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                <input type="hidden" name="action" value="change-package">
                                <input type="hidden" name="name" value="<?=h($name)?>">
                                <select name="package">
                                    <?php foreach (VALID_PACKAGES as $p): ?>
                                        <option value="<?=h($p)?>"<?=$p === $pkg ? ' selected' : ''?>><?=h($p)?></option>
                                    <?php endforeach; ?>
                                </select>
                                <button type="submit" class="btn-neutral">change pkg</button>
                            </form>

                            <form method="POST" action="" class="inline">
                                <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                <input type="hidden" name="action" value="regen-link">
                                <input type="hidden" name="name" value="<?=h($name)?>">
                                <button type="submit" class="btn-neutral">regen link</button>
                            </form>

                            <form method="POST" action="" class="inline"
                                  onsubmit="return confirm('Permanently delete user <?=h($name)?>? This cannot be undone.');">
                                <input type="hidden" name="_csrf" value="<?=h($csrf_token)?>">
                                <input type="hidden" name="action" value="remove">
                                <input type="hidden" name="name" value="<?=h($name)?>">
                                <button type="submit" class="btn-danger">delete</button>
                            </form>
                        </div>
                    </details>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
        </table>
    <?php endif; ?>
</section>

<footer>
    <small>SetaLink admin · <?=h(date('Y-m-d H:i:s'))?> UTC</small>
</footer>

<script>
// Minimal copy-link helper. Fetches the vless URL via qr.php?fmt=link
// (which proxies through the sudo CLI) and copies it to the clipboard.
document.querySelectorAll('.copy-btn').forEach(b => {
    b.addEventListener('click', async (e) => {
        const url = e.currentTarget.dataset.linkUrl;
        try {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('http ' + r.status);
            const t = (await r.text()).trim();
            await navigator.clipboard.writeText(t);
            e.currentTarget.textContent = 'copied!';
            setTimeout(() => { e.currentTarget.textContent = 'copy link'; }, 1500);
        } catch (err) {
            e.currentTarget.textContent = 'copy failed';
            console.error(err);
        }
    });
});
</script>
</body>
</html>
