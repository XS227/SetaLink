/**
 * Tap-to-earn ZAR economics: +1 per tap, hard daily cap, UTC-day reset.
 */

import { applyTap, dayKeyOf, ZAR_DAILY_CAP, ZAR_PER_TAP } from '../stores/zarStore';

const at = (iso: string) => new Date(iso);

describe('ZAR tap-to-earn', () => {
  it('earns ZAR_PER_TAP per tap and accumulates balance', () => {
    let s = { balance: 0, earnedToday: 0, dayKey: '' };
    const r1 = applyTap(s, at('2026-07-13T10:00:00Z'));
    expect(r1.result).toEqual({ earned: ZAR_PER_TAP, capped: false });
    s = r1.next;
    const r2 = applyTap(s, at('2026-07-13T10:00:01Z'));
    expect(r2.next.balance).toBe(2 * ZAR_PER_TAP);
    expect(r2.next.earnedToday).toBe(2 * ZAR_PER_TAP);
  });

  it('stops earning at the daily cap but keeps the balance', () => {
    const s = { balance: 900, earnedToday: ZAR_DAILY_CAP, dayKey: '2026-07-13' };
    const r = applyTap(s, at('2026-07-13T23:59:00Z'));
    expect(r.result).toEqual({ earned: 0, capped: true });
    expect(r.next.balance).toBe(900);
  });

  it('resets the daily counter on a new UTC day, balance persists', () => {
    const s = { balance: 500, earnedToday: ZAR_DAILY_CAP, dayKey: '2026-07-13' };
    const r = applyTap(s, at('2026-07-14T00:00:01Z'));
    expect(r.result.capped).toBe(false);
    expect(r.next.balance).toBe(500 + ZAR_PER_TAP);
    expect(r.next.earnedToday).toBe(ZAR_PER_TAP);
    expect(r.next.dayKey).toBe('2026-07-14');
  });

  it('dayKeyOf is a UTC date string', () => {
    expect(dayKeyOf(at('2026-07-13T23:59:59Z'))).toBe('2026-07-13');
    expect(dayKeyOf(at('2026-07-14T00:00:00Z'))).toBe('2026-07-14');
  });
});
