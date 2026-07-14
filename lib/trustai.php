<?php
/**
 * TrustAI referral enrichment — plan item C2 (ECOSYSTEM_INTEGRATION_PLAN.md).
 *
 * Sends referral events (referrer, invitee, fingerprints, local risk flags) to
 * the TrustAI service and consumes back a trust score that replaces the local
 * heuristic risk_score when available.
 *
 * The service is OPTIONAL by design: with no trustai_api_url setting, or when
 * the service errors/times out, every function degrades to null and callers
 * keep the local heuristic. The timeout is short so a slow TrustAI can never
 * block a signup, and a failure can never make a referral MORE trusted than
 * the local score already decided.
 */

const TAI_TIMEOUT_SECS = 3;

// Admin-editable settings; empty url = TrustAI disabled (local scoring only).
const TAI_SETTING_DEFAULTS = [
    'trustai_api_url' => '',
    'trustai_api_key' => '',
];

function trustai_ensure_settings(PDO $pdo): void {
    $ins = $pdo->prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    foreach (TAI_SETTING_DEFAULTS as $k => $v) $ins->execute([$k, $v]);
}

function trustai_config(PDO $pdo): array {
    $st = $pdo->prepare(
        "SELECT key, value FROM settings WHERE key IN ('trustai_api_url','trustai_api_key')"
    );
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_KEY_PAIR) ?: [];
    return [
        'url' => trim((string)($rows['trustai_api_url'] ?? '')),
        'key' => trim((string)($rows['trustai_api_key'] ?? '')),
    ];
}

/**
 * Score a referral event via TrustAI.
 *
 * Returns ['score' => int 0-100, 'flags' => string[]] or null when TrustAI is
 * unconfigured, unreachable, or answers with anything malformed. Callers treat
 * null as "use the local heuristic".
 */
function trustai_score_referral(PDO $pdo, array $event): ?array {
    $cfg = trustai_config($pdo);
    if ($cfg['url'] === '' || !function_exists('curl_init')) return null;

    $ch = curl_init(rtrim($cfg['url'], '/') . '/v1/referral-score');
    $headers = ['Content-Type: application/json'];
    if ($cfg['key'] !== '') $headers[] = 'Authorization: Bearer ' . $cfg['key'];
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($event),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => TAI_TIMEOUT_SECS,
        CURLOPT_CONNECTTIMEOUT => TAI_TIMEOUT_SECS,
    ]);
    $body = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $http !== 200) return null;

    $json = json_decode((string)$body, true);
    if (!is_array($json) || !isset($json['score']) || !is_numeric($json['score'])) return null;

    $flags = [];
    foreach ((array)($json['flags'] ?? []) as $f) {
        if (is_string($f) && $f !== '') $flags[] = substr($f, 0, 64);
    }
    return [
        'score' => max(0, min(100, (int)$json['score'])),
        'flags' => array_slice($flags, 0, 10),
    ];
}
