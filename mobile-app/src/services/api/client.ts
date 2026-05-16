/**
 * Centralized API client for the SetaLink backend.
 *
 * All HTTP calls go through request() so auth headers, timeouts, and
 * 401 auto-logout are handled in one place.
 */

export const API_BASE = 'https://api.setalink.net/v1';

const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client': 'setalink-mobile/1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('../../stores/authStore');
        useAuthStore.getState().logout();
      } catch {}
      throw new ApiError(401, 'Session expired — please sign in again');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text;
      try { message = JSON.parse(text).message ?? text; } catch {}
      throw new ApiError(res.status, message || `HTTP ${res.status}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(408, 'Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function apiGet<T>(path: string, token?: string | null): Promise<T> {
  return request<T>('GET', path, undefined, token);
}

export function apiPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  return request<T>('POST', path, body, token);
}

export function apiPatch<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  return request<T>('PATCH', path, body, token);
}

export function apiDelete(path: string, token?: string | null): Promise<void> {
  return request<void>('DELETE', path, undefined, token);
}
