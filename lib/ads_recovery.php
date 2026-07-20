<?php
/**
 * Realink — Rewarded Ads + Hidden Recovery Quota (shared logic).
 *
 * Included by public/api.php (mobile endpoints), admin/api.php (metrics/config)
 * and scripts/test-ads-recovery.php. Pure helpers taking a PDO; the server is the
 * single source of truth for every quota grant. See docs/REWARDED-ADS-RECOVERY.md.
 *
 * Compliance: this code NEVER manipulates AdMob/Google signals, Advertising ID,
 * device identity or location. Rewards are granted only from a confirmed rewarded-ad
 * event (AdMob SSV when configured) under per-device anti-abuse caps.
 */

require_once __DIR__ . '/quota_economy.php';
require_once __DIR__ . '/ad_monetization.php';

const AR_RISK_HOLD = 75;   // risk_score >= this → reward HELD for review (mirrors referrals)

// ── Config (all remote-tunable via the settings table; no APK update) ─────────

function ar_defaults(): array {
    return [
        'ad_reward_bytes'            => 262144000,   // 250 MB per video
        'ad_daily_cap'               => 4,           // videos/day/device
        'ad_cooldown_secs'           => 300,         // 5 min between videos
        'ad_daily_reward_cap_bytes'  => 1073741824,  // 1 GB/day/device from ads
        'hidden_recovery_bytes'      => 536870912,   // 512 MB hidden reserve
        'recovery_throttle_kbps'     => 512,         // recovery bandwidth cap (advisory→xray)
        'recovery_session_secs'      => 1200,        // 20 min recovery TTL
        'ecpm_usd'                   => 3.0,          // revenue estimate input
        'egress_cost_per_gb_usd'     => 0.02,        // cost estimate input
        // AdMob SSV (placeholders until filled — see docs §4)
        'admob_app_id'               => '',
        'admob_rewarded_unit_id'     => '',
        'admob_ssv_enabled'          => 0,           // 1 = require valid SSV signature
        'ssv_keys_url'               => 'https://www.gstatic.com/admob/reward/verifier-keys.json',
        'dev_allow_client_confirm'   => 0,           // 1 ONLY in staging; MUST be 0 in prod
        // Recovery exit node (Helsinki default, fully overridable via settings)
        'recovery_exit_host'         => '65.109.183.7',
        'recovery_exit_port'         => 443,
        'recovery_exit_uuid'         => '',
        'recovery_exit_pbk'          => '',
        'recovery_exit_sid'          => '',
        'recovery_exit_sni'          => 'www.cloudflare.com',
        'recovery_exit_fp'           => 'chrome',
        'recovery_exit_flow'         => 'xtls-rprx-vision',
    ];
}

/** Merged config: defaults overlaid with any settings rows (typed by the default). */
function ar_config(PDO $pdo): array {
    $cfg  = ar_defaults();
    $keys = array_keys($cfg);
    $rows = [];
    try {
        $place = implode(',', array_fill(0, count($keys), '?'));
        $st = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($place)");
        $st->execute($keys);
        $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR);
    } catch (\Exception $e) { $rows = []; }
    foreach ($cfg as $k => $v) {
        if (!isset($rows[$k]) || $rows[$k] === '') continue;
        if (is_int($v))        $cfg[$k] = (int)$rows[$k];
        elseif (is_float($v))  $cfg[$k] = (float)$rows[$k];
        else                   $cfg[$k] = (string)$rows[$k];
    }
    return $cfg;
}

/**
 * Canonical Recovery-Mode allowlist (apex domains). Enforcement is GLOBAL on the
 * dedicated recovery xray inbound (SNI/DNS routing) — this list is the source the
 * xray config + client UX are generated from. Apex domains only (ad/CDN IPs rotate).
 */
function ar_allowlist(): array {
    return [
        // Realink itself
        'setalink.no', 'setalink.net', 'setalink.com',
        // Google / AdMob (rewarded ads must load)
        'googleads.g.doubleclick.net', 'googlesyndication.com', 'doubleclick.net',
        'google.com', 'gstatic.com', 'googleapis.com', 'admob.com', 'app-measurement.com',
        // TON (payments / recovery via crypto)
        'tonkeeper.com', 'toncenter.com', 'tonapi.io', 'ton.org',
        // Telegram (support / community)
        'telegram.org', 't.me', 'core.telegram.org', 'telegram.me',
        // SETAEI / Shahnameh ecosystem (extend as needed)
        'setaei.no',
    ];
}

// ── Schema ────────────────────────────────────────────────────────────────────

function ar_init_tables(PDO $pdo): void {
    qe_init_tables($pdo);
    foreach ([
        "ALTER TABLE devices ADD COLUMN hidden_recovery_total_bytes INTEGER DEFAULT 0",
        "ALTER TABLE devices ADD COLUMN recovery_used_bytes INTEGER DEFAULT 0",
    ] as $m) { try { $pdo->exec($m); } catch (\Exception $e) {} }

    $pdo->exec("CREATE TABLE IF NOT EXISTS ad_reward_events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id    TEXT    NOT NULL,
        nonce        TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'pending',   -- pending|confirmed|rejected|review
        reward_bytes INTEGER NOT NULL DEFAULT 0,
        ad_unit      TEXT    NOT NULL DEFAULT '',
        ssv_verified INTEGER NOT NULL DEFAULT 0,
        source       TEXT    NOT NULL DEFAULT '',           -- ssv|client
        client_ip    TEXT    NOT NULL DEFAULT '',
        risk_score   INTEGER NOT NULL DEFAULT 0,
        risk_flags   TEXT    NOT NULL DEFAULT '',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        confirmed_at TEXT
    )");
    $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_adrw_dev_nonce ON ad_reward_events(device_id, nonce)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adrw_status  ON ad_reward_events(status)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adrw_created ON ad_reward_events(created_at)");

    $pdo->exec("CREATE TABLE IF NOT EXISTS recovery_sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id  TEXT    NOT NULL,
        token_hash TEXT    NOT NULL DEFAULT '',
        issued_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT    NOT NULL,
        bytes_used INTEGER NOT NULL DEFAULT 0,
        status     TEXT    NOT NULL DEFAULT 'active'        -- active|expired|revoked
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_recsess_dev ON recovery_sessions(device_id)");
}

// ── Ad stats / caps / risk ─────────────────────────────────────────────────────

/** Per-device ad activity in the trailing 24h + cooldown remaining (computed in SQL, UTC-safe). */
function ar_ad_stats(PDO $pdo, string $deviceId, array $cfg): array {
    $st = $pdo->prepare(
        "SELECT COUNT(*) AS c, COALESCE(SUM(reward_bytes),0) AS b,
                CAST((julianday('now') - julianday(MAX(confirmed_at))) * 86400 AS INTEGER) AS since
         FROM ad_reward_events
         WHERE device_id=? AND status='confirmed' AND confirmed_at >= datetime('now','-1 day')");
    $st->execute([$deviceId]);
    $r = $st->fetch(PDO::FETCH_ASSOC) ?: ['c' => 0, 'b' => 0, 'since' => null];
    $cooldown = 0;
    if ($r['since'] !== null) $cooldown = max(0, (int)$cfg['ad_cooldown_secs'] - (int)$r['since']);
    return [
        'watched_today'           => (int)$r['c'],
        'reward_bytes_today'      => (int)$r['b'],
        'daily_cap'               => (int)$cfg['ad_daily_cap'],
        'daily_reward_cap_bytes'  => (int)$cfg['ad_daily_reward_cap_bytes'],
        'reward_bytes'            => (int)$cfg['ad_reward_bytes'],
        'cooldown_secs_remaining' => $cooldown,
    ];
}

/** @return array{0:bool,1:string,2:array} [allowed, reason, stats] */
function ar_can_reward(PDO $pdo, string $deviceId, array $cfg): array {
    $s = ar_ad_stats($pdo, $deviceId, $cfg);
    if ($s['watched_today'] >= $s['daily_cap'])                                 return [false, 'daily_cap_reached', $s];
    if ($s['reward_bytes_today'] + $s['reward_bytes'] > $s['daily_reward_cap_bytes']) return [false, 'daily_reward_cap_reached', $s];
    if ($s['cooldown_secs_remaining'] > 0)                                      return [false, 'cooldown', $s];
    return [true, '', $s];
}

/** Heuristic abuse score. High score → reward held for review, never auto-banned. */
function ar_risk(PDO $pdo, string $deviceId, string $clientIp): array {
    $score = 0; $flags = [];
    $dev = qe_fetch_device($pdo, $deviceId);
    if ($dev && !empty($dev['created_at'])) {
        $ageH = (int)$pdo->query(
            "SELECT CAST((julianday('now') - julianday(" .
            $pdo->quote($dev['created_at']) . ")) * 24 AS INTEGER)")->fetchColumn();
        if ($ageH < 24) { $score += 20; $flags[] = 'new_device'; }
    }
    if ($clientIp !== '') {
        $st = $pdo->prepare(
            "SELECT COUNT(DISTINCT device_id) FROM ad_reward_events
             WHERE client_ip=? AND created_at >= datetime('now','-1 day')");
        $st->execute([$clientIp]);
        $n = (int)$st->fetchColumn();
        if ($n >= 5)      { $score += 60; $flags[] = 'ip_cluster'; }
        elseif ($n >= 3)  { $score += 30; $flags[] = 'ip_shared'; }
    }
    return ['score' => $score, 'flags' => implode(',', $flags)];
}

// ── Ad reward lifecycle (server source of truth, idempotent) ────────────────────

/** Pre-ad gate: validate caps, record a pending event. Idempotent on (device,nonce). */
function ar_init_reward(PDO $pdo, string $deviceId, string $nonce, string $clientIp, array $cfg): array {
    ar_init_tables($pdo);
    if ($deviceId === '' || $nonce === '') throw new \RuntimeException('missing device_id or nonce');
    [$ok, $reason, $stats] = ar_can_reward($pdo, $deviceId, $cfg);
    if (!$ok) return ['accepted' => false, 'reason' => $reason, 'ads' => $stats];
    $risk = ar_risk($pdo, $deviceId, $clientIp);
    $pdo->prepare(
        "INSERT OR IGNORE INTO ad_reward_events (device_id, nonce, status, ad_unit, client_ip, risk_score, risk_flags)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)"
    )->execute([$deviceId, $nonce, $cfg['admob_rewarded_unit_id'], $clientIp, $risk['score'], $risk['flags']]);
    return ['accepted' => true, 'nonce' => $nonce, 'ssv_userid' => $deviceId, 'ads' => $stats];
}

/**
 * Confirm a rewarded-ad event and grant quota. Idempotent: a repeated (device,nonce)
 * never double-grants. Called by the trusted SSV path (source='ssv') and, only when
 * dev_allow_client_confirm=1, by the client path (source='client').
 */
/**
 * Best-effort mirror of a settled ad_reward_events row into the provider-agnostic
 * ad_events model (lib/ad_monetization.php), so /admin/monetization can show real
 * AdMob rewarded-video KPIs without re-deriving them from ad_reward_events. Never
 * throws — analytics logging must not be able to break the reward flow itself.
 */
function ar_record_ad_event(PDO $pdo, string $deviceId, string $nonce, string $adUnit, string $status, string $source, bool $ssvVerified, int $rewardBytes): void {
    try {
        am_event_insert($pdo, [
            'provider'                => 'admob',
            'event_type'              => 'reward',
            'placement'               => 'rewarded_video',
            'ad_unit_id'              => $adUnit,
            'provider_event_id'       => 'admob-reward:' . $deviceId . ':' . $nonce,
            'provider_transaction_id' => $nonce,
            'user_id'                 => $deviceId,
            'reward_type'             => 'gb',
            'reward_amount'           => $rewardBytes,
            'reward_granted'          => $status === 'confirmed' ? 1 : 0,
            'validation_status'       => $status === 'confirmed' ? 'verified' : ($status === 'rejected' ? 'rejected' : 'review'),
            // AdMob's SSV postback is Google's own server calling us with a signed
            // payload — that's a genuine provider callback, not just a client report.
            'source_type'             => $ssvVerified ? 'PROVIDER_CALLBACK' : 'LOCAL_SDK_EVENT',
        ]);
    } catch (\Exception $e) { /* best-effort */ }
}

function ar_confirm_reward(PDO $pdo, string $deviceId, string $nonce, string $source, bool $ssvVerified, array $cfg): array {
    ar_init_tables($pdo);
    if ($deviceId === '' || $nonce === '') throw new \RuntimeException('missing device_id or nonce');

    $own = !$pdo->inTransaction();
    if ($own) $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM ad_reward_events WHERE device_id=? AND nonce=?");
        $st->execute([$deviceId, $nonce]);
        $ev = $st->fetch(PDO::FETCH_ASSOC);
        if (!$ev) {
            // SSV can legitimately arrive without a prior init — create the row.
            $pdo->prepare("INSERT OR IGNORE INTO ad_reward_events (device_id, nonce, status, ad_unit) VALUES (?, ?, 'pending', ?)")
                ->execute([$deviceId, $nonce, $cfg['admob_rewarded_unit_id']]);
            $st->execute([$deviceId, $nonce]);
            $ev = $st->fetch(PDO::FETCH_ASSOC);
        }

        // Idempotency: already settled → return prior outcome, never re-grant.
        if ($ev['status'] === 'confirmed') {
            if ($own) $pdo->commit();
            return ['granted' => false, 'already' => true, 'reward_bytes' => (int)$ev['reward_bytes']];
        }
        if (in_array($ev['status'], ['rejected', 'review'], true)) {
            if ($own) $pdo->commit();
            return ['granted' => false, $ev['status'] => true];
        }

        [$ok, $reason] = ar_can_reward($pdo, $deviceId, $cfg);
        if (!$ok) {
            $pdo->prepare("UPDATE ad_reward_events SET status='rejected', source=?, confirmed_at=datetime('now') WHERE id=?")
                ->execute([$source, $ev['id']]);
            ar_record_ad_event($pdo, $deviceId, $nonce, (string)$cfg['admob_rewarded_unit_id'], 'rejected', $source, $ssvVerified, 0);
            if ($own) $pdo->commit();
            return ['granted' => false, 'rejected' => $reason];
        }
        if ((int)$ev['risk_score'] >= AR_RISK_HOLD) {
            $pdo->prepare("UPDATE ad_reward_events SET status='review', source=?, ssv_verified=?, confirmed_at=datetime('now') WHERE id=?")
                ->execute([$source, $ssvVerified ? 1 : 0, $ev['id']]);
            ar_record_ad_event($pdo, $deviceId, $nonce, (string)$cfg['admob_rewarded_unit_id'], 'review', $source, $ssvVerified, 0);
            if ($own) $pdo->commit();
            return ['granted' => false, 'review' => true];
        }

        $reward   = (int)$cfg['ad_reward_bytes'];
        $newTotal = qe_ledger_add($pdo, $deviceId, 'ad_reward', $reward, 'rewarded ad ' . $nonce);
        $pdo->prepare(
            "UPDATE ad_reward_events SET status='confirmed', reward_bytes=?, source=?, ssv_verified=?, confirmed_at=datetime('now') WHERE id=?"
        )->execute([$reward, $source, $ssvVerified ? 1 : 0, $ev['id']]);
        ar_record_ad_event($pdo, $deviceId, $nonce, (string)$cfg['admob_rewarded_unit_id'], 'confirmed', $source, $ssvVerified, $reward);
        if ($own) $pdo->commit();
        return ['granted' => true, 'reward_bytes' => $reward, 'new_total' => $newTotal];
    } catch (\Exception $e) {
        if ($own && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

// ── Recovery Mode ───────────────────────────────────────────────────────────────

/** Visible vs hidden-reserve picture. Hidden reserve is NEVER folded into visible_*. */
function ar_recovery_state(PDO $pdo, string $deviceId, array $cfg): array {
    $dev       = qe_fetch_device($pdo, $deviceId);
    $visTotal  = $dev ? (int)$dev['quota_bytes_total'] : 0;
    $visUsed   = $dev ? (int)$dev['quota_bytes_used']  : 0;
    $visRemain = max(0, $visTotal - $visUsed);
    $resTotal  = ($dev && (int)($dev['hidden_recovery_total_bytes'] ?? 0) > 0)
        ? (int)$dev['hidden_recovery_total_bytes'] : (int)$cfg['hidden_recovery_bytes'];
    $resUsed   = $dev ? (int)($dev['recovery_used_bytes'] ?? 0) : 0;
    $resRemain = max(0, $resTotal - $resUsed);
    return [
        'visible_remaining_bytes'  => $visRemain,
        'visible_total_bytes'      => $visTotal,
        'recovery_total_bytes'     => $resTotal,
        'recovery_used_bytes'      => $resUsed,
        'recovery_remaining_bytes' => $resRemain,
        'eligible'                 => ($visRemain <= 0 && $resRemain > 0),
    ];
}

/** Recovery VLESS/Reality profile assembled from remote config (exit node swappable). */
function ar_recovery_profile(array $cfg): array {
    return [
        'host'          => $cfg['recovery_exit_host'],
        'port'          => (int)$cfg['recovery_exit_port'],
        'uuid'          => $cfg['recovery_exit_uuid'],
        'publicKey'     => $cfg['recovery_exit_pbk'],
        'shortId'       => $cfg['recovery_exit_sid'],
        'sni'           => $cfg['recovery_exit_sni'],
        'fingerprint'   => $cfg['recovery_exit_fp'],
        'flow'          => $cfg['recovery_exit_flow'],
        'throttle_kbps' => (int)$cfg['recovery_throttle_kbps'],
    ];
}

/** Issue a short-lived recovery token + profile. Throws if ineligible/unconfigured. */
function ar_recovery_enter(PDO $pdo, string $deviceId, array $cfg): array {
    ar_init_tables($pdo);
    if ($deviceId === '') throw new \RuntimeException('missing device_id');
    $state = ar_recovery_state($pdo, $deviceId, $cfg);
    if (!$state['eligible'])              throw new \RuntimeException('not eligible for recovery');
    if (($cfg['recovery_exit_uuid'] ?? '') === '') throw new \RuntimeException('recovery node not configured');

    $pdo->prepare("UPDATE recovery_sessions SET status='expired' WHERE device_id=? AND status='active'")->execute([$deviceId]);
    $token = bin2hex(random_bytes(24));
    $ttl   = max(60, (int)$cfg['recovery_session_secs']);
    $pdo->prepare(
        "INSERT INTO recovery_sessions (device_id, token_hash, expires_at, status)
         VALUES (?, ?, datetime('now', ? || ' seconds'), 'active')"
    )->execute([$deviceId, hash('sha256', $token), '+' . $ttl]);

    return [
        'token'           => $token,
        'session_id'      => (int)$pdo->lastInsertId(),
        'expires_in_secs' => $ttl,
        'profile'         => ar_recovery_profile($cfg),
        'allowlist'       => ar_allowlist(),
        'state'           => $state,
    ];
}

/** Meter recovery-mode bytes against the hidden reserve + active session. */
function ar_meter_recovery(PDO $pdo, string $deviceId, int $bytes): void {
    if ($bytes <= 0 || $deviceId === '') return;
    ar_init_tables($pdo);
    $pdo->prepare("UPDATE devices SET recovery_used_bytes = recovery_used_bytes + ? WHERE device_id=?")
        ->execute([$bytes, $deviceId]);
    $pdo->prepare("UPDATE recovery_sessions SET bytes_used = bytes_used + ? WHERE device_id=? AND status='active'")
        ->execute([$bytes, $deviceId]);
}

// ── AdMob Server-Side Verification (SSV) ────────────────────────────────────────

function ar_b64url_decode(string $s): string {
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    return base64_decode($s) ?: '';
}

/** Fetch + cache AdMob's reward verifier keys (keyId → PEM). Cached ~24h in settings. */
function ar_ssv_keys(PDO $pdo, array $cfg): array {
    try {
        $cachedAt = (string)($pdo->query("SELECT value FROM settings WHERE key='ssv_keys_cache_at'")->fetchColumn() ?: '');
        $cached   = (string)($pdo->query("SELECT value FROM settings WHERE key='ssv_keys_cache'")->fetchColumn() ?: '');
        $fresh = $cachedAt !== '' && (time() - strtotime($cachedAt . ' UTC')) < 86400;
        if ($fresh && $cached !== '') {
            $map = json_decode($cached, true);
            if (is_array($map) && $map) return $map;
        }
    } catch (\Exception $e) { /* fall through to fetch */ }

    $ctx = stream_context_create(['http' => ['timeout' => 4, 'ignore_errors' => true]]);
    $raw = @file_get_contents($cfg['ssv_keys_url'], false, $ctx);
    if (!$raw) return [];
    $j = json_decode($raw, true);
    $map = [];
    foreach (($j['keys'] ?? []) as $k) {
        if (isset($k['keyId'], $k['pem'])) $map[(string)$k['keyId']] = $k['pem'];
    }
    if ($map) {
        try {
            $up = $pdo->prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
            $up->execute(['ssv_keys_cache', json_encode($map)]);
            $up->execute(['ssv_keys_cache_at', gmdate('Y-m-d H:i:s')]);
        } catch (\Exception $e) {}
    }
    return $map;
}

/**
 * Verify an AdMob SSV callback. AdMob signs the raw query string up to "&signature=".
 * Pass the raw query string (e.g. $_SERVER['QUERY_STRING']).
 * @return array{ok:bool,reason?:string,device_id?:string,nonce?:string}
 */
function ar_verify_ssv(PDO $pdo, string $rawQuery, array $cfg): array {
    $pos = strpos($rawQuery, '&signature=');
    if ($pos === false) return ['ok' => false, 'reason' => 'no signature'];
    $message = substr($rawQuery, 0, $pos);
    parse_str($rawQuery, $q);
    $sig   = ar_b64url_decode((string)($q['signature'] ?? ''));
    $keyId = (string)($q['key_id'] ?? '');
    if ($sig === '' || $keyId === '') return ['ok' => false, 'reason' => 'malformed'];

    $keys = ar_ssv_keys($pdo, $cfg);
    if (!isset($keys[$keyId])) return ['ok' => false, 'reason' => 'unknown key_id'];
    $verified = openssl_verify($message, $sig, $keys[$keyId], OPENSSL_ALGO_SHA256);
    if ($verified !== 1) return ['ok' => false, 'reason' => 'bad signature'];

    return [
        'ok'        => true,
        'device_id' => (string)($q['user_id'] ?? ''),        // custom_data user_id={deviceId}
        'nonce'     => (string)($q['transaction_id'] ?? ''), // unique per impression
    ];
}
