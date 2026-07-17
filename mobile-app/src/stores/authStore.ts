import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import type {
  DeviceEntitlement, QuotaSummary, MilestoneProgress, PurchasedPackage,
} from '../services/entitlementService';

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
  // Backend's DeviceEntitlement.plan is an untyped string (new plan values can
  // ship without a client release) — widened here from the old 'free'-only
  // type so premium gating (e.g. the Starlink node) has something real to
  // check. Treat any value other than 'free' defensively as non-premium
  // unless it's explicitly 'premium' — see hasStarlinkAccess() below.
  plan: 'free' | 'premium';
  planExpiry: string | null;
  inviteCount: number;
  activeInviteCount: number;
  stealthUnlocked: boolean;
  country: string;          // ISO code geo-detected by the backend ('' if unknown)
  // v0.9.31 server-side quota ledger. Null until the entitlement carries it;
  // the profile cards prefer this over any client-side derivation.
  quota: QuotaSummary | null;
  milestones: MilestoneProgress | null;
  packages: PurchasedPackage[];
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
  addBonusBytes:         (bytes: number) => void;
  applyQuotaSummary:     (summary: QuotaSummary) => void;
}

const ONE_GB_BYTES = 1024 * 1024 * 1024;
// Every new account starts with 5 GB (matches the backend signup grant) —
// shown immediately so the welcome gift never flashes a stale "1 GB".
const STARTER_QUOTA_BYTES = 5 * ONE_GB_BYTES;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// Backend's entitlement.plan is an untyped string — normalize defensively so
// an unrecognized value (typo, a future plan tier not yet handled here) never
// silently grants premium-gated features. Only an exact 'premium' unlocks.
function normalizePlan(raw: string | undefined): 'free' | 'premium' {
  return raw === 'premium' ? 'premium' : 'free';
}

/** Starlink hero-node access: Premium plan, or having invited at least 11
 *  people (clan/referral growth path) — either unlocks it. Exported so the
 *  same rule can gate the hero card AND any future Starlink entry that shows
 *  up in the regular server list, without duplicating the threshold. */
export const STARLINK_INVITE_THRESHOLD = 11;
export function hasStarlinkAccess(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.plan === 'premium' || user.inviteCount >= STARLINK_INVITE_THRESHOLD;
}

// Extract the unique suffix from SL-227-XXXXXXXX style user IDs
// The referral code is whatever the backend stores in `referral_code` — that is
// the only value use-referral looks up. Do NOT derive it from the user_id suffix;
// the two are unrelated, and deriving made every shared invite fail to match.
export function deriveReferralCode(_userId: string, referralCode: string): string {
  return (referralCode || '').toUpperCase();
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
            quotaBytesTotal: STARTER_QUOTA_BYTES,
            quotaBytesUsed: 0,
            createdAt: now,
            lastSeen: now,
            securedWithBiometric: false,
            status: 'active',
            plan: 'free',
            planExpiry: null,
            inviteCount: 0,
            activeInviteCount: 0,
            stealthUnlocked: false,
            country: '',
            quota: null,
            milestones: null,
            packages: [],
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
            plan:                 normalizePlan((e as any).plan),
            planExpiry:           e.valid_until ?? null,
            inviteCount:          (e as any).invite_count ?? 0,
            activeInviteCount:    (e as any).active_invite_count ?? 0,
            stealthUnlocked:      (e as any).stealth_unlocked ?? false,
            country:              (e as any).country ?? '',
            quota:                e.quota ?? null,
            milestones:           e.milestones ?? null,
            packages:             e.packages ?? [],
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
            referralCode:      deriveReferralCode(userId, e.referral_code),
            quotaBytesTotal:   e.quota_bytes_total,
            quotaBytesUsed:    Math.min(e.quota_bytes_total, Math.max(0, e.quota_bytes_used)),
            status:            e.blocked ? 'blocked' : 'active',
            plan:              normalizePlan((e as any).plan ?? prev.user.plan),
            planExpiry:        e.valid_until ?? null,
            inviteCount:       (e as any).invite_count ?? prev.user.inviteCount,
            activeInviteCount: (e as any).active_invite_count ?? prev.user.activeInviteCount,
            stealthUnlocked:   (e as any).stealth_unlocked ?? prev.user.stealthUnlocked,
            country:           (e as any).country || prev.user.country,
            quota:             e.quota ?? prev.user.quota,
            milestones:        e.milestones ?? prev.user.milestones,
            packages:          e.packages ?? prev.user.packages,
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
      addBonusBytes: (bytes) => set((prev) => {
        if (!prev.user) return prev;
        return { user: { ...prev.user, quotaBytesTotal: prev.user.quotaBytesTotal + bytes } };
      }),
      // Apply a fresh server quota breakdown (e.g. right after a transfer) so the
      // profile cards reflect the new balances without a full re-sync.
      applyQuotaSummary: (summary) => set((prev) => {
        if (!prev.user) return prev;
        return {
          user: {
            ...prev.user,
            quota:           summary,
            quotaBytesTotal: summary.total_quota,
            quotaBytesUsed:  Math.min(summary.total_quota, Math.max(0, summary.used_quota)),
          },
        };
      }),
    }),
    {
      name: 'setalink-auth',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated, pinCode: s.pinCode }),
    }
  )
);
