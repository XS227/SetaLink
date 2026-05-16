import { apiGet, apiPatch } from './client';
import type { AuthUser } from '../../stores/authStore';

export interface SubscriptionInfo {
  plan:           string;
  status:         'active' | 'expired' | 'cancelled';
  expiresAt:      string | null;
  usedBytes:      number;
  limitBytes:     number | null;
  devicesAllowed: number;
}

export const ProfileAPI = {
  get: (token: string) =>
    apiGet<AuthUser>('/profile', token),

  update: (token: string, data: Partial<Pick<AuthUser, 'name'>>) =>
    apiPatch<AuthUser>('/profile', data, token),

  subscription: (token: string) =>
    apiGet<SubscriptionInfo>('/profile/subscription', token),
};
