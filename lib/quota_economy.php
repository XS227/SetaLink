<?php
/**
 * SetaLink Quota Economy — shared ledger / transfer / milestone / package logic.
 *
 * Included by public/api.php (mobile), admin/api.php (admin tools) and
 * scripts/migrate-quota-economy.php. All functions are pure helpers that take a
 * PDO so each caller keeps its own DB bootstrap.
 *
 * Design invariant: for every backfilled device,
 *     devices.quota_bytes_total == SUM(quota_transactions.bytes)
 * The ledger is the source of truth for the breakdown; quota_bytes_total stays
 * the single number the VPN quota enforcement (check-quotas.sh) already reads.
 *
 * Transaction types (quota_transactions.type):
 *   starter_bonus      one-time welcome grant — NEVER transferable
 *   referral_reward    approved referral bonus (either side)
 *   referral_level2    second-level referral bonus (reserved)
 *   purchase           paid package credit
 *   transfer_in        received from another device (positive)
 *   transfer_out       sent to another device (negative)
 *   admin_adjustment   manual admin change / migration reconcile (signed)
 *   promotion          milestone reward / campaign bonus
 */

const QE_GB              = 1073741824;            // 1 GiB
const QE_STARTER_BYTES   = 5368709120;            // 5 GiB welcome grant (non-transferable) — matches "5 GB free" marketing
const QE_MIN_TRANSFER    = 104857600;             // 100 MiB minimum transfer
const QE_DAILY_MAX_BYTES = 53687091200;           // 50 GiB/day sent per device (anti-fraud)
const QE_DAILY_MAX_COUNT = 10;                    // 10 transfers/day per device (anti-fraud)

const QE_CREDIT_TYPES = [
    'starter_bonus', 'referral_reward', 'referral_level2',
    'purchase', 'purchase_real', 'purchase_usdt',
    'transfer_in', 'admin_adjustment', 'promotion',
    'ad_reward',
];

/**
 * Referral milestone ladder (Fibonacci). Each milestone grants a one-time quota
 * reward, a cosmetic badge, a stealth-profile unlock, and reserves room for
 * future rewards. Only APPROVED referrals (status credited|approved) count.
 */
function qe_milestones(): array {
    return [
        ['count' => 3,  'bytes' => 1  * QE_GB, 'stealth' => true, 'badge' => 'scout',      'rewardKey' => 'first_stealth'],
        ['count' => 5,  'bytes' => 2  * QE_GB, 'stealth' => true, 'badge' => 'connector',  'rewardKey' => 'bonus2'],
        ['count' => 8,  'bytes' => 3  * QE_GB, 'stealth' => true, 'badge' => 'builder',    'rewardKey' => 'priority'],
        ['count' => 13, 'bytes' => 5  * QE_GB, 'stealth' => true, 'badge' => 'influencer', 'rewardKey' => 'bonus5'],
        ['count' => 21, 'bytes' => 8  * QE_GB, 'stealth' => true, 'badge' => 'champion',   'rewardKey' => 'vip'],
        ['count' => 34, 'bytes' => 13 * QE_GB, 'stealth' => true, 'badge' => 'legend',     'rewardKey' => 'bonus13'],
        ['count' => 55, 'bytes' => 21 * QE_GB, 'stealth' => true, 'badge' => 'icon',       'rewardKey' => 'elite'],
    ];
}

// ── Schema ─────────────────────────────────────────────────────────────────

function qe_init_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS quota_transactions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id  TEXT    NOT NULL,
        type       TEXT    NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        metadata   TEXT    NOT NULL DEFAULT ''
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_qtx_device ON quota_transactions(device_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_qtx_type   ON quota_transactions(device_id, type)");

    $pdo->exec("CREATE TABLE IF NOT EXISTS quota_transfer (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_device   TEXT    NOT NULL,
        receiver_device TEXT    NOT NULL,
        bytes           INTEGER NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'completed',
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        metadata        TEXT    NOT NULL DEFAULT ''
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_xfer_sender ON quota_transfer(sender_device)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_xfer_recv   ON quota_transfer(receiver_device)");

    $pdo->exec("CREATE TABLE IF NOT EXISTS purchased_packages (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id         TEXT    NOT NULL,
        package_name      TEXT    NOT NULL,
        bytes             INTEGER NOT NULL DEFAULT 0,
        purchase_date     TEXT    NOT NULL DEFAULT (datetime('now')),
        payment_reference TEXT    NOT NULL DEFAULT '',
        created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_pkg_device ON purchased_packages(device_id)");

    $pdo->exec("CREATE TABLE IF NOT EXISTS milestone_claims (
        device_id  TEXT    NOT NULL,
        milestone  INTEGER NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (device_id, milestone)
    )");

    // Marks a device whose historical quota has been reconstructed into the ledger.
    try { $pdo->exec("ALTER TABLE devices ADD COLUMN ledger_backfilled INTEGER DEFAULT 0"); } catch (\Exception $e) {}
}

// ── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Reconstruct the ledger for a legacy device so the breakdown invariant holds.
 * Idempotent: runs once per device (guarded by devices.ledger_backfilled).
 *
 * Strategy:
 *   starter_bonus  = min(1 GiB, total)
 *   referral_reward= capped sum of approved referral bonuses (either side)
 *   admin_adjustment = remainder so SUM(ledger) == total exactly
 *   milestone_claims = all already-reached milestones recorded with bytes=0
 *                      (no retroactive quota grant — avoids one-time inflation)
 */
function qe_backfill(PDO $pdo, string $deviceId): void {
    $dev = qe_fetch_device($pdo, $deviceId);
    if (!$dev || (int)($dev['ledger_backfilled'] ?? 0) === 1) return;

    $total = max(0, (int)$dev['quota_bytes_total']);

    $starter = min(QE_STARTER_BYTES, $total);
    $referral = 0;
    try {
        $st = $pdo->prepare(
            "SELECT COALESCE(SUM(bonus_bytes),0) FROM referral_uses
             WHERE status IN ('credited','approved')
               AND (referrer_device_id=? OR new_device_id=?)");
        $st->execute([$deviceId, $deviceId]);
        $referral = (int)$st->fetchColumn();
    } catch (\Exception $e) { $referral = 0; }
    // Never let starter+referral exceed the historical total.
    $referral = max(0, min($referral, $total - $starter));
    $remainder = $total - $starter - $referral;

    // Participate in an outer transaction if one is already open (e.g. when
    // reached from qe_transfer); otherwise own the transaction here.
    $ownTxn = !$pdo->inTransaction();
    if ($ownTxn) $pdo->beginTransaction();
    try {
        if ($starter > 0)  qe_raw_insert($pdo, $deviceId, 'starter_bonus',   $starter,   'migration backfill');
        if ($referral > 0) qe_raw_insert($pdo, $deviceId, 'referral_reward', $referral,  'migration backfill');
        if ($remainder !== 0) qe_raw_insert($pdo, $deviceId, 'admin_adjustment', $remainder, 'migration reconcile');

        // Record already-reached milestones as claimed (no quota granted) so the
        // milestone evaluator never retroactively inflates legacy accounts.
        $invites = qe_approved_invite_count($pdo, $deviceId);
        $claim = $pdo->prepare(
            "INSERT OR IGNORE INTO milestone_claims (device_id, milestone, bytes, claimed_at)
             VALUES (?, ?, 0, datetime('now'))");
        foreach (qe_milestones() as $ms) {
            if ($invites >= $ms['count']) $claim->execute([$deviceId, $ms['count']]);
        }

        $pdo->prepare("UPDATE devices SET ledger_backfilled=1 WHERE device_id=?")->execute([$deviceId]);
        if ($ownTxn) $pdo->commit();
    } catch (\Exception $e) {
        if ($ownTxn && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/** Insert a ledger row WITHOUT touching quota_bytes_total (used during backfill,
 *  where the total already reflects the reconstructed sum). */
function qe_raw_insert(PDO $pdo, string $deviceId, string $type, int $bytes, string $meta = ''): void {
    $pdo->prepare(
        "INSERT INTO quota_transactions (device_id, type, bytes, metadata) VALUES (?, ?, ?, ?)"
    )->execute([$deviceId, $type, $bytes, $meta]);
}

// ── Ledger writes ──────────────────────────────────────────────────────────

/**
 * Append a ledger entry AND adjust devices.quota_bytes_total by the same signed
 * amount, keeping the invariant. Ensures the device is backfilled first.
 * Returns the new quota_bytes_total.
 */
function qe_ledger_add(PDO $pdo, string $deviceId, string $type, int $bytes, string $meta = ''): int {
    qe_backfill($pdo, $deviceId);
    qe_raw_insert($pdo, $deviceId, $type, $bytes, $meta);
    $pdo->prepare("UPDATE devices SET quota_bytes_total = MAX(0, quota_bytes_total + ?) WHERE device_id=?")
        ->execute([$bytes, $deviceId]);
    $row = $pdo->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?");
    $row->execute([$deviceId]);
    return (int)$row->fetchColumn();
}

// ── Reads ────────────────────────────────────────────────────────────────────

function qe_fetch_device(PDO $pdo, string $deviceId): ?array {
    $st = $pdo->prepare("SELECT * FROM devices WHERE device_id=?");
    $st->execute([$deviceId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Batched badge info (VIP/verified/premium) for a set of OTHER users' devices
 * — one query total, regardless of how many device ids are passed. Built so
 * peer-facing surfaces (DM chat list, thread header, and later profile/
 * search/member-list views) can show a correct badge without an N+1 lookup
 * per row (2026-07-20, Khabat).
 *
 * isVip/vipTier: reuses the exact same qe_milestones() ladder
 * qe_milestone_progress() already evaluates for the CURRENT user's own
 * profile, but reads devices.invite_count directly instead of recomputing
 * from referral_uses — that column is already a maintained cache (kept in
 * sync wherever a referral is credited, see the 'Update invite_count cache'
 * write in public/api.php) with the identical status IN ('credited',
 * 'approved') filter, so this stays consistent with the profile screen's
 * own numbers without a second aggregate query. vipTier is the highest
 * reached of 'vip' (21 invites) / 'elite' (55 invites).
 *
 * verified/premiumUntil: a confirmed paying subscriber (plan != 'free'),
 * premiumUntil = devices.valid_until while on a paid plan. Deliberately NOT
 * the same thing as the official-support blue checkmark already shown in
 * the client (that's computed from SUPPORT_USER_ID, not a per-user field,
 * and untouched by this).
 *
 * Every requested device id is present in the result (defaulted to the
 * "regular user" shape even if the row doesn't exist), so callers never
 * need a null-check before reading a peer's badge.
 *
 * @return array<string, array{isVip: bool, vipTier: ?string, verified: bool, premiumUntil: ?string}>
 */
function qe_badge_info_for_devices(PDO $pdo, array $deviceIds): array {
    $ids = array_values(array_unique(array_filter($deviceIds, fn($d) => $d !== '')));
    $out = [];
    foreach ($ids as $id) {
        $out[$id] = ['isVip' => false, 'vipTier' => null, 'verified' => false, 'premiumUntil' => null];
    }
    if (!$ids) return $out;

    $tiers = array_values(array_filter(
        qe_milestones(),
        fn($ms) => in_array($ms['rewardKey'], ['vip', 'elite'], true)
    ));

    $ph = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT device_id, invite_count, plan, valid_until FROM devices WHERE device_id IN ($ph)");
    $st->execute($ids);

    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $invites = (int)($row['invite_count'] ?? 0);
        $tier = null;
        foreach ($tiers as $ms) {
            if ($invites >= $ms['count']) $tier = $ms['rewardKey'];
        }
        $plan = (string)($row['plan'] ?? 'free');
        $verified = $plan !== 'free';
        $out[$row['device_id']] = [
            'isVip'        => $tier !== null,
            'vipTier'      => $tier,
            'verified'     => $verified,
            'premiumUntil' => $verified ? ($row['valid_until'] ?? null) : null,
        ];
    }
    return $out;
}

function qe_approved_invite_count(PDO $pdo, string $deviceId): int {
    $st = $pdo->prepare(
        "SELECT COUNT(*) FROM referral_uses WHERE referrer_device_id=? AND status IN ('credited','approved')");
    $st->execute([$deviceId]);
    return (int)$st->fetchColumn();
}

/**
 * Full quota breakdown for a device. All values are bytes.
 *   starter_quota      non-transferable welcome grant
 *   referral_quota     referral_reward + referral_level2
 *   purchased_quota    purchase
 *   total_quota        devices.quota_bytes_total (== SUM of ledger)
 *   transferable_quota max(0, min(remaining, total - starter)) — starter excluded
 */
function qe_summary(PDO $pdo, string $deviceId): array {
    qe_backfill($pdo, $deviceId);
    $dev = qe_fetch_device($pdo, $deviceId);
    if (!$dev) {
        return [
            'starter_quota' => 0, 'referral_quota' => 0, 'purchased_quota' => 0,
            'promotion_quota' => 0, 'ad_reward_quota' => 0,
            'transfer_in_quota' => 0, 'transfer_out_quota' => 0,
            'adjustment_quota' => 0, 'total_quota' => 0, 'used_quota' => 0,
            'remaining_quota' => 0, 'transferable_quota' => 0,
        ];
    }
    $sums = [];
    $st = $pdo->prepare("SELECT type, COALESCE(SUM(bytes),0) AS s FROM quota_transactions WHERE device_id=? GROUP BY type");
    $st->execute([$deviceId]);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $sums[$r['type']] = (int)$r['s'];

    $starter   = max(0, $sums['starter_bonus']    ?? 0);
    $referral  = ($sums['referral_reward'] ?? 0) + ($sums['referral_level2'] ?? 0);
    $purchased = $sums['purchase']          ?? 0;
    $promotion = $sums['promotion']         ?? 0;
    $adReward  = $sums['ad_reward']         ?? 0;
    $transIn   = $sums['transfer_in']       ?? 0;
    $transOut  = $sums['transfer_out']      ?? 0; // negative
    $adjust    = $sums['admin_adjustment']  ?? 0;

    $total     = (int)$dev['quota_bytes_total'];
    $used      = max(0, (int)$dev['quota_bytes_used']);
    $remaining = max(0, $total - $used);
    // Starter is never transferable. You also can't transfer data already used.
    $transferable = max(0, min($remaining, $total - $starter));

    return [
        'starter_quota'      => $starter,
        'referral_quota'     => $referral,
        'purchased_quota'    => $purchased,
        'promotion_quota'    => $promotion,
        'ad_reward_quota'    => $adReward,
        'transfer_in_quota'  => $transIn,
        'transfer_out_quota' => $transOut,
        'adjustment_quota'   => $adjust,
        'total_quota'        => $total,
        'used_quota'         => $used,
        'remaining_quota'    => $remaining,
        'transferable_quota' => $transferable,
    ];
}

/** Purchased packages list for a device (newest first). */
function qe_packages(PDO $pdo, string $deviceId): array {
    qe_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT id, package_name, bytes, purchase_date, payment_reference
         FROM purchased_packages WHERE device_id=? ORDER BY id DESC");
    $st->execute([$deviceId]);
    return array_map(static function ($r) {
        return [
            'id'                => (int)$r['id'],
            'package_name'      => $r['package_name'],
            'bytes'             => (int)$r['bytes'],
            'purchase_date'     => $r['purchase_date'],
            'payment_reference' => $r['payment_reference'],
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
}

// ── Milestones ─────────────────────────────────────────────────────────────

/**
 * Grant any newly-reached milestone rewards (idempotent). Returns the list of
 * milestone counts granted in this call. Stealth unlock + quota credit applied.
 */
function qe_evaluate_milestones(PDO $pdo, string $deviceId): array {
    qe_backfill($pdo, $deviceId);
    $invites = qe_approved_invite_count($pdo, $deviceId);
    $granted = [];
    $has = $pdo->prepare("SELECT 1 FROM milestone_claims WHERE device_id=? AND milestone=?");
    foreach (qe_milestones() as $ms) {
        if ($invites < $ms['count']) continue;
        $has->execute([$deviceId, $ms['count']]);
        if ($has->fetchColumn()) continue;
        $pdo->prepare(
            "INSERT OR IGNORE INTO milestone_claims (device_id, milestone, bytes) VALUES (?, ?, ?)"
        )->execute([$deviceId, $ms['count'], (int)$ms['bytes']]);
        if ((int)$ms['bytes'] > 0) {
            qe_ledger_add($pdo, $deviceId, 'promotion', (int)$ms['bytes'], 'milestone ' . $ms['count']);
        }
        if (!empty($ms['stealth'])) {
            $pdo->prepare("UPDATE devices SET stealth_unlocked=1 WHERE device_id=?")->execute([$deviceId]);
        }
        $granted[] = $ms['count'];
    }
    return $granted;
}

/** Milestone progress payload for the profile screen. */
function qe_milestone_progress(PDO $pdo, string $deviceId): array {
    $invites = qe_approved_invite_count($pdo, $deviceId);
    $milestones = qe_milestones();
    $claimed = [];
    $st = $pdo->prepare("SELECT milestone FROM milestone_claims WHERE device_id=?");
    $st->execute([$deviceId]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $m) $claimed[(int)$m] = true;

    $current = 0; $next = null; $prevCount = 0;
    foreach ($milestones as $ms) {
        if ($invites >= $ms['count']) { $current = $ms['count']; $prevCount = $ms['count']; }
        elseif ($next === null)       { $next = $ms; }
    }
    $progress = 1.0;
    if ($next !== null) {
        $span = $next['count'] - $prevCount;
        $progress = $span > 0 ? max(0.0, min(1.0, ($invites - $prevCount) / $span)) : 0.0;
    }

    $list = array_map(static function ($ms) use ($invites, $claimed) {
        return [
            'count'     => $ms['count'],
            'bytes'     => (int)$ms['bytes'],
            'badge'     => $ms['badge'],
            'rewardKey' => $ms['rewardKey'],
            'reached'   => $invites >= $ms['count'],
            'claimed'   => isset($claimed[$ms['count']]),
        ];
    }, $milestones);

    return [
        'invite_count'      => $invites,
        'current_milestone' => $current,
        'next_milestone'    => $next ? $next['count'] : null,
        'next_reward_key'   => $next ? $next['rewardKey'] : null,
        'next_reward_bytes' => $next ? (int)$next['bytes'] : 0,
        'progress'          => round($progress, 4),
        'milestones'        => $list,
    ];
}

// ── Transfers ────────────────────────────────────────────────────────────────

/** Resolve a recipient string (device_id | user_id | referral_code) to a device row. */
function qe_resolve_device(PDO $pdo, string $param): ?array {
    $param = trim($param);
    if ($param === '') return null;
    $st = $pdo->prepare(
        "SELECT * FROM devices
         WHERE device_id=? OR UPPER(user_id)=UPPER(?) OR UPPER(referral_code)=UPPER(?)
         LIMIT 1");
    $st->execute([$param, $param, $param]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

/**
 * Atomically transfer quota from sender to receiver.
 * Throws \RuntimeException with a client-safe message on validation failure.
 * Returns ['transfer_id', 'bytes', 'receiver_device', 'receiver_user_id', 'sender'].
 */
function qe_transfer(PDO $pdo, string $senderDevice, string $receiverParam, int $bytes, string $meta = ''): array {
    qe_init_tables($pdo);
    $sender = qe_fetch_device($pdo, $senderDevice);
    if (!$sender)                        throw new \RuntimeException('sender not found');
    if ((int)($sender['blocked'] ?? 0)) throw new \RuntimeException('sender is blocked');

    $receiver = qe_resolve_device($pdo, $receiverParam);
    if (!$receiver)                                   throw new \RuntimeException('recipient not found');
    if ($receiver['device_id'] === $senderDevice)     throw new \RuntimeException('cannot transfer to yourself');
    if ((int)($receiver['blocked'] ?? 0))             throw new \RuntimeException('recipient is blocked');

    if ($bytes < QE_MIN_TRANSFER) throw new \RuntimeException('minimum transfer is 100 MB');

    // Anti-fraud: per-device daily caps (count + volume).
    $cap = $pdo->prepare(
        "SELECT COUNT(*) AS c, COALESCE(SUM(bytes),0) AS s FROM quota_transfer
         WHERE sender_device=? AND status='completed' AND created_at >= datetime('now','-1 day')");
    $cap->execute([$senderDevice]);
    $capRow = $cap->fetch(PDO::FETCH_ASSOC) ?: ['c' => 0, 's' => 0];
    if ((int)$capRow['c'] >= QE_DAILY_MAX_COUNT)              throw new \RuntimeException('daily transfer limit reached');
    if ((int)$capRow['s'] + $bytes > QE_DAILY_MAX_BYTES)     throw new \RuntimeException('daily transfer volume limit reached');

    $pdo->beginTransaction();
    try {
        // Re-check transferable balance inside the transaction.
        $summary = qe_summary($pdo, $senderDevice);
        if ($bytes > $summary['transferable_quota']) {
            $pdo->rollBack();
            throw new \RuntimeException('insufficient transferable quota');
        }
        qe_ledger_add($pdo, $senderDevice, 'transfer_out', -$bytes, 'to ' . $receiver['device_id']);
        qe_ledger_add($pdo, $receiver['device_id'], 'transfer_in', $bytes, 'from ' . $senderDevice);
        $pdo->prepare(
            "INSERT INTO quota_transfer (sender_device, receiver_device, bytes, status, metadata)
             VALUES (?, ?, ?, 'completed', ?)"
        )->execute([$senderDevice, $receiver['device_id'], $bytes, $meta]);
        $transferId = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (\RuntimeException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    } catch (\Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw new \RuntimeException('transfer failed');
    }

    return [
        'transfer_id'      => $transferId,
        'bytes'            => $bytes,
        'receiver_device'  => $receiver['device_id'],
        'receiver_user_id' => $receiver['user_id'] ?? '',
        'sender'           => qe_summary($pdo, $senderDevice),
    ];
}

/** Transfer history for a device (both sent and received), newest first. */
function qe_transfer_history(PDO $pdo, string $deviceId, int $limit = 50): array {
    qe_init_tables($pdo);
    $st = $pdo->prepare(
        "SELECT t.id, t.sender_device, t.receiver_device, t.bytes, t.status, t.created_at,
                ds.user_id AS sender_user_id, dr.user_id AS receiver_user_id
         FROM quota_transfer t
         LEFT JOIN devices ds ON ds.device_id = t.sender_device
         LEFT JOIN devices dr ON dr.device_id = t.receiver_device
         WHERE t.sender_device=? OR t.receiver_device=?
         ORDER BY t.id DESC LIMIT ?");
    $st->bindValue(1, $deviceId);
    $st->bindValue(2, $deviceId);
    $st->bindValue(3, max(1, min(200, $limit)), PDO::PARAM_INT);
    $st->execute();
    return array_map(static function ($r) use ($deviceId) {
        return [
            'id'               => (int)$r['id'],
            'direction'        => $r['sender_device'] === $deviceId ? 'out' : 'in',
            'sender_device'    => $r['sender_device'],
            'receiver_device'  => $r['receiver_device'],
            'sender_user_id'   => $r['sender_user_id']   ?? '',
            'receiver_user_id' => $r['receiver_user_id'] ?? '',
            'bytes'            => (int)$r['bytes'],
            'status'           => $r['status'],
            'created_at'       => $r['created_at'],
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
}

/**
 * Credit a purchased package (admin / payment-approval path). Writes the
 * purchased_packages row and a 'purchase' ledger entry. Returns new total.
 */
function qe_credit_purchase(PDO $pdo, string $deviceId, string $packageName, int $bytes, string $paymentRef = ''): int {
    qe_init_tables($pdo);
    if ($bytes <= 0) throw new \RuntimeException('package bytes must be positive');
    $pdo->prepare(
        "INSERT INTO purchased_packages (device_id, package_name, bytes, payment_reference)
         VALUES (?, ?, ?, ?)"
    )->execute([$deviceId, $packageName, $bytes, $paymentRef]);
    return qe_ledger_add($pdo, $deviceId, 'purchase', $bytes, 'package ' . $packageName . ($paymentRef ? ' ref ' . $paymentRef : ''));
}

/**
 * Credit a package paid on-chain (REAL or USDT). Records the purchased_packages row
 * and a typed ledger entry ('purchase_real' | 'purchase_usdt') whose metadata carries
 * the payment_id and tx_hash for audit. Returns new total. $type is validated.
 */
function qe_credit_payment(PDO $pdo, string $deviceId, string $packageName, int $bytes, string $type, int $paymentId, string $txHash): int {
    qe_init_tables($pdo);
    if ($bytes <= 0) throw new \RuntimeException('package bytes must be positive');
    if (!in_array($type, ['purchase_real', 'purchase_usdt'], true)) throw new \RuntimeException('invalid payment type');
    $pdo->prepare(
        "INSERT INTO purchased_packages (device_id, package_name, bytes, payment_reference)
         VALUES (?, ?, ?, ?)"
    )->execute([$deviceId, $packageName, $bytes, ($txHash ?: 'payment#' . $paymentId)]);
    $meta = 'payment#' . $paymentId . ($txHash ? ' tx ' . $txHash : '');
    return qe_ledger_add($pdo, $deviceId, $type, $bytes, $meta);
}

/**
 * Re-sync the ledger to quota_bytes_total after a path wrote the total directly
 * (legacy admin subscription approval, manual device-set-quota). Records the
 * difference as an admin_adjustment so SUM(ledger) == total stays true.
 */
function qe_reconcile(PDO $pdo, string $deviceId, string $meta = 'admin reconcile'): void {
    qe_backfill($pdo, $deviceId);
    $dev = qe_fetch_device($pdo, $deviceId);
    if (!$dev) return;
    $total = (int)$dev['quota_bytes_total'];
    $st = $pdo->prepare("SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE device_id=?");
    $st->execute([$deviceId]);
    $delta = $total - (int)$st->fetchColumn();
    if ($delta !== 0) qe_raw_insert($pdo, $deviceId, 'admin_adjustment', $delta, $meta);
}

/**
 * Admin review tool: reverse a completed transfer. Best-effort — claws back only
 * what the receiver still holds (clamped to their total) and refunds the sender
 * the same amount, keeping both ledgers consistent. Marks the row 'reversed'.
 */
function qe_reverse_transfer(PDO $pdo, int $transferId, string $meta = 'admin reversal'): array {
    qe_init_tables($pdo);
    $st = $pdo->prepare("SELECT * FROM quota_transfer WHERE id=?");
    $st->execute([$transferId]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t)                          throw new \RuntimeException('transfer not found');
    if ($t['status'] !== 'completed') throw new \RuntimeException('transfer is not reversible');

    $bytes    = (int)$t['bytes'];
    $receiver = qe_fetch_device($pdo, $t['receiver_device']);
    $clawback = $receiver ? max(0, min($bytes, (int)$receiver['quota_bytes_total'])) : 0;

    $ownTxn = !$pdo->inTransaction();
    if ($ownTxn) $pdo->beginTransaction();
    try {
        if ($clawback > 0) {
            qe_ledger_add($pdo, $t['receiver_device'], 'transfer_out', -$clawback, 'reversal of #' . $transferId);
            qe_ledger_add($pdo, $t['sender_device'],   'transfer_in',   $clawback, 'reversal of #' . $transferId);
        }
        $pdo->prepare("UPDATE quota_transfer SET status='reversed', metadata=? WHERE id=?")
            ->execute([$meta . ' (clawed ' . $clawback . ')', $transferId]);
        if ($ownTxn) $pdo->commit();
    } catch (\Exception $e) {
        if ($ownTxn && $pdo->inTransaction()) $pdo->rollBack();
        throw new \RuntimeException('reversal failed');
    }
    return ['transfer_id' => $transferId, 'reversed_bytes' => $clawback, 'requested_bytes' => $bytes];
}
