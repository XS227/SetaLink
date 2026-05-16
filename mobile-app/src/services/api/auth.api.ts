import { apiGet, apiPost } from './client';
import type { AuthUser } from '../../stores/authStore';

export interface LoginResponse   { token: string; user: AuthUser }
export interface RegisterResponse{ token: string; user: AuthUser }

export const AuthAPI = {
  login: (email: string, password: string) =>
    apiPost<LoginResponse>('/auth/login', { email, password }),

  register: (name: string, email: string, password: string) =>
    apiPost<RegisterResponse>('/auth/register', { name, email, password }),

  me: (token: string) =>
    apiGet<AuthUser>('/auth/me', token),

  logout: (token: string) =>
    apiPost<void>('/auth/logout', {}, token),
};
