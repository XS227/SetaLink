import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import { avatarForId, suggestHandle, normalizeHandle } from '../utils/handle';

// Identity layer (A-11): the user's self-chosen, addressable profile —
// @handle (unique id) + display nickname + emoji avatar. Local-first: it
// persists and works entirely on-device; the @handle becomes globally
// reservable once Agent B's B-14 handle-lookup lands (see reserveHandle in
// services/handleService). Kept as its own store because the messaging layer
// (A-12) reads identity independently of auth/entitlement.

// 'local'    — chosen on-device, not yet confirmed unique by the backend
// 'reserved' — backend confirmed + reserved this handle for us (B-14)
// 'taken'    — last reservation attempt found it already taken elsewhere
export type HandleState = 'local' | 'reserved' | 'taken';

// B-20: "Are you a King or a Queen?" — a light Shahnameh-flavored persona
// pick, first asked in onboarding, editable later from the identity sheet.
// null = never chosen (pre-B-20 installs, or explicitly skipped).
export type Persona = 'king' | 'queen' | null;

interface IdentityState {
  handle:       string | null;   // normalized, no leading '@'
  handleState:  HandleState;
  displayName:  string;          // freeform nickname (may be empty)
  avatarEmoji:  string;
  avatarColor:  string;
  persona:      Persona;
  /** True once the user has explicitly set anything (vs. seeded defaults). */
  customized:   boolean;

  /** Seed defaults from a stable device/user id on first run (idempotent). */
  seedFromId:      (id: string) => void;
  setHandle:       (handle: string, state?: HandleState) => void;
  setHandleState:  (state: HandleState) => void;
  setDisplayName:  (name: string) => void;
  setAvatar:       (emoji: string, color: string) => void;
  /**
   * Sets the King/Queen persona. Also defaults the avatar emoji to the
   * matching crown glyph, but only when the user hasn't already customized
   * their avatar — never clobbers an explicit avatar pick.
   */
  setPersona:      (persona: Persona) => void;
  reset:           () => void;
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set, get) => ({
      handle:      null,
      handleState: 'local',
      displayName: '',
      avatarEmoji: '🦊',
      avatarColor: '#00E87A',
      persona:     null,
      customized:  false,

      seedFromId: (id) => set((s) => {
        // Only seed the avatar/handle suggestion once, and never clobber a
        // user's explicit choices.
        if (s.customized || s.handle) return s;
        const a = avatarForId(id);
        return {
          avatarEmoji: a.emoji,
          avatarColor: a.color,
          handle:      suggestHandle(id),
          handleState: 'local',
        };
      }),

      setHandle: (handle, state = 'local') =>
        set(() => ({ handle: normalizeHandle(handle), handleState: state, customized: true })),

      setHandleState: (handleState) => set(() => ({ handleState })),

      setDisplayName: (displayName) =>
        set(() => ({ displayName: displayName.trim().slice(0, 40), customized: true })),

      setAvatar: (avatarEmoji, avatarColor) =>
        set(() => ({ avatarEmoji, avatarColor, customized: true })),

      setPersona: (persona) => set((s) => {
        if (s.customized) return { persona };
        const emoji = persona === 'king' ? '👑' : persona === 'queen' ? '👸' : s.avatarEmoji;
        return { persona, avatarEmoji: emoji };
      }),

      reset: () => set(() => ({
        handle: null, handleState: 'local', displayName: '',
        avatarEmoji: '🦊', avatarColor: '#00E87A', persona: null, customized: false,
      })),
    }),
    {
      name:    'setalink-identity-v1',
      storage: createJSONStorage(() => storage),
    },
  ),
);

/** Convenience selector: what to show as the primary name (nickname → @handle). */
export function displayLabel(s: Pick<IdentityState, 'displayName' | 'handle'>): string {
  if (s.displayName) return s.displayName;
  if (s.handle) return `@${s.handle}`;
  return '';
}
