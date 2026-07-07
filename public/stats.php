<?php
/**
 * Public live-stats endpoint for the landing page.
 *
 * Returns ONLY aggregate, non-identifying counts — safe to expose without a
 * token: total members (devices that ever installed), how many countries they
 * span, and the platform split. No device IDs, IPs, or per-user rows ever
 * leave here. Cached 60 s in a file so landing-page polling can't hammer the
 * SQLite DB the mobile API also uses.
 *
 * Shape: {"ok":true,"members":124,"countries":8,"android":69,"ios":55,"ts":...}
 */
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=60');

$CACHE = sys_get_temp_dir() . '/setalink-landing-stats.json';
$TTL   = 60;

// Serve the warm cache when it is fresh — keeps the DB cold under load.
if (is_file($CACHE) && (time() - filemtime($CACHE)) < $TTL) {
    readfile($CACHE);
    exit;
}

$out = ['ok' => false];
try {
    $pdo = new PDO('sqlite:' . __DIR__ . '/../data/analytics.db', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT            => 3,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout=3000');

    $members   = (int)$pdo->query('SELECT COUNT(*) c FROM devices')->fetch()['c'];
    $countries = (int)$pdo->query(
        "SELECT COUNT(DISTINCT country) c FROM devices WHERE country <> ''")->fetch()['c'];

    $android = 0; $ios = 0;
    foreach ($pdo->query(
        "SELECT platform, COUNT(*) c FROM devices GROUP BY platform") as $r) {
        if ($r['platform'] === 'ios')     { $ios     = (int)$r['c']; }
        elseif ($r['platform'] === 'android') { $android = (int)$r['c']; }
    }

    $out = [
        'ok'        => true,
        'members'   => $members,
        'countries' => max(1, $countries),
        'android'   => $android,
        'ios'       => $ios,
        'ts'        => time(),
    ];
    $json = json_encode($out, JSON_UNESCAPED_SLASHES);
    // Atomic write so a concurrent reader never sees a half-written file.
    $tmp = $CACHE . '.' . getmypid() . '.tmp';
    if (file_put_contents($tmp, $json) !== false) { @rename($tmp, $CACHE); }
    echo $json;
} catch (Throwable $e) {
    // On any DB error, fall back to a stale cache if we have one; otherwise a
    // minimal shape so the page's animation has something honest to show.
    if (is_file($CACHE)) { readfile($CACHE); }
    else { echo json_encode(['ok' => false, 'members' => 0, 'countries' => 0]); }
}
