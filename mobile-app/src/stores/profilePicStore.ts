import { create } from 'zustand';

/**
 * profilePicStore — the one place the real Shahnameh/RealGram profile photo
 * (ProfileIdentity.profile_pic, from getProfileSummary) is cached for reuse
 * across screens.
 *
 * Khabat, 2026-07-27: the top-right header avatar (HomeScreen's own chip and
 * the shared TopBar used by Wallet/Servers/Activity/Game) only ever rendered
 * identityStore's local emoji avatar — it never looked at the real photo at
 * all, even though RealGramProfileScreen already had it. Not persisted: it's
 * cheap to refetch each session (whichever screen calls getProfileSummary
 * first populates it for the rest), and a stale cached photo across accounts
 * on a shared device would be worse than a brief emoji fallback.
 */
interface ProfilePicState {
  url: string;
  setUrl: (url: string) => void;
}

export const useProfilePicStore = create<ProfilePicState>((set) => ({
  url: '',
  setUrl: (url) => set({ url }),
}));
