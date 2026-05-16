import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

export interface AuthUser {
  id:           string;
  name:         string;
  email:        string;
  plan:         'free' | 'premium' | 'team';
  planExpiry:   string | null;
  avatarUrl:    string | null;
  referralCode: string;
}

interface AuthState {
  user:            AuthUser | null;
  token:           string | null;
  isAuthenticated: boolean;

  login:   (user: AuthUser, token: string) => void;
  logout:  () => void;
  setUser: (partial: Partial<AuthUser>) => void;
}

// Pre-seeded mock user — replace with real auth response in production
const MOCK_USER: AuthUser = {
  id:           'usr_001',
  name:         'Khabat',
  email:        'khabat.setaei@gmail.com',
  plan:         'premium',
  planExpiry:   '2027-01-15T00:00:00Z',
  avatarUrl:    null,
  referralCode: 'KHABAT-2026',
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            MOCK_USER,
      token:           'mock-token-001',
      isAuthenticated: true,

      login:  (user, token) => set({ user, token, isAuthenticated: true }),
      logout: ()            => set({ user: null, token: null, isAuthenticated: false }),
      setUser: (partial)    => set((prev) => ({
        user: prev.user ? { ...prev.user, ...partial } : null,
      })),
    }),
    {
      name:    'setalink-auth',
      storage: createJSONStorage(() => storage),
      // Only persist identity fields — never persist action functions
      partialize: (s) => ({
        user:            s.user,
        token:           s.token,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
);
