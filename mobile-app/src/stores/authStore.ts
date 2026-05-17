import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

export interface AuthUser {
  id: string;
  deviceId: string;
  inviteCodeUsed: string;
  referralParent: string | null;
  referralCode: string;
  quotaBytesTotal: number;
  quotaBytesUsed: number;
  createdAt: string;
  lastSeen: string;
  securedWithBiometric: boolean;
  status: 'active' | 'expired' | 'blocked';
  plan: 'free';
  planExpiry: string | null;
}

interface InvitePayload {
  inviteCode: string;
  referralParent?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;

  loginWithInvite: (payload: InvitePayload) => void;
  logout: () => void;
  touchLastSeen: () => void;
  setBiometricSecure: (enabled: boolean) => void;
  consumeQuota: (bytes: number) => void;
}

const ONE_GB_BYTES = 1024 * 1024 * 1024;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      loginWithInvite: ({ inviteCode, referralParent = null }) => set(() => {
        const now = new Date().toISOString();
        return {
          user: {
            id: randomId('anon'),
            deviceId: randomId('dev'),
            inviteCodeUsed: inviteCode.toUpperCase(),
            referralParent,
            referralCode: `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            quotaBytesTotal: ONE_GB_BYTES,
            quotaBytesUsed: 0,
            createdAt: now,
            lastSeen: now,
            securedWithBiometric: false,
            status: 'active',
            plan: 'free',
            planExpiry: null,
          },
          token: `anon-token-${Date.now()}`,
          isAuthenticated: true,
        };
      }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      touchLastSeen: () => set((prev) => ({
        user: prev.user ? { ...prev.user, lastSeen: new Date().toISOString() } : null,
      })),
      setBiometricSecure: (enabled) => set((prev) => ({
        user: prev.user ? { ...prev.user, securedWithBiometric: enabled } : null,
      })),
      consumeQuota: (bytes) => set((prev) => {
        if (!prev.user) return prev;
        const used = Math.max(0, Math.min(prev.user.quotaBytesTotal, prev.user.quotaBytesUsed + Math.max(0, bytes)));
        return { user: { ...prev.user, quotaBytesUsed: used } };
      }),
    }),
    {
      name: 'setalink-auth',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }),
    }
  )
);
