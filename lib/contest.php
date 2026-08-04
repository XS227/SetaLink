<?php
/**
 * Pre-release 100-invite / $100 USDT contest (Khabat, 2026-08-04): a
 * one-time campaign to drive install volume before launch and load-test the
 * referral pipeline. A referrer who accumulates 100 VERIFIED ACTIVE invites
 * (same definition v1_starlink_unlock() already uses — see
 * contest_active_invite_count() below, the two share one query so "active
 * invite" can never drift into two different meanings) and has connected a
 * TON wallet can claim $100 USDT.
 *
 * Payout is deliberately NOT automatic. contest_claim() only ever creates a
 * 'pending' row in contest_payouts — a human (Khabat) reviews it in the
 * admin panel, sends the USDT himself, and marks it paid. Nothing in this
 * file ever moves real money. This mirrors the existing referral_uses
 * (admin/api.php's referral-approve/reject) and real_redemptions
 * (kind='referral_grant') human-review patterns already used elsewhere in
 * this codebase for exactly the same reason: an automated fraud-detection
 * gap should never translate directly into lost funds.
 */

declare(strict_types=1);

const CONTEST_INVITES_REQUIRED = 100;
const CONTEST_REWARD_USDT      = 100.0;

function contest_ensure_schema(PDO $pdo): void {
    try { $pdo->exec("ALTER TABLE devices ADD COLUMN ton_wallet_address TEXT DEFAULT ''"); }
    catch (\Exception $e) { /* column exists */ }

    $pdo->exec("CREATE TABLE IF NOT EXISTS contest_payouts (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id          TEXT NOT NULL UNIQUE,
        ton_wallet_address TEXT NOT NULL,
        amount_usdt        REAL NOT NULL DEFAULT 100,
        invites_verified   INTEGER NOT NULL DEFAULT 0,
        status             TEXT NOT NULL DEFAULT 'pending', -- pending|approved|paid|rejected
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_by        TEXT DEFAULT NULL,
        reviewed_at        TEXT DEFAULT NULL,
        tx_hash            TEXT DEFAULT NULL,
        note               TEXT DEFAULT NULL
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_contest_payouts_status
                ON contest_payouts(status, created_at)");
}

/**
 * Verified-active-invite count for $deviceId as a referrer. This is the
 * SAME predicate v1_starlink_unlock() uses (public/v1.php) — factored out
 * here so the Starlink gate and the contest threshold can never quietly
 * diverge into two different definitions of "real, active invite". Active
 * means recent proof of life (internet_ok now, or seen within 7 days), not
 * merely "signed up" — this is the anti-fraud bar for both features.
 */
function contest_active_invite_count(PDO $pdo, ?string $deviceId): int {
    if ($deviceId === null || $deviceId === '') return 0;
    $st = $pdo->prepare(
        "SELECT COUNT(*) FROM referral_uses ru
         JOIN devices d ON d.device_id = ru.new_device_id
         WHERE ru.referrer_device_id = ?
           AND ru.status IN ('credited','approved')
           AND (d.internet_ok = 1 OR d.last_seen >= datetime('now','-7 days'))");
    $st->execute([$deviceId]);
    return (int)$st->fetchColumn();
}

/** Full contest status for the money-desk screen. */
function contest_status(PDO $pdo, ?string $deviceId): array {
    $out = [
        'invitesVerified' => 0,
        'invitesRequired' => CONTEST_INVITES_REQUIRED,
        'walletConnected' => false,
        'walletAddress'   => null,
        'qualifies'       => false,
        'claimStatus'     => null, // null = not yet claimed
    ];
    if ($deviceId === null || $deviceId === '') return $out;

    $out['invitesVerified'] = contest_active_invite_count($pdo, $deviceId);

    $dq = $pdo->prepare("SELECT ton_wallet_address FROM devices WHERE device_id = ?");
    $dq->execute([$deviceId]);
    $wallet = (string)($dq->fetchColumn() ?: '');
    $out['walletConnected'] = $wallet !== '';
    $out['walletAddress']   = $wallet !== '' ? $wallet : null;

    $out['qualifies'] = $out['invitesVerified'] >= CONTEST_INVITES_REQUIRED && $out['walletConnected'];

    $cq = $pdo->prepare("SELECT status FROM contest_payouts WHERE device_id = ?");
    $cq->execute([$deviceId]);
    $status = $cq->fetchColumn();
    $out['claimStatus'] = $status !== false ? (string)$status : null;

    return $out;
}

/** Persist the TonConnect wallet address the app reports after connecting. */
function contest_wallet_connect(PDO $pdo, string $deviceId, string $address, string $chain): void {
    $pdo->prepare("UPDATE devices SET ton_wallet_address = ? WHERE device_id = ?")
        ->execute([$address, $deviceId]);
}

/**
 * Idempotent claim: only inserts a 'pending' row when the device genuinely
 * qualifies right now (server-recomputed, never trusts client state). Safe
 * to call repeatedly — UNIQUE(device_id) means a second call after the
 * first succeeded is a silent no-op via INSERT OR IGNORE, and this function
 * never transitions an existing row's status (that's the admin's job).
 */
function contest_claim(PDO $pdo, string $deviceId): array {
    $status = contest_status($pdo, $deviceId);
    if (!$status['qualifies']) {
        return ['claimed' => false, 'reason' => 'not_qualified', 'status' => $status];
    }
    $pdo->prepare(
        "INSERT OR IGNORE INTO contest_payouts
            (device_id, ton_wallet_address, amount_usdt, invites_verified, status)
         VALUES (?, ?, ?, ?, 'pending')")
        ->execute([$deviceId, $status['walletAddress'], CONTEST_REWARD_USDT, $status['invitesVerified']]);
    $status['claimStatus'] = 'pending';
    return ['claimed' => true, 'status' => $status];
}

/** Admin list, newest first, optionally filtered by status. */
function contest_list_payouts(PDO $pdo, ?string $status = null): array {
    if ($status !== null) {
        $st = $pdo->prepare("SELECT * FROM contest_payouts WHERE status = ? ORDER BY created_at DESC");
        $st->execute([$status]);
    } else {
        $st = $pdo->query("SELECT * FROM contest_payouts ORDER BY created_at DESC");
    }
    return $st->fetchAll(PDO::FETCH_ASSOC);
}
