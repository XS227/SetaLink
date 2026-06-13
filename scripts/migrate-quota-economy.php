<?php
// One-shot migration for v0.9.31 quota economy.
// Creates the ledger / transfer / package / milestone tables and reconstructs a
// quota_transactions ledger for every existing device so the breakdown invariant
//   devices.quota_bytes_total == SUM(quota_transactions.bytes)
// holds. Idempotent — safe to re-run; already-backfilled devices are skipped.
//
// Usage:  php scripts/migrate-quota-economy.php [/path/to/analytics.db]

require_once __DIR__ . '/../lib/quota_economy.php';

$dbPath = $argv[1] ?? (__DIR__ . '/../data/analytics.db');
if (!file_exists($dbPath)) {
    fwrite(STDERR, "DB not found: $dbPath\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath, null, null, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec("PRAGMA journal_mode=WAL");

echo "Creating quota-economy tables…\n";
qe_init_tables($pdo);

$ids = $pdo->query("SELECT device_id FROM devices")->fetchAll(PDO::FETCH_COLUMN);
echo "Found " . count($ids) . " devices.\n";

$done = 0; $skipped = 0; $errors = 0; $mismatch = 0;
foreach ($ids as $id) {
    try {
        $before = (int)$pdo->query("SELECT ledger_backfilled FROM devices WHERE device_id=" . $pdo->quote($id))->fetchColumn();
        if ($before === 1) { $skipped++; continue; }
        qe_backfill($pdo, $id);
        // Verify the invariant.
        $st = $pdo->prepare("SELECT quota_bytes_total FROM devices WHERE device_id=?");
        $st->execute([$id]);
        $total = (int)$st->fetchColumn();
        $st = $pdo->prepare("SELECT COALESCE(SUM(bytes),0) FROM quota_transactions WHERE device_id=?");
        $st->execute([$id]);
        $sum = (int)$st->fetchColumn();
        if ($sum !== $total) { $mismatch++; fwrite(STDERR, "  MISMATCH $id: ledger=$sum total=$total\n"); }
        $done++;
    } catch (\Exception $e) {
        $errors++;
        fwrite(STDERR, "  ERROR $id: " . $e->getMessage() . "\n");
    }
}

echo "\nBackfilled: $done   Skipped (already done): $skipped   Errors: $errors   Invariant mismatches: $mismatch\n";
exit($errors === 0 && $mismatch === 0 ? 0 : 1);
