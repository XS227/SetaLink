<?php
/**
 * Realink — REAL/USD rate updater (dynamic premium pricing).
 *
 * Fetches the live USD price of the REAL jetton from DYOR (primary; ston.fi has no
 * REAL liquidity) and writes it to settings.real_usd_rate, so pay_real_amount() can
 * charge enough REAL to cover each package's USD value — never sold cheap.
 *
 * Run by cron (every ~10 min). Idempotent. Safe by design:
 *   - only overwrites the rate when the fetch yields a sane price (> 0) and the pool
 *     meets settings.real_rate_min_liquidity_usd (0 = no floor);
 *   - on any failure it LEAVES the previous rate in place (never zeroes it), so a
 *     transient outage can't make REAL payments give packages away.
 *
 * REAL payments are gated on real_usd_rate > 0 (see pay_method_ready), so if the rate
 * has never been set, REAL is simply hidden rather than sold at a stale static price.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/payments.php';

$DB = __DIR__ . '/../data/analytics.db';

function out(string $m): void { fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . "] $m\n"); }

try {
    $pdo = new PDO('sqlite:' . $DB, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
} catch (\Throwable $e) {
    fwrite(STDERR, "DB open failed: {$e->getMessage()}\n");
    exit(1);
}

$cfg     = pay_config($pdo);
$token   = trim((string)$cfg['real_token_address']);
$minLiq  = (float)($cfg['real_rate_min_liquidity_usd'] ?? 0);
if ($token === '') { fwrite(STDERR, "no real_token_address configured\n"); exit(1); }

/** Read a DYOR {value, decimals} amount as a float. */
function dyor_amount(?array $a): float {
    if (!is_array($a) || !isset($a['value'], $a['decimals'])) return 0.0;
    return (float)$a['value'] / (10 ** (int)$a['decimals']);
}

function http_get_json(string $url): ?array {
    $ctx = stream_context_create(['http' => [
        'method'  => 'GET',
        'timeout' => 15,
        'header'  => "Accept: application/json\r\nUser-Agent: realink-rate/1.0\r\n",
        'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) return null;
    $j = json_decode((string)$body, true);
    return is_array($j) ? $j : null;
}

// ── Primary source: DYOR ──────────────────────────────────────────────────────
$source = 'dyor.io';
$j = http_get_json("https://api.dyor.io/v1/jettons/{$token}");
$rate = 0.0; $liq = 0.0;
if ($j && isset($j['details'])) {
    $rate = dyor_amount($j['details']['priceUsd'] ?? null);
    $liq  = dyor_amount($j['details']['liquidityUsd'] ?? null);
}

if ($rate <= 0) {
    fwrite(STDERR, "no usable price from {$source} (rate={$rate}) — keeping previous rate\n");
    exit(2);
}
if ($minLiq > 0 && $liq < $minLiq) {
    fwrite(STDERR, "liquidity \${$liq} below floor \${$minLiq} — refusing to update (keeping previous rate)\n");
    exit(3);
}

$set = $pdo->prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
$set->execute(['real_usd_rate',        sprintf('%.12g', $rate)]);
$set->execute(['real_rate_updated_at', gmdate('Y-m-d H:i:s')]);
$set->execute(['real_rate_source',     $source]);

out(sprintf('REAL rate updated: 1 REAL = $%.12g (liquidity $%.2f) from %s', $rate, $liq, $source));
