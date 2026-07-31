/**
 * Social — leaderboard, activity feed, tournament (`docs/realgram/TASK_SPLIT.md`
 * A→B(125) roadmap: Social).
 *
 * Unlike chapters/heroes, confirmed live that these THREE endpoints are
 * public/no-identity-needed (`social/leaderboard`, `social/activity`,
 * `events`) — genuinely global data, not "my" anything. Only clan
 * membership actions (apply/create/my-clan) need the telegram_id bridge
 * A→B(125) is still blocked on; browsing doesn't. Short TTL (this is live,
 * frequently-changing data, not static story content like chapters) and
 * in-memory only — not worth persisting a leaderboard snapshot across app
 * restarts the way the static catalogs are.
 */

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CACHE_TTL_MS = 60_000;

export interface LeaderboardRow {
  telegram_id:             string;
  first_name:              string;
  level:                   number;
  xp:                      number;
  real_balance:            number;
  verified_referral_count: number;
  profile_pic:             string;
  is_me:                   boolean;
}

export interface ActivityEvent {
  type:   string;
  icon:   string;
  user:   string;
  detail: string;
  ts:     number;
}

export interface TournamentInfo {
  ends_at_ms:      number;
  ends_in_seconds: number;
  leaderboard: Array<{ first_name: string; real_balance: number; is_me: boolean }>;
}

interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>();

async function fetchJson<T>(path: string, cacheKey: string): Promise<T | null> {
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data as T;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}${path}`, { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1) return cached ? (cached.data as T) : null;
    _cache.set(cacheKey, { data: json, expiresAt: Date.now() + CACHE_TTL_MS });
    return json as T;
  } catch {
    return cached ? (cached.data as T) : null;
  }
}

export type LeaderboardType = 'earners' | 'learners' | 'referrers';

// Khabat, 2026-07-31: "warrior of day, month, basert på referal antall,
// mest tapping, mest lest kapitler" — the backend endpoint already
// supports 3 real leaderboard types (earners=real_balance, learners=xp,
// referrers=verified_referral_count — GET .../social/leaderboard's own
// route comment), the client just never passed `type` and always got the
// default. Wiring these 3 in is a real, immediate improvement; "day/month"
// periodization and tap-count/hero-card-level as their own dimensions
// aren't in this endpoint at all — that needs a proper time-windowed
// snapshot design (reset timing, anti-cheat) on the backend, not something
// to improvise here. Flagged, not built.
export async function getLeaderboard(type: LeaderboardType = 'earners'): Promise<LeaderboardRow[]> {
  const json = await fetchJson<{ rows: LeaderboardRow[] }>(`/api/season2/social/leaderboard?type=${type}`, `leaderboard-${type}`);
  return json?.rows ?? [];
}

export async function getActivityFeed(): Promise<ActivityEvent[]> {
  const json = await fetchJson<{ events: ActivityEvent[] }>('/api/season2/social/activity', 'activity');
  return json?.events ?? [];
}

export async function getTournament(): Promise<TournamentInfo | null> {
  const json = await fetchJson<{ tournament: TournamentInfo }>('/api/season2/events', 'events');
  return json?.tournament ?? null;
}
