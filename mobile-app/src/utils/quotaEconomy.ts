// Pure client-side helpers for the v0.9.31 quota economy. Kept free of React /
// network so they can be unit-tested in isolation. The server (lib/quota_economy.php)
// remains authoritative — these only mirror its rules for snappy UI validation.

import type { QuotaSummary } from '../services/entitlementService';

export const ONE_GB = 1024 * 1024 * 1024;

/** Minimum transferable amount in bytes (100 MiB) — mirrors QE_MIN_TRANSFER. */
export const MIN_TRANSFER_BYTES = 104857600;

export interface TransferableSource {
  quota: QuotaSummary | null;
  quotaBytesTotal: number;
  quotaBytesUsed: number;
}

/**
 * Bytes this device can send. Prefers the server ledger's transferable_quota
 * (starter excluded). Falls back to a local estimate when no ledger is present:
 *   max(0, min(remaining, total - starter))   with starter = min(1 GiB, total)
 */
export function computeTransferable(u: TransferableSource | null | undefined): number {
  if (!u) return 0;
  if (u.quota) return Math.max(0, u.quota.transferable_quota);
  const starter   = Math.min(ONE_GB, u.quotaBytesTotal);
  const remaining = Math.max(0, u.quotaBytesTotal - u.quotaBytesUsed);
  return Math.max(0, Math.min(remaining, u.quotaBytesTotal - starter));
}

export type AmountError = 'invalid' | 'below_min' | 'above_max';
export type AmountValidation =
  | { ok: true; bytes: number }
  | { ok: false; error: AmountError };

/**
 * Validate a GB amount string against the available transferable balance.
 * Accepts comma or dot decimal separators. Returns the byte amount on success.
 */
export function validateTransferAmount(amountStr: string, availableBytes: number): AmountValidation {
  const gb = parseFloat(String(amountStr).replace(',', '.'));
  if (!isFinite(gb) || gb <= 0) return { ok: false, error: 'invalid' };
  const bytes = Math.round(gb * ONE_GB);
  if (bytes < MIN_TRANSFER_BYTES) return { ok: false, error: 'below_min' };
  if (bytes > availableBytes)     return { ok: false, error: 'above_max' };
  return { ok: true, bytes };
}
