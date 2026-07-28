/**
 * RealGram profile summary — panel-proxied Shahnameh backend read (contract
 * §9, shahnameh-backend main@6b725e1 / docs/realgram/TASK_SPLIT.md B→A(42)).
 *
 * One call for everything RealGram's native ProfileScreen needs — identity,
 * economy, streaks, achievements, chapters, clan — replacing the
 * WebView-embedded profile.html/guild.html as the data source. Same posture
 * as realWalletService: the app never talks to the Shahnameh backend or
 * holds its API key, the panel proxies (public/api.php 'realgram-profile-summary').
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface ProfileIdentity {
  first_name:  string;
  last_name:   string;
  username:    string;
  profile_pic: string;
  handle:      string;
}

export interface ProfileEconomy {
  level:                    number;
  xp:                       number;
  farr:                     number;
  zar:                      number;
  gems:                     number;
  real_balance:             number;
  max_real_balance:         number;
  real_earned_this_season:  number;
  /** Passive zar/hr from owned+upgraded heroes (2026-07-27, B->A(105)) —
   *  the same computeZarPerHour() Shahnameh's own /user/me reads, so this
   *  number can never drift from what the Game tab shows. Distinct from
   *  HomeScreen's older tap-derived zar/hr estimate (earnedToday / hours
   *  elapsed), which is real but approximate and has nothing to do with
   *  hero income specifically. */
  zar_per_hour_from_cards: number;
}

export interface ProfileStreaks {
  daily_streak:       number;
  checkin_streak:     number;
  last_checkin_date:  string;
}

export interface ProfileAchievements {
  verified_referral_count:  number;
  completed_tasks:          string[];
  milestones_claimed:       number[];
}

export interface ProfileQuests {
  read:           boolean;
  quiz:           boolean;
  tap:             number;
  invite:          boolean;
  bonus_claimed:   boolean;
}

export interface ProfileChapter {
  slug:          string;
  done:          boolean;
  rewards_done:  boolean;
}

export interface ProfileChapters {
  total:      number;
  completed:  number;
  list:       ProfileChapter[];
}

export interface ProfileClan {
  clan_id:          string;
  clan_name:        string;
  clan_photo:       string;
  motto:            string;
  member_count:     number;
  total_real_earned: number;
  role:             string;
}

export interface ProfileSummary {
  account:       string;
  id_type:       'telegram' | 'real';
  identity:      ProfileIdentity;
  economy:       ProfileEconomy;
  streaks:       ProfileStreaks;
  achievements:  ProfileAchievements;
  quests:        ProfileQuests;
  chapters:      ProfileChapters;
  clan:          ProfileClan | null;
}

async function call(action: string, params: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
    const res = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

/** Throws when the ecosystem backend is unconfigured/unreachable/404 — callers
 *  decide how to degrade (e.g. fall back to the WebView embed). */
export async function getProfileSummary(deviceId: string): Promise<ProfileSummary> {
  return await call('realgram-profile-summary', { device_id: deviceId }) as ProfileSummary;
}
