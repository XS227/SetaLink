/**
 * Live TV — API client for shahnameh-backend's /api/live-tv/* (Khabat's
 * spec, 2026-07-28, docs/realgram/TASK_SPLIT.md B->A(140)). Public,
 * paginated, no identity needed for browsing — same trust level
 * ShahnamehEmbed/chapterCatalogService already extend to this origin.
 * Favorites (add/remove/list) need the telegram_id bridge (B->A(132)),
 * same pattern as Clan/Earn/Heroes — guests use liveTvFavoritesStore.ts
 * (on-device) instead.
 */

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const BASE = `${SHAHNAMEH_ORIGIN}/api/live-tv`;
const TIMEOUT_MS = 10_000;

export interface LiveTvChannel {
  id:             string;
  name:           string;
  logo_url:       string;
  stream_url:     string;
  country_code:   string;
  country_name:   string;
  language_code:  string;
  language_name:  string;
  category:       string;
  categories:     string[];
  is_featured:    boolean;
  status:         'available' | 'unstable' | 'unknown' | 'unavailable';
}

export interface LiveTvCountry { code: string; name: string; count: number }
export interface LiveTvLanguage { code: string; name: string; count: number }
export interface LiveTvCategory { id: string; name: string; count: number }

export interface ChannelPage {
  channels: LiveTvChannel[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ChannelQuery {
  country?:  string;
  language?: string;
  category?: string;
  search?:   string;
  page?:     number;
  limit?:    number;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.status !== 1) return null;
    return json as T;
  } catch {
    return null;
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    return json as T;
  } catch {
    return null;
  }
}

function buildQuery(q: ChannelQuery): string {
  const params = new URLSearchParams();
  if (q.country)  params.set('country', q.country);
  if (q.language) params.set('language', q.language);
  if (q.category) params.set('category', q.category);
  if (q.search)   params.set('search', q.search);
  params.set('page', String(q.page ?? 1));
  params.set('limit', String(q.limit ?? 30));
  return params.toString();
}

const EMPTY_PAGE: ChannelPage = { channels: [], page: 1, limit: 30, total: 0, total_pages: 0 };

export async function getChannels(query: ChannelQuery = {}): Promise<ChannelPage> {
  const result = await getJson<ChannelPage & { status: number }>(`/channels?${buildQuery(query)}`);
  return result ?? EMPTY_PAGE;
}

export async function getChannel(id: string): Promise<LiveTvChannel | null> {
  const result = await getJson<{ channel: LiveTvChannel }>(`/channels/${encodeURIComponent(id)}`);
  return result?.channel ?? null;
}

export async function getCountries(): Promise<LiveTvCountry[]> {
  const result = await getJson<{ countries: LiveTvCountry[] }>('/countries');
  return result?.countries ?? [];
}

export async function getLanguages(): Promise<LiveTvLanguage[]> {
  const result = await getJson<{ languages: LiveTvLanguage[] }>('/languages');
  return result?.languages ?? [];
}

export async function getCategories(): Promise<LiveTvCategory[]> {
  const result = await getJson<{ categories: LiveTvCategory[] }>('/categories');
  return result?.categories ?? [];
}

export async function getFeatured(limit = 20): Promise<LiveTvChannel[]> {
  const result = await getJson<{ channels: LiveTvChannel[] }>(`/featured?limit=${limit}`);
  return result?.channels ?? [];
}

export async function getServiceStatus(): Promise<{ enabled: boolean; total_channels: number; last_updated_at: string | null } | null> {
  return getJson('/status');
}

export async function reportChannel(id: string): Promise<boolean> {
  const result = await postJson<{ status: number }>(`/channels/${encodeURIComponent(id)}/report`, {});
  return result?.status === 1;
}

// ── Account-linked favorites (logged-in users; guests use liveTvFavoritesStore.ts) ──

export async function getAccountFavorites(telegramId: string): Promise<LiveTvChannel[]> {
  if (!telegramId) return [];
  const result = await getJson<{ channels: LiveTvChannel[] }>(`/favorites?telegram_id=${encodeURIComponent(telegramId)}`);
  return result?.channels ?? [];
}

export async function addAccountFavorite(telegramId: string, channelId: string): Promise<boolean> {
  const result = await postJson<{ status: number }>('/favorites/add', { telegram_id: telegramId, channel_id: channelId });
  return result?.status === 1;
}

export async function removeAccountFavorite(telegramId: string, channelId: string): Promise<boolean> {
  const result = await postJson<{ status: number }>('/favorites/remove', { telegram_id: telegramId, channel_id: channelId });
  return result?.status === 1;
}
