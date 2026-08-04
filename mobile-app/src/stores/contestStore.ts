import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import type { ContestStatus } from '../services/api/contest.api';

/**
 * Pre-release 100-invite contest state — same one-store-feeds-every-surface
 * shape as starlinkStore.ts (money desk screen + the Freedom-tab banner both
 * read from here, one refresh call per app session).
 */

interface ContestState {
  status:        ContestStatus | null;
  lastFetchedAt: number | null;
  isLoading:     boolean;
  isClaiming:    boolean;

  refresh:      (token: string) => Promise<void>;
  connectWallet: (token: string, walletAddress: string, chain: string) => Promise<void>;
  claim:        (token: string) => Promise<void>;
}

export const useContestStore = create<ContestState>()(
  persist(
    (set, get) => ({
      status:        null,
      lastFetchedAt: null,
      isLoading:     false,
      isClaiming:    false,

      refresh: async (token) => {
        if (get().isLoading) return;
        set({ isLoading: true });
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ContestAPI } = require('../services/api/contest.api') as typeof import('../services/api/contest.api');
          const status = await ContestAPI.status(token);
          set({ status, lastFetchedAt: Date.now(), isLoading: false });
        } catch {
          // Keep the last known status — the banner/dashboard must never
          // vanish because one refresh failed on a censored network.
          set({ isLoading: false });
        }
      },

      connectWallet: async (token, walletAddress, chain) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ContestAPI } = require('../services/api/contest.api') as typeof import('../services/api/contest.api');
        const status = await ContestAPI.connectWallet(token, walletAddress, chain);
        set({ status, lastFetchedAt: Date.now() });
      },

      claim: async (token) => {
        if (get().isClaiming) return;
        set({ isClaiming: true });
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ContestAPI } = require('../services/api/contest.api') as typeof import('../services/api/contest.api');
          const result = await ContestAPI.claim(token);
          set({ status: result.status, lastFetchedAt: Date.now(), isClaiming: false });
        } catch (e) {
          set({ isClaiming: false });
          throw e;
        }
      },
    }),
    {
      name:    'setalink-contest-v1',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ status: s.status }),
    },
  ),
);
