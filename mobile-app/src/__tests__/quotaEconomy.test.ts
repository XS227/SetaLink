import {
  ONE_GB, MIN_TRANSFER_BYTES, computeTransferable, validateTransferAmount, normalizeDigits,
} from '../utils/quotaEconomy';
import type { QuotaSummary } from '../services/entitlementService';

function summary(over: Partial<QuotaSummary>): QuotaSummary {
  return {
    starter_quota: ONE_GB, referral_quota: 0, purchased_quota: 0, promotion_quota: 0,
    transfer_in_quota: 0, transfer_out_quota: 0, adjustment_quota: 0,
    total_quota: ONE_GB, used_quota: 0, remaining_quota: ONE_GB, transferable_quota: 0,
    ...over,
  };
}

describe('computeTransferable', () => {
  it('returns 0 for null user', () => {
    expect(computeTransferable(null)).toBe(0);
  });

  it('prefers the server ledger transferable_quota', () => {
    const u = { quota: summary({ transferable_quota: 2 * ONE_GB }), quotaBytesTotal: 5 * ONE_GB, quotaBytesUsed: 0 };
    expect(computeTransferable(u)).toBe(2 * ONE_GB);
  });

  it('never returns a negative server value', () => {
    const u = { quota: summary({ transferable_quota: -100 }), quotaBytesTotal: ONE_GB, quotaBytesUsed: 0 };
    expect(computeTransferable(u)).toBe(0);
  });

  it('falls back to total - starter when no ledger (starter not transferable)', () => {
    const u = { quota: null, quotaBytesTotal: 3 * ONE_GB, quotaBytesUsed: 0 };
    expect(computeTransferable(u)).toBe(2 * ONE_GB);
  });

  it('starter-only device has nothing transferable', () => {
    const u = { quota: null, quotaBytesTotal: ONE_GB, quotaBytesUsed: 0 };
    expect(computeTransferable(u)).toBe(0);
  });

  it('used data reduces transferable in the fallback path', () => {
    const u = { quota: null, quotaBytesTotal: 3 * ONE_GB, quotaBytesUsed: Math.round(2.5 * ONE_GB) };
    // remaining 0.5 GiB < (total - starter = 2 GiB) → capped at remaining
    expect(computeTransferable(u)).toBe(Math.round(0.5 * ONE_GB));
  });
});

describe('validateTransferAmount', () => {
  const avail = 5 * ONE_GB;

  it('rejects non-numeric input', () => {
    expect(validateTransferAmount('abc', avail)).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects zero / negative', () => {
    expect(validateTransferAmount('0', avail)).toEqual({ ok: false, error: 'invalid' });
    expect(validateTransferAmount('-2', avail)).toEqual({ ok: false, error: 'invalid' });
  });

  it('rejects below the 100 MB minimum', () => {
    expect(validateTransferAmount('0.05', avail)).toEqual({ ok: false, error: 'below_min' });
  });

  it('accepts exactly the minimum (0.1 GB = 100 MiB)', () => {
    const r = validateTransferAmount('0.1', avail);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBeGreaterThanOrEqual(MIN_TRANSFER_BYTES);
  });

  it('rejects amounts above the available balance', () => {
    expect(validateTransferAmount('6', avail)).toEqual({ ok: false, error: 'above_max' });
  });

  it('accepts a valid mid-range amount and returns bytes', () => {
    const r = validateTransferAmount('2', avail);
    expect(r).toEqual({ ok: true, bytes: 2 * ONE_GB });
  });

  it('accepts comma decimal separator', () => {
    const r = validateTransferAmount('1,5', avail);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBe(Math.round(1.5 * ONE_GB));
  });

  // BUG-2: Farsi/Arabic keyboards send localized digits. parseFloat would read
  // "۱۰" as NaN, leaving the Continue button effectively dead.
  it('accepts Persian (Farsi) digits — the dead-button repro', () => {
    const r = validateTransferAmount('۱۰', avail); // ۱۰ = 10, but available is 5
    expect(r).toEqual({ ok: false, error: 'above_max' }); // parsed as 10, not NaN
  });

  it('accepts a valid Persian-digit amount within balance', () => {
    const r = validateTransferAmount('۲', avail); // ۲ = 2
    expect(r).toEqual({ ok: true, bytes: 2 * ONE_GB });
  });

  it('accepts Arabic-Indic digits with the Arabic decimal separator', () => {
    const r = validateTransferAmount('١٫٥', avail); // ١٫٥ = 1.5
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBe(Math.round(1.5 * ONE_GB));
  });
});

describe('normalizeDigits', () => {
  it('converts Persian digits to ASCII', () => {
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });
  it('converts the Arabic decimal separator to a dot', () => {
    expect(normalizeDigits('۱٫۵')).toBe('1.5');
  });
  it('leaves ASCII input unchanged', () => {
    expect(normalizeDigits('12.5')).toBe('12.5');
  });
});
