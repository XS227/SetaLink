import { create } from 'zustand';

/**
 * Tracks whether a season2 (Shahnameh) WebView currently has a modal/
 * bottom-sheet/quiz/chapter-overlay/full-screen menu open, so
 * AppNavigator's tab bar can hide itself instead of being covered by it
 * (Khabat, 2026-07-21: "Farr — Divine Glory" popup visibly covered by the
 * native footer — padding-only sync wasn't enough, this is the real
 * open/close signal, driven by season2/realgram-bridge.js's postMessage).
 *
 * Global rather than per-screen: only one Shahnameh-embedded tab (Game or
 * Clan) is ever focused at a time, and ShahnamehEmbed resets this to false
 * on blur (see useFocusEffect there) so a backgrounded tab can never leave
 * the nav stuck hidden.
 */
interface OverlayState {
  isOpen:   boolean;
  setOpen: (open: boolean) => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  isOpen: false,
  setOpen: (open) => set({ isOpen: open }),
}));
