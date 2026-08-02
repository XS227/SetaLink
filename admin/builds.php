<?php
declare(strict_types=1);
// Admin — Test Builds. Standalone page: lists side-loadable APKs that are
// intentionally NOT in version.json, so no auto-update is pushed to users.
// Lives under /admin/ (same access posture as the rest of the panel).
function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES|ENT_SUBSTITUTE, 'UTF-8'); }

$dir  = '/var/www/setalink/public/download/build77';
$base = 'https://setalink.no/download/build77';
$files = [
  ['app-arm64-v8a-release.apk',  'arm64-v8a (most modern phones) — install THIS'],
  ['app-universal-release.apk',   'Universal (any device / fallback)'],
];
$sums = [];
foreach (glob($dir . '/SHA256SUMS.txt') ?: [] as $f) {
  foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    [$hash, $name] = array_pad(preg_split('/\s+/', trim($line), 2), 2, '');
    if ($name !== '') $sums[basename($name)] = $hash;
  }
}
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test Builds — Realink Admin</title>
<link rel="stylesheet" href="/_setalink-admin/../style.css">
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:2rem;max-width:860px;margin:0 auto}
  a{color:#58a6ff} h1{font-size:1.3rem} .muted{color:#8b949e}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:1.1rem 1.3rem;margin:1rem 0}
  .warn{border-color:#9e6a03;background:#1c1608}
  .row{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.6rem 0;border-bottom:1px solid #21262d;flex-wrap:wrap}
  .btn{background:#238636;color:#fff;padding:.5rem .9rem;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap}
  code{font-family:ui-monospace,monospace;font-size:.72rem;color:#8b949e;word-break:break-all}
  .back{display:inline-block;margin-bottom:1rem}
</style></head><body>
<a class="back" href="/_setalink-admin/index.php">‹ Admin</a>
<h1>📦 Test Builds — Build 77 — Observability & Correctness (connected-state, probe, node label, QUIC evidence)</h1>
<div class="card warn">
  <strong>⚠ Side-load only — NOT pushed to users.</strong>
  <p class="muted" style="margin:.4rem 0 0">
    These APKs are <strong>not</strong> referenced by <code>version.json</code>, so the
    in-app auto-update never offers them. Share the link with a tester to install manually.
    iOS build 76 is on TestFlight; this is its Android counterpart from the same
    <code>release/build75-smart-mode</code> branch (Android versionName 0.9.49 / versionCode 65 —
    the gradle version was not bumped, so it differs from stable only by the Smart Mode feature). Build 76 adds per-app bypass diagnostics ([BYPASS] pkg — OK/FAIL) to confirm whether cab.snapp.passenger is excluded. Signed with the SetaLink release cert (SHA-256 9970…9a0), APK Signature Scheme v2.
  </p>
</div>
<div class="card">
<?php foreach ($files as [$fname, $label]):
  $path = $dir . '/' . $fname;
  $size = is_file($path) ? round(filesize($path) / 1048576, 1) . ' MB' : 'missing';
  $sha  = $sums[$fname] ?? '—'; ?>
  <div class="row">
    <div>
      <div><strong><?= h($label) ?></strong> <span class="muted">· <?= h($size) ?></span></div>
      <code>sha256: <?= h($sha) ?></code>
    </div>
    <a class="btn" href="<?= h($base . '/' . $fname) ?>" download>Download</a>
  </div>
<?php endforeach; ?>
  <p class="muted" style="margin:.8rem 0 0;font-size:.8rem">
    32-bit (armeabi-v7a) build available in the GitHub Actions artifact
    <code>setalink-release-70</code> (run 28635699878) if an old device needs it.
  </p>
</div>
<p class="muted" style="font-size:.8rem">
  To promote to real users later: bump the Android <code>versionCode</code>, publish to
  <code>releases/&lt;channel&gt;/</code>, and update <code>download/version.json</code> — that is
  the only path that triggers the in-app updater.
</p>
</body></html>
