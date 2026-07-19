/**
 * zarStore — Shahnameh tap-to-earn balance inside RealGram.
 *
 * While the VPN is connected, each tap on the big REAL coin earns ZAR — the
 * Shahnameh in-game currency, converted to REAL via the existing
 * /user/zar-swap endpoint. `tap()` still increments `balance` locally and
 * instantly for tap-feel — no visible lag — but as of contract §8
 * (REALGRAM_UNIFIED_PLATFORM.md §B, 2026-07-19) the SERVER is the actual
 * source of truth: zarSyncService.ts buffers taps and periodically flushes
 * them to Shahnameh, and `reconcileFromServer()` below overwrites `balance`
 * with whatever the server returns after each flush. That's what makes ZAR
 * consistent across devices/pages — every flush, from any device, converges
 * on the one number the server holds; local state is a between-flush cache,
 * not the system of record.
 *
 * The local daily tap cap below is a client-side UX safety net only — the
 * real anti-abuse cap (DAILY_ZAR_CAP, on ZAR value, not tap count) lives
 * server-side and is enforced independently.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

export const ZAR_PER_TAP  = 1;
export const ZAR_DAILY_CAP = 500;

/** UTC day key — cap resets at midnight UTC so travel can't farm resets. */
export function dayKeyOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface ZarTapResult {
  earned: number;      // 0 when the daily cap is reached
  capped: boolean;
}

interface ZarState {
  balance:     number;
  earnedToday: number;
  dayKey:      string;

  /** Register one coin tap; returns what it earned so the UI can react. */
  tap: (now?: Date) => ZarTapResult;

  /** Overwrite local balance with the server's authoritative total after a
   * zarSyncService flush. Never additive — the server value always wins,
   * even if it's lower than the optimistic local count (e.g. this device's
   * unsynced taps got capped server-side by DAILY_ZAR_CAP). */
  reconcileFromServer: (serverZar: number) => void;
}

export function applyTap(
  s: Pick<ZarState, 'balance' | 'earnedToday' | 'dayKey'>,
  now: Date,
): { next: Pick<ZarState, 'balance' | 'earnedToday' | 'dayKey'>; result: ZarTapResult } {
  const key = dayKeyOf(now);
  const earnedToday = s.dayKey === key ? s.earnedToday : 0;
  if (earnedToday >= ZAR_DAILY_CAP) {
    return { next: { ...s, earnedToday, dayKey: key }, result: { earned: 0, capped: true } };
  }
  return {
    next: {
      balance:     s.balance + ZAR_PER_TAP,
      earnedToday: earnedToday + ZAR_PER_TAP,
      dayKey:      key,
    },
    result: { earned: ZAR_PER_TAP, capped: false },
  };
}

export const useZarStore = create<ZarState>()(
  persist(
    (set, get) => ({
      balance:     0,
      earnedToday: 0,
      dayKey:      '',

      tap: (now = new Date()) => {
        const { next, result } = applyTap(get(), now);
        set(next);
        return result;
      },

      reconcileFromServer: (serverZar) => set({ balance: serverZar }),
    }),
    {
      name:    'realink-zar',
      storage: createJSONStorage(() => storage),
    },
  ),
);
