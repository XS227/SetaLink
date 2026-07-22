<?php
/**
 * Ad Monetization — provider-agnostic event model (AdMob + AdsGram).
 *
 * Every KPI on /admin/monetization traces back to a row here with an explicit
 * source_type (AM_SOURCE_TYPES) so the UI never presents an estimate as a
 * verified provider number, and never lets a lower-trust source silently
 * overwrite a higher-trust one (AM_SOURCE_PRIORITY, spec §8).
 *
 * Existing tables (ad_reward_events, ad_perf_daily, app_events, quota_transactions)
 * are untouched sources of record. This file adds a normalized layer on top,
 * fed by:
 *   - ar_confirm_reward()            (lib/ads_recovery.php)   AdMob SSV reward -> PROVIDER_CALLBACK
 *   - AD_BANNER_IMPRESSION app_events (public/api.php track-event) AdMob onPaid -> LOCAL_SDK_EVENT
 *   - push-adsgram-perf               (public/api.php)         AdsGram daily via Shahnameh -> PROVIDER_CALLBACK
 *   - push-adsgram-events              (public/api.php, optional, not yet sent by Shahnameh) -> PROVIDER_CALLBACK
 *   - lib/admob_sync.php              (AdMob Reporting API)    -> PROVIDER_API
 *   - lib/adsgram_publisher_sync.php  (AdsGram publisher API)  -> PROVIDER_API
 *   - CSV import                                                -> MANUAL_IMPORT
 *   - lib/ads_perf.php's eCPM-based estimate (legacy NOC page)  -> ESTIMATE
 *
 * Idempotency: unique index on (provider, provider_event_id). Callers build
 * provider_event_id from whatever the source actually guarantees is unique
 * (AdMob SSV transaction_id, AdsGram provider event id, or a synthetic key
 * like "banner:{device_id}:{app_events.id}" / "adsgram-daily:{date}:{platform}"
 * for sources that don't have a real provider id).
 */

declare(strict_types=1);

const AM_PROVIDERS = ['admob', 'adsgram'];

const AM_SOURCE_TYPES = [
    'PROVIDER_API', 'PROVIDER_CALLBACK', 'LOCAL_SDK_EVENT',
    'DATABASE_AGGREGATE', 'MANUAL_IMPORT', 'ESTIMATE',
];

// Lower number = more trusted. am_daily_metric_upsert() refuses to let a
// higher (less trusted) number overwrite a row already written by a lower one
// for the same (date, provider, app, platform, ad_unit_id) — spec §8: "Ikke
// overskriv provider-data med lokale estimater."
const AM_SOURCE_PRIORITY = [
    'PROVIDER_API'       => 1,
    'PROVIDER_CALLBACK'  => 2,
    'LOCAL_SDK_EVENT'    => 3,
    'DATABASE_AGGREGATE' => 4,
    'MANUAL_IMPORT'      => 5,
    'ESTIMATE'           => 6,
];

const AM_VALIDATION_STATUSES = ['verified', 'unverified', 'rejected', 'review'];
// 'farr' = Shahnameh's own in-game currency, distinct from REAL/Gems (confirmed
// via Agent B's AdEventLog forwarder contract, TASK_SPLIT.md B→A(56)).
const AM_REWARD_TYPES        = ['gb', 'real', 'gems', 'farr', 'none'];

function am_source_rank(string $sourceType): int {
    return AM_SOURCE_PRIORITY[$sourceType] ?? 99;
}

/** Monetization-specific settings (stored in the same `settings` table as everything else). */
function am_defaults(): array {
    return [
        'mon_base_currency'      => 'USD',   // basisvaluta for any combined total
        'mon_value_per_real_usd' => 0.0,     // internal valuation, 0 = not configured (spec §11)
        'mon_value_per_gem_usd'  => 0.0,
        'mon_value_per_gb_usd'   => 0.02,    // default mirrors existing egress_cost_per_gb_usd
        'mon_fx_rates_json'      => '{}',    // {"NOK":{"rate_to_base":0.091,"at":"2026-07-20T...","source":"manual"}}
        'admob_client_id'        => '',      // OAuth client id (not secret — safe to show in admin)
        'admob_reporting_account'=> '',      // AdMob publisher account id, e.g. pub-5788265416382988
        'adsgram_publisher_configured' => 0, // computed elsewhere; placeholder so ar_config-style merge doesn't warn
    ];
}

// ── Schema ────────────────────────────────────────────────────────────────

function am_init_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS ad_events (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        provider                 TEXT    NOT NULL,                 -- admob | adsgram
        event_type               TEXT    NOT NULL DEFAULT '',      -- request|impression|click|reward|banner_impression|banner_request|daily_summary|error
        app                      TEXT    NOT NULL DEFAULT 'realgram',
        platform                 TEXT    NOT NULL DEFAULT '',      -- android|ios|telegram
        placement                TEXT    NOT NULL DEFAULT '',      -- home_banner|freedom_banner|interstitial|rewarded_video|shahnameh_watch
        ad_unit_id                TEXT    NOT NULL DEFAULT '',
        provider_event_id         TEXT    NOT NULL DEFAULT '',      -- idempotency key (see file header)
        provider_transaction_id   TEXT    NOT NULL DEFAULT '',      -- real provider transaction id, when the source actually has one
        user_id                   TEXT    NOT NULL DEFAULT '',      -- device_id or telegram user id
        internal_account_id       TEXT    NOT NULL DEFAULT '',      -- linked REAL account, if any
        request_id                TEXT    NOT NULL DEFAULT '',
        impression_id             TEXT    NOT NULL DEFAULT '',
        currency                  TEXT    NOT NULL DEFAULT '',
        provider_revenue          REAL,                             -- NULL = source never gave us a revenue figure
        estimated_revenue         REAL,                             -- NULL = no estimate computed
        reward_type                TEXT    NOT NULL DEFAULT 'none', -- gb|real|gems|none
        reward_amount               REAL    NOT NULL DEFAULT 0,
        reward_granted               INTEGER NOT NULL DEFAULT 0,
        validation_status            TEXT    NOT NULL DEFAULT 'unverified',
        source_type                  TEXT    NOT NULL DEFAULT 'ESTIMATE',
        raw_payload_hash              TEXT    NOT NULL DEFAULT '',
        raw_payload                    TEXT    NOT NULL DEFAULT '', -- sanitized JSON (no secrets/tokens) — full reward breakdown for multi-currency events
        error_message                  TEXT    NOT NULL DEFAULT '',
        duplicate_of                    INTEGER,
        country                          TEXT    NOT NULL DEFAULT '',
        app_version                       TEXT    NOT NULL DEFAULT '',
        created_at                         TEXT    NOT NULL DEFAULT (datetime('now')),
        processed_at                        TEXT
    )");
    // Idempotency: one row per (provider, provider_event_id) when the caller supplies one.
    $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_adev_provider_eventid
                ON ad_events(provider, provider_event_id) WHERE provider_event_id <> ''");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adev_provider_created ON ad_events(provider, created_at)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adev_user             ON ad_events(user_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adev_txn              ON ad_events(provider, provider_transaction_id) WHERE provider_transaction_id <> ''");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_adev_validation       ON ad_events(validation_status)");

    $pdo->exec("CREATE TABLE IF NOT EXISTS ad_daily_metrics (
        date              TEXT    NOT NULL,
        provider          TEXT    NOT NULL,
        app               TEXT    NOT NULL DEFAULT 'realgram',
        platform          TEXT    NOT NULL DEFAULT '',
        ad_unit_id        TEXT    NOT NULL DEFAULT '',
        requests          INTEGER NOT NULL DEFAULT 0,
        matched_requests  INTEGER NOT NULL DEFAULT 0,
        shown             INTEGER NOT NULL DEFAULT 0,
        impressions       INTEGER NOT NULL DEFAULT 0,
        clicks            INTEGER NOT NULL DEFAULT 0,
        completions       INTEGER NOT NULL DEFAULT 0,
        rewards_granted   INTEGER NOT NULL DEFAULT 0,
        rewards_failed    INTEGER NOT NULL DEFAULT 0,
        revenue           REAL    NOT NULL DEFAULT 0,
        currency          TEXT    NOT NULL DEFAULT '',
        source_type       TEXT    NOT NULL DEFAULT 'ESTIMATE',
        last_synced_at    TEXT,
        PRIMARY KEY (date, provider, app, platform, ad_unit_id)
    )");
    // `shown` (2026-07-22, spec item #2 in Khabat's reconciliation ask): a
    // creative DISPLAYING on-device (AD_*_SHOWN/OPENED) is not the same fact as
    // the provider CONFIRMING a paid impression (PAID/IMPRESSIONS) — conflating
    // them into one "impressions" column is exactly the mislabeling that made
    // the legacy `ads` NOC view's numbers unreconcilable with AdMob's own
    // console. Added via ALTER for installs where this table predates the
    // column; CREATE TABLE IF NOT EXISTS above is a no-op on those.
    try { $pdo->exec("ALTER TABLE ad_daily_metrics ADD COLUMN shown INTEGER NOT NULL DEFAULT 0"); } catch (\Exception $e) { /* already exists */ }
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_addm_provider_date ON ad_daily_metrics(provider, date)");

    // Manual AdsGram/other CSV imports — one row per import run, for the Logs tab + audit trail.
    $pdo->exec("CREATE TABLE IF NOT EXISTS ad_csv_imports (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        provider      TEXT    NOT NULL,
        filename      TEXT    NOT NULL DEFAULT '',
        imported_by   TEXT    NOT NULL DEFAULT '',
        row_count     INTEGER NOT NULL DEFAULT 0,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        raw_hash      TEXT    NOT NULL DEFAULT '',
        notes         TEXT    NOT NULL DEFAULT '',
        imported_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )");

    // Audit log for every monetization admin mutation (config changes, syncs, imports,
    // reward corrections) — spec §18. Self-contained; does not depend on the CLI's
    // starlink_admin_log (schema for that lives outside this repo's PHP).
    $pdo->exec("CREATE TABLE IF NOT EXISTS monetization_admin_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        actor      TEXT    NOT NULL DEFAULT '',
        action     TEXT    NOT NULL,
        details    TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_monlog_created ON monetization_admin_log(created_at)");
}

function am_log(PDO $pdo, string $actor, string $action, array $details = []): void {
    am_init_tables($pdo);
    $pdo->prepare("INSERT INTO monetization_admin_log (actor, action, details) VALUES (?, ?, ?)")
        ->execute([$actor, $action, json_encode($details, JSON_UNESCAPED_UNICODE)]);
}

// ── Config (settings table, same convention as ar_config()/ga4_setting()) ──

function am_config(PDO $pdo): array {
    $cfg  = am_defaults();
    $keys = array_keys($cfg);
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

function am_save_config(PDO $pdo, array $patch): array {
    $allowed = array_keys(am_defaults());
    $st = $pdo->prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
    $saved = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $patch)) continue;
        $st->execute([$k, (string)$patch[$k]]);
        $saved[] = $k;
    }
    return $saved;
}

// ── Currency (spec §2/§11: never sum NOK+USDT directly) ─────────────────────

/** Manually-entered FX rates, keyed by currency -> base. Never auto-fetched. */
function am_fx_rates(PDO $pdo): array {
    $cfg = am_config($pdo);
    $j = json_decode((string)$cfg['mon_fx_rates_json'], true);
    return is_array($j) ? $j : [];
}

function am_set_fx_rate(PDO $pdo, string $currency, float $rateToBase, string $source = 'manual'): void {
    $rates = am_fx_rates($pdo);
    $rates[strtoupper($currency)] = [
        'rate_to_base' => $rateToBase,
        'at'           => gmdate('c'),
        'source'       => $source,
    ];
    am_save_config($pdo, ['mon_fx_rates_json' => json_encode($rates, JSON_UNESCAPED_UNICODE)]);
}

/**
 * Convert $amount in $currency to the configured base currency.
 * Returns null (never guesses) if no rate is on file for a non-base currency.
 * @return array{amount:float,currency:string,rate:?float,rate_at:?string,rate_source:?string}|null
 */
function am_to_base(PDO $pdo, float $amount, string $currency): ?array {
    $cfg  = am_config($pdo);
    $base = strtoupper((string)$cfg['mon_base_currency']);
    $cur  = strtoupper($currency);
    if ($cur === '' ) return null;
    if ($cur === $base) {
        return ['amount' => $amount, 'currency' => $base, 'rate' => 1.0, 'rate_at' => null, 'rate_source' => 'identity'];
    }
    $rates = am_fx_rates($pdo);
    if (!isset($rates[$cur]['rate_to_base'])) return null;
    return [
        'amount'      => round($amount * (float)$rates[$cur]['rate_to_base'], 6),
        'currency'    => $base,
        'rate'        => (float)$rates[$cur]['rate_to_base'],
        'rate_at'     => (string)($rates[$cur]['at'] ?? ''),
        'rate_source' => (string)($rates[$cur]['source'] ?? 'manual'),
    ];
}

// ── Event / metric writes ────────────────────────────────────────────────

/**
 * Idempotent event insert. Returns ['inserted'=>bool,'duplicate'=>bool,'id'=>?int].
 * Duplicate detection: unique (provider, provider_event_id) index — a repeat
 * insert is silently a no-op here (INSERT OR IGNORE), never a second reward.
 */
function am_event_insert(PDO $pdo, array $e): array {
    am_init_tables($pdo);
    $provider = (string)($e['provider'] ?? '');
    if (!in_array($provider, AM_PROVIDERS, true)) {
        throw new \InvalidArgumentException('unknown provider: ' . $provider);
    }
    $sourceType = (string)($e['source_type'] ?? 'ESTIMATE');
    if (!in_array($sourceType, AM_SOURCE_TYPES, true)) {
        throw new \InvalidArgumentException('unknown source_type: ' . $sourceType);
    }
    $providerEventId = (string)($e['provider_event_id'] ?? '');

    // Pre-check so callers can tell a genuine duplicate apart from a fresh insert
    // (INSERT OR IGNORE alone can't distinguish "already existed" from "inserted").
    if ($providerEventId !== '') {
        $chk = $pdo->prepare("SELECT id FROM ad_events WHERE provider=? AND provider_event_id=?");
        $chk->execute([$provider, $providerEventId]);
        $existing = $chk->fetchColumn();
        if ($existing !== false) {
            return ['inserted' => false, 'duplicate' => true, 'id' => (int)$existing];
        }
    }

    // Optional: honor a real occurrence timestamp from the source (e.g. AdsGram's
    // AdEventLog forwarder runs every 15min and forwards a backlog — using
    // ingestion time there would skew daily rollups toward whenever the cron
    // happened to run). Accepts ISO-8601 or 'Y-m-d H:i:s'; falls back to now.
    $createdAt = 'now';
    if (!empty($e['created_at'])) {
        $ts = strtotime((string)$e['created_at']);
        if ($ts !== false) $createdAt = gmdate('Y-m-d H:i:s', $ts);
    }

    // Compute the coalesced+validated value ONCE, then reuse it — reading
    // $e['reward_type'] a second time after the ?? check (instead of the
    // variable holding the coalesced result) silently binds NULL into a
    // NOT NULL column when the key is absent, and INSERT OR IGNORE then drops
    // the entire row without error. Caught by scripts/test-monetization.php.
    $rewardTypeVal = (string)($e['reward_type'] ?? 'none');
    if (!in_array($rewardTypeVal, AM_REWARD_TYPES, true)) $rewardTypeVal = 'none';
    $validationStatusVal = (string)($e['validation_status'] ?? 'unverified');
    if (!in_array($validationStatusVal, AM_VALIDATION_STATUSES, true)) $validationStatusVal = 'unverified';

    $st = $pdo->prepare(
        "INSERT OR IGNORE INTO ad_events
            (provider, event_type, app, platform, placement, ad_unit_id,
             provider_event_id, provider_transaction_id, user_id, internal_account_id,
             request_id, impression_id, currency, provider_revenue, estimated_revenue,
             reward_type, reward_amount, reward_granted, validation_status, source_type,
             raw_payload_hash, raw_payload, error_message, country, app_version,
             created_at, processed_at)
         VALUES
            (:provider, :event_type, :app, :platform, :placement, :ad_unit_id,
             :provider_event_id, :provider_transaction_id, :user_id, :internal_account_id,
             :request_id, :impression_id, :currency, :provider_revenue, :estimated_revenue,
             :reward_type, :reward_amount, :reward_granted, :validation_status, :source_type,
             :raw_payload_hash, :raw_payload, :error_message, :country, :app_version,
             :created_at, datetime('now'))"
    );
    $st->execute([
        ':provider'                => $provider,
        ':event_type'              => (string)($e['event_type'] ?? ''),
        ':app'                     => (string)($e['app'] ?? 'realgram'),
        ':platform'                => (string)($e['platform'] ?? ''),
        ':placement'               => (string)($e['placement'] ?? ''),
        ':ad_unit_id'              => (string)($e['ad_unit_id'] ?? ''),
        ':provider_event_id'       => $providerEventId,
        ':provider_transaction_id' => (string)($e['provider_transaction_id'] ?? ''),
        ':user_id'                 => (string)($e['user_id'] ?? ''),
        ':internal_account_id'     => (string)($e['internal_account_id'] ?? ''),
        ':request_id'              => (string)($e['request_id'] ?? ''),
        ':impression_id'           => (string)($e['impression_id'] ?? ''),
        ':currency'                => (string)($e['currency'] ?? ''),
        ':provider_revenue'        => array_key_exists('provider_revenue', $e) ? $e['provider_revenue'] : null,
        ':estimated_revenue'       => array_key_exists('estimated_revenue', $e) ? $e['estimated_revenue'] : null,
        ':reward_type'             => $rewardTypeVal,
        ':reward_amount'           => (float)($e['reward_amount'] ?? 0),
        ':reward_granted'          => (int)(bool)($e['reward_granted'] ?? false),
        ':validation_status'       => $validationStatusVal,
        ':source_type'             => $sourceType,
        ':raw_payload_hash'        => (string)($e['raw_payload_hash'] ?? ''),
        ':raw_payload'             => (string)($e['raw_payload'] ?? ''),
        ':error_message'           => (string)($e['error_message'] ?? ''),
        ':country'                 => (string)($e['country'] ?? ''),
        ':app_version'             => (string)($e['app_version'] ?? ''),
        ':created_at'              => $createdAt === 'now' ? gmdate('Y-m-d H:i:s') : $createdAt,
    ]);
    $id = (int)$pdo->lastInsertId();
    return ['inserted' => $id > 0, 'duplicate' => false, 'id' => $id ?: null];
}

/**
 * Upsert an aggregate daily row. Refuses to let a less-trusted source_type
 * (higher AM_SOURCE_PRIORITY number) overwrite a row already recorded by a
 * more-trusted one for the same key — spec §8.
 */
function am_daily_metric_upsert(PDO $pdo, array $m): array {
    am_init_tables($pdo);
    $date     = (string)($m['date'] ?? '');
    $provider = (string)($m['provider'] ?? '');
    $app      = (string)($m['app'] ?? 'realgram');
    $platform = (string)($m['platform'] ?? '');
    $adUnit   = (string)($m['ad_unit_id'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) throw new \InvalidArgumentException('bad date');
    if (!in_array($provider, AM_PROVIDERS, true)) throw new \InvalidArgumentException('unknown provider');
    $newSourceType = (string)($m['source_type'] ?? 'ESTIMATE');

    $existing = $pdo->prepare(
        "SELECT source_type FROM ad_daily_metrics WHERE date=? AND provider=? AND app=? AND platform=? AND ad_unit_id=?");
    $existing->execute([$date, $provider, $app, $platform, $adUnit]);
    $curSourceType = $existing->fetchColumn();
    if ($curSourceType !== false && am_source_rank($newSourceType) > am_source_rank((string)$curSourceType)) {
        return ['written' => false, 'reason' => 'lower_priority_source', 'kept_source_type' => (string)$curSourceType];
    }

    $pdo->prepare(
        "INSERT INTO ad_daily_metrics
            (date, provider, app, platform, ad_unit_id, requests, matched_requests, shown, impressions,
             clicks, completions, rewards_granted, rewards_failed, revenue, currency, source_type, last_synced_at)
         VALUES (:date,:provider,:app,:platform,:ad_unit_id,:requests,:matched,:shown,:impr,:clicks,:completions,
                 :rg,:rf,:revenue,:currency,:source_type,datetime('now'))
         ON CONFLICT(date, provider, app, platform, ad_unit_id) DO UPDATE SET
             requests=excluded.requests, matched_requests=excluded.matched_requests,
             shown=excluded.shown, impressions=excluded.impressions, clicks=excluded.clicks, completions=excluded.completions,
             rewards_granted=excluded.rewards_granted, rewards_failed=excluded.rewards_failed,
             revenue=excluded.revenue, currency=excluded.currency, source_type=excluded.source_type,
             last_synced_at=datetime('now')"
    )->execute([
        ':date' => $date, ':provider' => $provider, ':app' => $app, ':platform' => $platform, ':ad_unit_id' => $adUnit,
        ':requests' => (int)($m['requests'] ?? 0), ':matched' => (int)($m['matched_requests'] ?? 0),
        ':shown' => (int)($m['shown'] ?? 0), ':impr' => (int)($m['impressions'] ?? 0), ':clicks' => (int)($m['clicks'] ?? 0),
        ':completions' => (int)($m['completions'] ?? 0), ':rg' => (int)($m['rewards_granted'] ?? 0),
        ':rf' => (int)($m['rewards_failed'] ?? 0), ':revenue' => (float)($m['revenue'] ?? 0),
        ':currency' => (string)($m['currency'] ?? ''), ':source_type' => $newSourceType,
    ]);
    return ['written' => true];
}

// ── Reconciliation (spec §6) ─────────────────────────────────────────────

/**
 * Compare provider-reported completions/impressions against locally-granted
 * rewards for one provider over a date window. Returns per-ad_unit rows plus
 * flagged discrepancies — never invents a number neither side has.
 */
function am_reconciliation(PDO $pdo, string $provider, string $from, string $to): array {
    am_init_tables($pdo);
    $rows = $pdo->prepare(
        "SELECT ad_unit_id,
                SUM(impressions)      AS provider_impressions,
                SUM(rewards_granted)  AS provider_rewards_granted,
                SUM(rewards_failed)   AS provider_rewards_failed
         FROM ad_daily_metrics
         WHERE provider=? AND date BETWEEN ? AND ? AND source_type IN ('PROVIDER_API','PROVIDER_CALLBACK')
         GROUP BY ad_unit_id"
    );
    $rows->execute([$provider, $from, $to]);
    $providerSide = $rows->fetchAll(PDO::FETCH_ASSOC);

    $local = $pdo->prepare(
        "SELECT ad_unit_id,
                COUNT(*)                                                      AS local_events,
                SUM(CASE WHEN reward_granted=1 THEN 1 ELSE 0 END)             AS local_rewards_granted,
                SUM(CASE WHEN validation_status='rejected' THEN 1 ELSE 0 END) AS local_rejected
         FROM ad_events
         WHERE provider=? AND event_type='reward' AND date(created_at) BETWEEN ? AND ?
         GROUP BY ad_unit_id"
    );
    $local->execute([$provider, $from, $to]);
    $localSide = $local->fetchAll(PDO::FETCH_ASSOC);
    $localByUnit = [];
    foreach ($localSide as $r) $localByUnit[(string)$r['ad_unit_id']] = $r;

    $out = [];
    $units = array_unique(array_merge(
        array_column($providerSide, 'ad_unit_id'),
        array_keys($localByUnit)
    ));
    foreach ($units as $unit) {
        $p = null;
        foreach ($providerSide as $row) { if ($row['ad_unit_id'] === $unit) { $p = $row; break; } }
        $l = $localByUnit[$unit] ?? null;
        $provImpr  = (int)($p['provider_impressions']     ?? 0);
        $provGrant = (int)($p['provider_rewards_granted']  ?? 0);
        $locGrant  = (int)($l['local_rewards_granted']     ?? 0);
        $locRej    = (int)($l['local_rejected']            ?? 0);
        $diff      = $provGrant - $locGrant;

        $alerts = [];
        if ($p && $provGrant > $locGrant) $alerts[] = 'provider har flere completions enn lokale rewards';
        if ($l && $locGrant > $provGrant && $p) $alerts[] = 'lokale rewards er høyere enn provider completions';
        if ($p === null && $l !== null) $alerts[] = 'lokale rewards uten provider-data i perioden';
        if ($l === null && $p !== null) $alerts[] = 'provider-data uten lokale rewards i perioden';

        $out[] = [
            'ad_unit_id'               => $unit,
            'provider_impressions'     => $provImpr,
            'provider_rewards_granted' => $provGrant,
            'local_rewards_granted'    => $locGrant,
            'local_rejected'           => $locRej,
            'difference'               => $diff,
            'alerts'                   => $alerts,
        ];
    }
    return $out;
}

// ── AdsGram per-event ingestion (push-adsgram-events contract) ─────────────

/** status -> [reward_granted, validation_status], per Agent B's AdEventLog
 *  contract (TASK_SPLIT.md B→A(56)). "credited" is the only status a reward
 *  actually went out for; server_error is breakage worth a human look,
 *  everything else is a legitimate business-rule rejection. */
const AM_ADSGRAM_STATUS_MAP = [
    'credited'       => [1, 'verified'],
    'cooldown'       => [0, 'rejected'],
    'daily_limit'    => [0, 'rejected'],
    'invalid_tier'   => [0, 'rejected'],
    'unauthorized'   => [0, 'rejected'],
    'user_not_found' => [0, 'rejected'],
    'server_error'   => [0, 'review'],
];

/**
 * Transform + insert one event from Shahnameh's AdEventLog forwarder
 * (public/api.php's push-adsgram-events, one call per event in the batch).
 * Pulled out of the HTTP handler so it's unit-testable — see
 * scripts/test-monetization.php.
 */
function am_ingest_adsgram_event(PDO $pdo, array $ev): array {
    $txnId = trim((string)($ev['providerTransactionId'] ?? ''));
    if ($txnId === '') return ['inserted' => false, 'duplicate' => false, 'rejected' => true, 'reason' => 'missing providerTransactionId'];

    $status = (string)($ev['status'] ?? '');
    [$rewardGranted, $validationStatus] = AM_ADSGRAM_STATUS_MAP[$status] ?? [0, 'unverified'];

    // real/gems/farr are mutually exclusive in practice (only one nonzero per
    // credited event) — pick whichever is nonzero for the KPI-facing
    // reward_type/reward_amount pair; raw_payload keeps the full breakdown in
    // case that assumption is ever wrong.
    $rewardType = 'none'; $rewardAmount = 0.0;
    foreach (['real', 'gems', 'farr'] as $rt) {
        $amt = (float)($ev[$rt] ?? 0);
        if ($amt != 0) { $rewardType = $rt; $rewardAmount = $amt; break; }
    }

    // AdsGram's own postback to Shahnameh is a genuine provider callback;
    // Shahnameh's client-reported "verify-reward" path is validated
    // business-side but not provider-confirmed — same distinction this repo
    // already draws for AdMob SSV vs client-confirm (lib/ads_recovery.php).
    $source = (string)($ev['source'] ?? '');
    $sourceType = $source === 'server_callback' ? 'PROVIDER_CALLBACK' : 'LOCAL_SDK_EVENT';

    $idType  = (string)($ev['idType'] ?? '');
    $account = (string)($ev['account'] ?? '');

    return am_event_insert($pdo, [
        'provider'                => 'adsgram',
        'event_type'              => 'reward',
        'platform'                => 'telegram',
        'placement'               => (string)($ev['tier'] ?? ''),
        'ad_unit_id'              => (string)($ev['blockId'] ?? ''),
        'provider_event_id'       => 'adsgram-event:' . $txnId,
        'provider_transaction_id' => $txnId,
        'user_id'                 => $account,
        'internal_account_id'     => $idType === 'real' ? $account : '',
        'reward_type'             => $rewardType,
        'reward_amount'           => $rewardAmount,
        'reward_granted'          => $rewardGranted,
        'validation_status'       => $validationStatus,
        'error_message'           => (string)($ev['reason'] ?? ''),
        'raw_payload'             => json_encode($ev, JSON_UNESCAPED_UNICODE),
        'created_at'              => (string)($ev['occurredAt'] ?? ''),
        'source_type'             => $sourceType,
    ]);
}

// ── Backfill (one-time, idempotent) from the legacy tables ─────────────────

/**
 * Populate ad_events/ad_daily_metrics from ad_reward_events, ad_perf_daily and
 * banner app_events — labeled with their REAL historical source_type, not
 * re-estimated. Safe to run repeatedly (idempotent on provider_event_id).
 */
function am_backfill(PDO $pdo, bool $dryRun = false): array {
    am_init_tables($pdo);
    $stats = ['admob_reward' => 0, 'adsgram_daily' => 0, 'banner' => 0, 'skipped_dupe' => 0];

    // 1) AdMob rewarded events (ad_reward_events, confirmed only — this table is
    //    already the real source of truth for rewarded video).
    $rows = $pdo->query("SELECT * FROM ad_reward_events WHERE status IN ('confirmed','rejected','review')")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        $sourceType = ((int)$r['ssv_verified'] === 1) ? 'PROVIDER_CALLBACK' : 'LOCAL_SDK_EVENT';
        $e = [
            'provider' => 'admob', 'event_type' => 'reward', 'platform' => '', 'placement' => 'rewarded_video',
            'ad_unit_id' => (string)$r['ad_unit'],
            'provider_event_id' => 'admob-reward:' . $r['device_id'] . ':' . $r['nonce'],
            'provider_transaction_id' => (string)$r['nonce'],
            'user_id' => (string)$r['device_id'],
            'reward_type' => 'gb', 'reward_amount' => (float)$r['reward_bytes'],
            'reward_granted' => $r['status'] === 'confirmed' ? 1 : 0,
            'validation_status' => $r['status'] === 'confirmed' ? 'verified' : ($r['status'] === 'rejected' ? 'rejected' : 'review'),
            'source_type' => $sourceType,
            'error_message' => $r['risk_flags'] ?: '',
        ];
        if ($dryRun) { $stats['admob_reward']++; continue; }
        $res = am_event_insert($pdo, $e);
        if ($res['duplicate']) $stats['skipped_dupe']++; else $stats['admob_reward']++;
    }

    // 1b) Same rewarded events, rolled up into ad_daily_metrics per day/ad_unit so
    //     Overview/charts have data without scanning ad_events every load.
    $daily = $pdo->query(
        "SELECT date(confirmed_at) AS d, ad_unit,
                COUNT(*) AS completions,
                SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS granted,
                SUM(CASE WHEN status IN ('rejected','review') THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN ssv_verified=1 THEN 1 ELSE 0 END) AS ssv_count
         FROM ad_reward_events WHERE confirmed_at IS NOT NULL GROUP BY d, ad_unit"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($daily as $r) {
        if (!$r['d']) continue;
        $allSsv = ((int)$r['ssv_count'] === (int)$r['completions']);
        $m = [
            'date' => $r['d'], 'provider' => 'admob', 'platform' => '', 'ad_unit_id' => (string)$r['ad_unit'],
            'completions' => (int)$r['completions'], 'rewards_granted' => (int)$r['granted'],
            'rewards_failed' => (int)$r['failed'], 'source_type' => $allSsv ? 'PROVIDER_CALLBACK' : 'LOCAL_SDK_EVENT',
        ];
        if (!$dryRun) am_daily_metric_upsert($pdo, $m);
    }

    // 2) AdsGram daily pushes (ad_perf_daily) — real dates/counts, revenue/eCPM
    //    known to be placeholder 0.0 until a publisher token exists (TASK_SPLIT A→B(19)/(20)).
    $rows = $pdo->query("SELECT * FROM ad_perf_daily WHERE platform='adsgram'")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        $m = [
            'date' => $r['date'], 'provider' => 'adsgram', 'platform' => 'telegram',
            'completions' => (int)$r['rewarded_views'], 'revenue' => (float)$r['revenue_usd'],
            'currency' => 'USD', 'source_type' => 'PROVIDER_CALLBACK',
        ];
        if ($dryRun) { $stats['adsgram_daily']++; continue; }
        am_daily_metric_upsert($pdo, $m);
        $stats['adsgram_daily']++;
    }

    // 3) Banner impressions (app_events, real onPaid values, client-reported).
    $rows = $pdo->query(
        "SELECT id, device_id, props, created_at FROM app_events WHERE event='AD_BANNER_IMPRESSION'"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        $props = json_decode((string)$r['props'], true) ?: [];
        $e = [
            'provider' => 'admob', 'event_type' => 'banner_impression',
            'placement' => (string)($props['slot'] ?? ''),
            'provider_event_id' => 'admob-banner:' . $r['id'],
            'user_id' => (string)$r['device_id'],
            'provider_revenue' => isset($props['value']) ? (float)$props['value'] : null,
            'currency' => (string)($props['currency'] ?? 'USD'),
            'reward_type' => 'none', 'validation_status' => 'unverified',
            'source_type' => 'LOCAL_SDK_EVENT',
        ];
        if ($dryRun) { $stats['banner']++; continue; }
        $res = am_event_insert($pdo, $e);
        if ($res['duplicate']) $stats['skipped_dupe']++; else $stats['banner']++;
    }

    // 3b) Banner daily rollup (requests/loaded/impressions/revenue), from the same
    //     app_events rows the existing banner-ads-stats admin action already reads.
    $bannerDaily = $pdo->query(
        "SELECT date(created_at) AS d, json_extract(props,'\$.slot') AS slot,
                SUM(CASE WHEN event='AD_BANNER_REQUEST'    THEN 1 ELSE 0 END) AS requests,
                SUM(CASE WHEN event='AD_BANNER_IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
                SUM(CASE WHEN event='AD_BANNER_CLICK'      THEN 1 ELSE 0 END) AS clicks,
                SUM(CASE WHEN event='AD_BANNER_IMPRESSION'
                         THEN CAST(json_extract(props,'\$.value') AS REAL) ELSE 0 END) AS revenue
         FROM app_events
         WHERE event IN ('AD_BANNER_REQUEST','AD_BANNER_IMPRESSION','AD_BANNER_CLICK')
         GROUP BY d, slot"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($bannerDaily as $r) {
        if (!$r['d']) continue;
        $m = [
            'date' => $r['d'], 'provider' => 'admob',
            'ad_unit_id' => 'banner:' . (string)$r['slot'],
            'requests' => (int)$r['requests'], 'impressions' => (int)$r['impressions'],
            'clicks' => (int)$r['clicks'], 'revenue' => (float)$r['revenue'], 'currency' => 'USD',
            'source_type' => 'LOCAL_SDK_EVENT',
        ];
        if (!$dryRun) am_daily_metric_upsert($pdo, $m);
    }

    // 4) Interstitial paid impressions, individually (app_events, real onPaid
    //    values) — needed so a specific device+timestamp is drillable via the
    //    Reward Events table/CSV export, the same way banner impressions
    //    already are (step 3). Only IMPRESSION (PAID) gets a per-event row;
    //    SHOWN/CLICK don't carry revenue and only need the daily rollup below.
    $rows = $pdo->query(
        "SELECT id, device_id, props, created_at FROM app_events WHERE event='AD_INTERSTITIAL_IMPRESSION'"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $r) {
        $props = json_decode((string)$r['props'], true) ?: [];
        $e = [
            'provider' => 'admob', 'event_type' => 'interstitial_impression',
            'placement' => 'interstitial',
            'provider_event_id' => 'admob-interstitial:' . $r['id'],
            'user_id' => (string)$r['device_id'],
            'provider_revenue' => isset($props['value']) ? (float)$props['value'] : null,
            'currency' => (string)($props['currency'] ?? 'USD'),
            'reward_type' => 'none', 'validation_status' => 'unverified',
            'source_type' => 'LOCAL_SDK_EVENT',
            'created_at' => (string)($r['created_at'] ?? ''),
        ];
        if ($dryRun) { $stats['interstitial_events'] = ($stats['interstitial_events'] ?? 0) + 1; continue; }
        $res = am_event_insert($pdo, $e);
        if ($res['duplicate']) $stats['skipped_dupe']++; else $stats['interstitial_events'] = ($stats['interstitial_events'] ?? 0) + 1;
    }

    // 4b) Interstitial daily rollup (app_events: AD_INTERSTITIAL_SHOWN/IMPRESSION/CLICK)
    //    — was completely absent from this table before 2026-07-22, so the
    //    Connect-tap interstitial (the ad shown on every connection) never
    //    contributed to Overview/Reconciliation at all. SHOWN (OPENED — the
    //    creative displayed on-device) and IMPRESSION (PAID — the provider
    //    actually counted/paid for it) are kept in SEPARATE columns on
    //    purpose (spec item #2 in Khabat's 2026-07-22 reconciliation ask):
    //    a shown ad is not the same fact as a provider-confirmed impression,
    //    and collapsing them into one number is exactly what made the legacy
    //    `ads` NOC view's revenue unreconcilable with AdMob's own console.
    $interDaily = $pdo->query(
        "SELECT date(created_at) AS d,
                SUM(CASE WHEN event='AD_INTERSTITIAL_SHOWN'      THEN 1 ELSE 0 END) AS shown,
                SUM(CASE WHEN event='AD_INTERSTITIAL_IMPRESSION' THEN 1 ELSE 0 END) AS impressions,
                SUM(CASE WHEN event='AD_INTERSTITIAL_CLICK'      THEN 1 ELSE 0 END) AS clicks,
                SUM(CASE WHEN event='AD_INTERSTITIAL_IMPRESSION'
                         THEN CAST(json_extract(props,'\$.value') AS REAL) ELSE 0 END) AS revenue
         FROM app_events
         WHERE event IN ('AD_INTERSTITIAL_SHOWN','AD_INTERSTITIAL_IMPRESSION','AD_INTERSTITIAL_CLICK')
         GROUP BY d"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($interDaily as $r) {
        if (!$r['d']) continue;
        $m = [
            'date' => $r['d'], 'provider' => 'admob', 'ad_unit_id' => 'interstitial',
            'shown' => (int)$r['shown'], 'impressions' => (int)$r['impressions'],
            'clicks' => (int)$r['clicks'], 'revenue' => (float)$r['revenue'], 'currency' => 'USD',
            'source_type' => 'LOCAL_SDK_EVENT',
        ];
        if ($dryRun) { $stats['interstitial'] = ($stats['interstitial'] ?? 0) + 1; continue; }
        am_daily_metric_upsert($pdo, $m);
        $stats['interstitial'] = ($stats['interstitial'] ?? 0) + 1;
    }

    return $stats;
}

// ── Overview / provider summaries (spec §2/§3/§4) ───────────────────────────

/** Human status label shown next to every KPI, per spec §2's worked examples. */
function am_status_label(string $sourceType): string {
    switch ($sourceType) {
        case 'PROVIDER_API':       return 'verified';
        case 'PROVIDER_CALLBACK':  return 'provider_reported';
        case 'LOCAL_SDK_EVENT':    return 'local';
        case 'DATABASE_AGGREGATE': return 'local';
        case 'MANUAL_IMPORT':      return 'manual';
        case 'ESTIMATE':
        default:                  return 'estimated';
    }
}

/**
 * Provider revenue/traffic summary for a date range, grouped by
 * (source_type, currency) — NEVER blended into one silently-summed number
 * (spec §2: don't sum NOK+USDT; don't let an estimate masquerade as verified).
 * `primary` is the single highest-trust group, for the KPI card headline;
 * `breakdown` is the full list, for the "source" tooltip / detail view.
 */
function am_provider_summary(PDO $pdo, string $provider, string $from, string $to): array {
    am_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT source_type, currency,
                SUM(requests) AS requests, SUM(matched_requests) AS matched_requests,
                SUM(shown) AS shown, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                SUM(completions) AS completions, SUM(rewards_granted) AS rewards_granted,
                SUM(rewards_failed) AS rewards_failed, SUM(revenue) AS revenue,
                MAX(last_synced_at) AS last_synced_at
         FROM ad_daily_metrics WHERE provider=? AND date BETWEEN ? AND ?
         GROUP BY source_type, currency
         ORDER BY revenue DESC"
    );
    $st->execute([$provider, $from, $to]);
    $groups = $st->fetchAll(PDO::FETCH_ASSOC);

    $totals = ['requests' => 0, 'matched_requests' => 0, 'shown' => 0, 'impressions' => 0, 'clicks' => 0,
               'completions' => 0, 'rewards_granted' => 0, 'rewards_failed' => 0];
    $best = null;
    foreach ($groups as &$g) {
        foreach (array_keys($totals) as $k) { $totals[$k] += (int)$g[$k]; $g[$k] = (int)$g[$k]; }
        $g['revenue']       = (float)$g['revenue'];
        $g['status_label']  = am_status_label((string)$g['source_type']);
        if ($best === null || am_source_rank((string)$g['source_type']) < am_source_rank((string)$best['source_type'])) $best = $g;
    }
    unset($g);

    return ['breakdown' => $groups, 'primary' => $best] + $totals;
}

/** Ad-unit-level breakdown within one provider (spec §3/§4's "bryt ned per annonseenhet"). */
function am_ad_unit_breakdown(PDO $pdo, string $provider, string $from, string $to): array {
    am_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT ad_unit_id, platform,
                SUM(requests) AS requests, SUM(matched_requests) AS matched_requests,
                SUM(shown) AS shown, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                SUM(completions) AS completions, SUM(rewards_granted) AS rewards_granted,
                SUM(revenue) AS revenue, currency, MAX(source_type) AS source_type,
                MAX(last_synced_at) AS last_event_at
         FROM ad_daily_metrics WHERE provider=? AND date BETWEEN ? AND ?
         GROUP BY ad_unit_id, platform, currency
         ORDER BY revenue DESC"
    );
    $st->execute([$provider, $from, $to]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['requests'] = (int)$r['requests']; $r['matched_requests'] = (int)$r['matched_requests'];
        $r['shown'] = (int)$r['shown'];
        $r['impressions'] = (int)$r['impressions']; $r['clicks'] = (int)$r['clicks'];
        $r['completions'] = (int)$r['completions']; $r['rewards_granted'] = (int)$r['rewards_granted'];
        $r['revenue'] = (float)$r['revenue'];
        $r['match_rate'] = $r['requests'] > 0 ? round($r['matched_requests'] / $r['requests'], 4) : null;
        $r['ecpm'] = $r['impressions'] > 0 ? round($r['revenue'] / $r['impressions'] * 1000, 4) : null;
        $r['status_label'] = am_status_label((string)$r['source_type']);
    }
    unset($r);
    return $rows;
}

// ── Reward Events (spec §5) ──────────────────────────────────────────────

/**
 * Paginated, filterable reward-event table. Filters: provider, validation_status
 * ('verified'|'rejected'|'review'|'unverified' — UI maps success/failed onto
 * this), app, user_id, reward_type, platform, ad_unit_id, from/to dates.
 */
function am_reward_events(PDO $pdo, array $f): array {
    am_init_tables($pdo);
    $where = ['1=1']; $args = [];
    foreach ([
        'provider' => 'provider', 'validation_status' => 'validation_status',
        'app' => 'app', 'user_id' => 'user_id', 'reward_type' => 'reward_type',
        'platform' => 'platform', 'ad_unit_id' => 'ad_unit_id',
    ] as $param => $col) {
        if (!empty($f[$param])) { $where[] = "$col = ?"; $args[] = $f[$param]; }
    }
    if (!empty($f['from'])) { $where[] = "date(created_at) >= ?"; $args[] = $f['from']; }
    if (!empty($f['to']))   { $where[] = "date(created_at) <= ?"; $args[] = $f['to']; }
    $sql = "SELECT * FROM ad_events WHERE " . implode(' AND ', $where);

    $countSt = $pdo->prepare(str_replace('SELECT *', 'SELECT COUNT(*)', $sql));
    $countSt->execute($args);
    $total = (int)$countSt->fetchColumn();

    $limit  = max(1, min(500, (int)($f['limit'] ?? 50)));
    $offset = max(0, (int)($f['offset'] ?? 0));
    $st = $pdo->prepare($sql . " ORDER BY id DESC LIMIT $limit OFFSET $offset");
    $st->execute($args);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['status_label'] = am_status_label((string)$r['source_type']);
        // duplicate_of/raw_payload_hash are internal bookkeeping; raw_payload
        // itself is safe (already sanitized on write, no secrets/tokens in it).
    }
    unset($r);
    return ['rows' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset];
}

// ── Alerts (spec §14) ────────────────────────────────────────────────────

/**
 * $admobConfigured/$adsgramConfigured are passed in rather than checked here
 * (admob_client_configured()/adsgram_publisher_configured() live in
 * lib/admob_sync.php / lib/adsgram_publisher_sync.php) so this base model file
 * has no dependency on its sibling integration files — the admin/api.php
 * caller, which already loads all three, supplies them.
 */
function am_alerts(PDO $pdo, bool $admobConfigured, bool $adsgramConfigured): array {
    am_init_tables($pdo);
    $alerts = [];
    $weekAgo = gmdate('Y-m-d', strtotime('-7 days'));

    // AdMob iOS: requests but zero impressions.
    $iosRow = $pdo->prepare(
        "SELECT SUM(requests) req, SUM(impressions) impr FROM ad_daily_metrics
         WHERE provider='admob' AND platform='ios' AND date >= ?");
    $iosRow->execute([$weekAgo]);
    $ios = $iosRow->fetch(PDO::FETCH_ASSOC);
    if ($ios && (int)$ios['req'] > 0 && (int)$ios['impr'] === 0) {
        $alerts[] = ['level' => 'warn', 'area' => 'admob', 'code' => 'ios_zero_impressions',
            'message' => 'AdMob iOS har ' . (int)$ios['req'] . ' requests siste 7 dager, men 0 impressions.'];
    }

    // Sync staleness (only meaningful once a real integration is connected).
    foreach (['admob_last_sync' => 'AdMob', 'adsgram_last_sync' => 'AdsGram'] as $key => $label) {
        $st = $pdo->prepare("SELECT value FROM settings WHERE key=?");
        $st->execute([$key]);
        $v = (string)($st->fetchColumn() ?: '');
        if ($v === '') continue; // never synced yet — "not configured", not an alert
        $ts = strtotime($v);
        if ($ts !== false && (time() - $ts) > 48 * 3600) {
            $alerts[] = ['level' => 'warn', 'area' => strtolower($label), 'code' => 'sync_stale',
                'message' => "$label har ikke synkronisert på over 48 timer (sist: $v)."];
        }
    }

    // Missing credentials (informational, not urgent — surfaced here so Overview
    // doesn't need a second round-trip to Configuration to explain "why is this empty").
    if (!$admobConfigured) {
        $alerts[] = ['level' => 'info', 'area' => 'admob', 'code' => 'not_configured',
            'message' => 'AdMob Reporting API er ikke konfigurert ennå — se Configuration-fanen.'];
    }
    if (!$adsgramConfigured) {
        $alerts[] = ['level' => 'info', 'area' => 'adsgram', 'code' => 'not_configured',
            'message' => 'AdsGram publisher-API-token er ikke konfigurert — CSV-import og provider-callback-data (push-adsgram-events) fungerer uavhengig av dette.'];
    }

    return $alerts;
}

// ── Reward economy valuation (spec §11) ─────────────────────────────────

/**
 * Cost of rewards actually granted in a window, valued at the operator-configured
 * internal price per unit (mon_value_per_*_usd) — 0 by default, meaning "not
 * configured", never a made-up number. Every total this touches is labeled
 * "estimated" per spec §11's explicit instruction.
 */
function am_reward_cost(PDO $pdo, string $from, string $to): array {
    am_init_tables($pdo);
    $cfg = am_config($pdo);
    $st = $pdo->prepare(
        "SELECT reward_type, SUM(reward_amount) AS amount, COUNT(*) AS n,
                COUNT(DISTINCT user_id) AS unique_users
         FROM ad_events WHERE reward_granted=1 AND date(created_at) BETWEEN ? AND ?
         GROUP BY reward_type");
    $st->execute([$from, $to]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    $byType = []; $configured = true; $totalCostUsd = 0.0;
    foreach ($rows as $r) {
        $type = (string)$r['reward_type'];
        $amount = (float)$r['amount'];
        $valuePerUnit = match ($type) {
            'gb'   => (float)$cfg['mon_value_per_gb_usd'],
            'real' => (float)$cfg['mon_value_per_real_usd'],
            'gems' => (float)$cfg['mon_value_per_gem_usd'],
            default => 0.0,
        };
        if ($type === 'gb') $amount = $amount / 1073741824.0; // stored in bytes, valuation is per GB
        $cost = $valuePerUnit > 0 ? round($amount * $valuePerUnit, 4) : null;
        if ($cost === null && $type !== 'farr' && $type !== 'none') $configured = false;
        if ($cost !== null) $totalCostUsd += $cost;
        $byType[] = ['reward_type' => $type, 'amount' => $amount, 'events' => (int)$r['n'],
            'unique_users' => (int)$r['unique_users'], 'value_per_unit_usd' => $valuePerUnit ?: null,
            'estimated_cost_usd' => $cost];
    }
    return ['by_type' => $byType, 'total_estimated_cost_usd' => $configured ? round($totalCostUsd, 4) : null,
            'fully_configured' => $configured];
}
