import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

/**
 * Live TV — on-device favorites + watch history (Khabat's spec §9).
 *
 * Favorites here are the GUEST path (persisted locally, same MMKV-backed
 * `persist` pattern as settingsStore.ts). Logged-in favorites additionally
 * sync to the account via liveTvService.ts's addAccountFavorite/
 * getAccountFavorites — this local store still holds the working copy
 * either way, so the UI never blocks on a network round trip to know
 * "is this channel favorited".
 *
 * Recently-watched/last-channel is deliberately LOCAL-ONLY regardless of
 * login state, never synced to the backend — spec §9's own principle
 * ("Ikke lagre detaljerte seerdata sentralt uten at dette er nødvendig").
 * Capped at 20 entries so it can't grow unbounded.
 */

const MAX_RECENT = 20;

interface LiveTvLocalState {
  favoriteIds:     string[];
  recentIds:       string[]; // most-recently-watched first
  lastChannelId:   string;   // for "continue from last channel"

  isFavorite:      (channelId: string) => boolean;
  toggleFavorite:  (channelId: string) => void;
  setFavorites:    (channelIds: string[]) => void; // overwrite from account sync
  recordWatched:   (channelId: string) => void;
  clearHistory:    () => void;
}

export const useLiveTvLocalStore = create<LiveTvLocalState>()(
  persist(
    (set, get) => ({
      favoriteIds:   [],
      recentIds:     [],
      lastChannelId: '',

      isFavorite: (channelId) => get().favoriteIds.includes(channelId),

      toggleFavorite: (channelId) => set((s) => ({
        favoriteIds: s.favoriteIds.includes(channelId)
          ? s.favoriteIds.filter((id) => id !== channelId)
          : [...s.favoriteIds, channelId],
      })),

      setFavorites: (channelIds) => set({ favoriteIds: channelIds }),

      recordWatched: (channelId) => set((s) => ({
        recentIds: [channelId, ...s.recentIds.filter((id) => id !== channelId)].slice(0, MAX_RECENT),
        lastChannelId: channelId,
      })),

      clearHistory: () => set({ recentIds: [], lastChannelId: '' }),
    }),
    {
      name: 'live-tv-local-v1',
      storage: createJSONStorage(() => storage),
    },
  ),
);
