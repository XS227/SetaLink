import { create } from 'zustand';
import { StarlinkAPI, StarlinkUnlockStatus } from '../services/api/starlink.api';

/**
 * starlinkStore — thin cache of GET /v1/starlink/unlock-status, the single
 * source of truth for the Home unlock/progress card, the server-list
 * Starlink row, and the first-connect celebration (hasConnected). Not
 * persisted: unlock progress and node health are only meaningful fresh from
 * the server, and hasConnected is server-truth already (node_usage-backed,
 * reinstall-proof) so there's nothing worth caching to disk.
 */

interface StarlinkState {
  status:    StarlinkUnlockStatus | null;
  isLoading: boolean;
  fetch:     (token: string) => Promise<void>;
}

export const useStarlinkStore = create<StarlinkState>((set) => ({
  status:    null,
  isLoading: false,

  fetch: async (token) => {
    set({ isLoading: true });
    try {
      const status = await StarlinkAPI.unlockStatus(token);
      set({ status, isLoading: false });
    } catch {
      // Network/API error — keep the last known status (if any) rather than
      // erasing the card; isLoading still clears so it isn't stuck spinning.
      set({ isLoading: false });
    }
  },
}));
