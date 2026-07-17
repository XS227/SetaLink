import { create }                     from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage }                    from '../storage/storage';
import type { StarlinkUnlockStatus }  from '../services/api/starlink.api';

/**
 * Starlink Experience state (b97 addendum #2).
 *
 * One store feeds the Home hero card, the dedicated Starlink screen and the
 * first-connect celebration. Two one-shot moments live here:
 *
 *  - justUnlocked: unlock.unlocked flipped false → true between two refreshes
 *    on THIS device — drives the unlock animation, consumed once.
 *  - celebration: the "🛰️ Satellite Route Active" achievement fires only while
 *    the server still says hasConnected === false at connect time (reinstall-
 *    proof), guarded by a local celebratedLocally flag so a slow node_usage
 *    write can never double-fire it.
 */

interface StarlinkState {
  status:        StarlinkUnlockStatus | null;
  lastFetchedAt: number | null;
  isLoading:     boolean;

  /** Persisted: last unlocked value we showed the user (unlock-animation edge). */
  seenUnlocked:      boolean;
  /** Set when the unlock animation should play; consumed by the UI. */
  justUnlocked:      boolean;
  /** Persisted local guard for the once-ever first-connect celebration. */
  celebratedLocally: boolean;

  refresh:           (token: string) => Promise<void>;
  consumeUnlockMoment: () => void;
  /** True exactly when the achievement moment should be shown for a Starlink connect. */
  shouldCelebrate:   () => boolean;
  markCelebrated:    () => void;
}

export const useStarlinkStore = create<StarlinkState>()(
  persist(
    (set, get) => ({
      status:            null,
      lastFetchedAt:     null,
      isLoading:         false,
      seenUnlocked:      false,
      justUnlocked:      false,
      celebratedLocally: false,

      refresh: async (token) => {
        if (get().isLoading) return;
        set({ isLoading: true });
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { StarlinkAPI } = require('../services/api/starlink.api') as typeof import('../services/api/starlink.api');
          const status = await StarlinkAPI.unlockStatus(token);
          const wasUnlocked = get().seenUnlocked;
          const nowUnlocked = !!status.unlock?.unlocked;
          set({
            status,
            lastFetchedAt: Date.now(),
            isLoading:     false,
            seenUnlocked:  nowUnlocked,
            // Only ever raise the flag here — the UI lowers it after playing.
            justUnlocked:  get().justUnlocked || (nowUnlocked && !wasUnlocked),
          });
        } catch {
          // Keep the last known status — the card must never vanish because
          // one refresh failed on a censored network.
          set({ isLoading: false });
        }
      },

      consumeUnlockMoment: () => set({ justUnlocked: false }),

      shouldCelebrate: () => {
        const { status, celebratedLocally } = get();
        if (celebratedLocally) return false;
        // Server truth wins: hasConnected false = this device has never routed
        // via Starlink. Missing field (older server) falls back to local-only.
        return status?.hasConnected !== true;
      },

      markCelebrated: () => set({ celebratedLocally: true }),
    }),
    {
      name:    'setalink-starlink-v1',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        status:            s.status,
        seenUnlocked:      s.seenUnlocked,
        celebratedLocally: s.celebratedLocally,
      }),
    },
  ),
);
