/**
 * zarStore — Shahnameh tap-to-earn balance inside Realink.
 *
 * While the VPN is connected, each tap on the big REAL coin earns ZAR — the
 * Shahnameh in-game currency. ZAR converts to REAL in a later step (backend
 * exchange not built yet), so for now the balance lives on-device and is the
 * visible bridge between the two apps.
 *
 * A generous daily cap keeps pre-backend balances honest enough to migrate
 * once the exchange exists.
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
    }),
    {
      name:    'realink-zar',
      storage: createJSONStorage(() => storage),
    },
  ),
);
