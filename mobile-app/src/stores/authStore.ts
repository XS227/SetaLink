import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import type { DeviceEntitlement } from '../services/entitlementService';

export interface AuthUser {
  id: string;
  deviceId: string;
  userId: string;
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
  pinCode: string | null;

  loginWithInvite:       (payload: InvitePayload) => void;
  loginWithDevice:       (entitlement: DeviceEntitlement) => void;
  updateFromEntitlement: (entitlement: DeviceEntitlement) => void;
  logout:                () => void;
  touchLastSeen:         () => void;
  setBiometricSecure:    (enabled: boolean) => void;
  consumeQuota:          (bytes: number) => void;
  fixQuotaOverflow:      () => void;
  setPin:                (pin: string | null) => void;
  verifyPin:             (pin: string) => boolean;
}

const ONE_GB_BYTES = 1024 * 1024 * 1024;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// Extract the unique suffix from SL-227-XXXXXXXX style user IDs
function deriveReferralCode(userId: string, fallback: string): string {
  const m = userId?.match(/^SL-\d+-([A-Z0-9]+)$/i);
  return m ? m[1]!.toUpperCase() : fallback;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      pinCode: null,

      loginWithInvite: ({ inviteCode, referralParent = null }) => set(() => {
        const now = new Date().toISOString();
        return {
          user: {
            id: randomId('anon'),
            deviceId: randomId('dev'),
            userId: '',
            inviteCodeUsed: inviteCode.toUpperCase(),
            referralParent,
            referralCode: '',
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
      loginWithDevice: (e) => set(() => {
        const now = new Date().toISOString();
        const userId = e.user_id ?? '';
        return {
          user: {
            id:                   e.device_id,
            deviceId:             e.device_id,
            userId,
            inviteCodeUsed:       '',
            referralParent:       null,
            referralCode:         deriveReferralCode(userId, e.referral_code),
            quotaBytesTotal:      e.quota_bytes_total,
            quotaBytesUsed:       Math.min(e.quota_bytes_total, Math.max(0, e.quota_bytes_used)),
            createdAt:            now,
            lastSeen:             now,
            securedWithBiometric: false,
            status:               e.blocked ? 'blocked' : 'active',
            plan:                 'free',
            planExpiry:           e.valid_until ?? null,
          },
          token:           `device-${e.device_id}`,
          isAuthenticated: true,
        };
      }),

      updateFromEntitlement: (e) => set((prev) => {
        if (!prev.user) return prev;
        const userId = e.user_id || prev.user.userId;
        return {
          user: {
            ...prev.user,
            ...(e.user_id ? { userId: e.user_id } : {}),
            referralCode:    deriveReferralCode(userId, e.referral_code),
            quotaBytesTotal: e.quota_bytes_total,
            quotaBytesUsed:  Math.min(e.quota_bytes_total, Math.max(0, e.quota_bytes_used)),
            status:          e.blocked ? 'blocked' : 'active',
            plan:            'free',
            planExpiry:      e.valid_until ?? null,
          },
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
      fixQuotaOverflow: () => set((prev) => {
        if (!prev.user) return prev;
        const used = Math.min(prev.user.quotaBytesTotal, Math.max(0, prev.user.quotaBytesUsed));
        if (used === prev.user.quotaBytesUsed) return prev;
        return { user: { ...prev.user, quotaBytesUsed: used } };
      }),

      setPin: (pin) => set({ pinCode: pin }),
      verifyPin: (pin) => {
        const { pinCode } = get();
        return pinCode !== null && pinCode === pin;
      },
    }),
    {
      name: 'setalink-auth',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated, pinCode: s.pinCode }),
    }
  )
);
