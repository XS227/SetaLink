/**
 * Live TV — API client for shahnameh-backend's /api/live-tv/* (Khabat's
 * spec, 2026-07-28, docs/realgram/TASK_SPLIT.md B->A(140)). Public,
 * paginated, no identity needed for browsing — same trust level
 * ShahnamehEmbed/chapterCatalogService already extend to this origin.
 * Favorites (add/remove/list) need the telegram_id bridge (B->A(132)),
 * same pattern as Clan/Earn/Heroes — guests use liveTvFavoritesStore.ts
 * (on-device) instead.
 */

import { trackEvent } from './analytics';
import { useAuthStore } from '../stores/authStore';
import { buildQueryString } from '../utils/queryString';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const BASE = `${SHAHNAMEH_ORIGIN}/api/live-tv`;
const TIMEOUT_MS = 10_000;

// 2026-07-28 (Khabat's on-device report, docs/realgram/TASK_SPLIT.md
// B->A(153)): every failure below this point used to be a silent
// `catch { return null }` — real backend + real network both verified
// working (server-side testing + Khabat's own phone browser hitting the
// exact endpoint), yet the app showed an empty/stuck screen with zero
// trace of why. Routing failures through the same trackEvent()/app_events
// pipeline already used for ad errors means the NEXT on-device repro is
// diagnosable from the server side, without needing another live
// round-trip with Khabat to relay what she's seeing.
function reportFetchFailure(path: string, reason: string): void {
  if (__DEV__) console.warn('[liveTvService] fetch failed', path, reason);
  try {
    trackEvent('LIVE_TV_FETCH_ERROR', useAuthStore.getState().user?.deviceId, { path, reason });
  } catch { /* diagnostics must never break the UI */ }
}

// 2026-07-30: Khabat's on-device repro — /status succeeds (the screen gets
// past its "enabled" gate and shows search/filters), but the channel grid
// never loads, no spinner timeout ever visible. Backend + network re-proven
// healthy yet again from the server side (every endpoint, sequential and
// concurrent, <0.5s) — same dead end every prior round of this hit
// (TASK_SPLIT (146)/(214)/(221)/(247)/(249)). `reportFetchFailure` above only
// ever fires on a *settled* failure; it can't tell us whether a request that
// never settles at all ever actually left the JS thread. ssoService.ts hit
// the exact same shape of mystery (B->A(29)/A->B around line ~4950 in
// TASK_SPLIT — "real Android requests never even reach the server") and
// only became diagnosable once every stage got its own event instead of
// just the final outcome — adb logcat was never actually available to
// pull `console.log`-based traces from a real device on this project (see
// TASK_SPLIT ~4511), so the server-side app_events pipe (queryable from
// here without touching the device) is the only diagnostic channel that's
// ever actually worked for this team. Mirroring that here: a `dispatched`
// event proves the fetch call was actually reached and entered (vs. some
// earlier synchronous failure/never-called), and an `ok` event on success
// closes the loop so the *absence* of both from a real repro is itself
// informative.
function reportFetchStage(stage: 'dispatched' | 'ok', path: string, extra?: Record<string, unknown>): void {
  try {
    trackEvent('LIVE_TV_FETCH_STAGE', useAuthStore.getState().user?.deviceId, { stage, path, ...extra });
  } catch { /* diagnostics must never break the UI */ }
}

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

// Khabat, 2026-07-30: real live-device repro — Live TV gets stuck on its
// loading spinner forever, no LIVE_TV_FETCH_ERROR ever reaches app_events
// (checked directly). Backend and network both proven fine in the same
// session (direct API checks from this box, and her own phone browser
// hitting the exact endpoint with VPN off both returned real data
// instantly) — the only thing left that explains a promise that never
// resolves *or* rejects is AbortController.abort() not actually
// terminating the underlying request. That's a known gap in React
// Native's fetch/XHR bridge on Android in some RN/OkHttp version
// combinations: abort() fires, the timer callback runs, but the native
// XHR request already past its "connecting" phase doesn't always
// propagate the cancellation back into a rejected promise — so `await
// fetch(...)` just... never returns, silently, past the timeout that was
// supposed to guarantee it does.
//
// This doesn't fix whatever's making the request slow in the first place
// (still unknown — worth a native-side trace if this keeps happening),
// but it guarantees getJson()/postJson() always settle within
// TIMEOUT_MS regardless of whether the underlying fetch's own
// cancellation actually works, so the UI reliably reaches the
// error+retry state instead of spinning forever.
function hardTimeout<T>(promise: Promise<T>, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      reportFetchFailure(path, 'hard_timeout_fetch_never_settled');
      reject(new Error('hard_timeout'));
    }, TIMEOUT_MS + 500); // slightly past the fetch's own abort, so a real abort still wins first when it works
    promise.then((v) => { clearTimeout(tid); resolve(v); }, (e) => { clearTimeout(tid); reject(e); });
  });
}

async function getJson<T>(path: string): Promise<T | null> {
  const startedAt = Date.now();
  reportFetchStage('dispatched', path);
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await hardTimeout(fetch(`${BASE}${path}`, { signal: controller.signal }), path);
    clearTimeout(tid);
    if (!res.ok) {
      reportFetchFailure(path, `http_${res.status}`);
      return null;
    }
    const json = await res.json();
    if (json?.status !== 1) {
      reportFetchFailure(path, 'bad_status_field');
      return null;
    }
    reportFetchStage('ok', path, { ms: Date.now() - startedAt });
    return json as T;
  } catch (err) {
    reportFetchFailure(path, err instanceof Error ? `${err.name}:${err.message}`.slice(0, 200) : 'unknown_error');
    return null;
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const startedAt = Date.now();
  reportFetchStage('dispatched', path);
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await hardTimeout(fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }), path);
    clearTimeout(tid);
    if (!res.ok) reportFetchFailure(path, `http_${res.status}`);
    const json = await res.json();
    reportFetchStage('ok', path, { ms: Date.now() - startedAt });
    return json as T;
  } catch (err) {
    reportFetchFailure(path, err instanceof Error ? `${err.name}:${err.message}`.slice(0, 200) : 'unknown_error');
    return null;
  }
}

// Never build this with `new URLSearchParams()` + `.set()` — some Android/
// Hermes runtimes throw "URLSearchParams.set is not implemented" (see
// queryString.ts), which happens synchronously here, before getJson() ever
// runs, so it produces zero telemetry (no dispatched/ok/error event) and
// leaves the screen's loading spinner stuck forever. This was the actual
// root cause behind the 2026-07-30 "channels never load" repro — every
// other Live TV endpoint here avoids .set() and works fine.
function buildQuery(q: ChannelQuery): string {
  return buildQueryString({
    country:  q.country,
    language: q.language,
    category: q.category,
    search:   q.search,
    page:     q.page ?? 1,
    limit:    q.limit ?? 30,
  });
}

const EMPTY_PAGE: ChannelPage = { channels: [], page: 1, limit: 30, total: 0, total_pages: 0 };

// `failed:true` distinguishes "the request itself didn't succeed" (network/
// parse/HTTP error — already reported via reportFetchFailure above) from a
// genuinely successful response with zero matches for the current filters —
// the screen showed the same "no channels match" copy for both before,
// which reads as a dead end even when retrying would actually work.
export async function getChannels(query: ChannelQuery = {}): Promise<ChannelPage & { failed?: boolean }> {
  const result = await getJson<ChannelPage & { status: number }>(`/channels?${buildQuery(query)}`);
  return result ?? { ...EMPTY_PAGE, failed: true };
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
