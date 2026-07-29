/**
 * Ecosystem profile service — cross-app identity layer.
 *
 * The `real_profiles` table on the SetaLink panel is the single source of truth
 * for a user's visible identity across all REAL products (RealGram, RealGram,
 * Shahnameh, TrustAI, 3REAL). This service reads/writes it so the user only
 * sets their avatar and handle once, and it follows them everywhere.
 *
 * When B-8 (RS256 JWT issuer) is live, the JWT will carry profile claims as
 * well; callers should prefer JWT claims when available and fall back to this
 * API. The API is forward-compatible: it will be updated to proxy B-8 without
 * requiring an app release.
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 8_000;

export interface EcosystemProfile {
  account:      string;
  handle:       string;
  display_name: string;
  avatar_emoji: string;
  avatar_color: string;
  persona:      string;
  updated_at?:  string;
}

async function post(action: string, body: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const form = new FormData();
    form.append('_token', TOKEN);
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    const res  = await fetch(`${BASE_URL}?mobile=1&action=${action}`, {
      method: 'POST', body: form, signal: ctrl.signal,
    });
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'profile API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

// Khabat, 2026-07-29: found while adding getPeerProfile below — every
// action in api.php's ecosystem-profile section lives inside its
// `if ($method === 'POST')` block server-side (params still read from
// $_GET, but the request itself is rejected with "unknown action"
// unless the HTTP method is POST — confirmed live: a plain GET to
// get-real-profile 404s-as-"unknown action", the identical request as
// POST succeeds). This helper was issuing a real GET. Zero production
// impact so far — fetchEcosystemProfile (the only caller) is itself
// never called from any screen — but would have silently failed the
// moment something did call it. Fixed at the transport level, params
// still travel in the query string same as before.
async function get(action: string, params: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const qs  = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
    const res = await fetch(`${BASE_URL}?${qs.toString()}`, { method: 'POST', signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'profile API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Push the current RealGram identity to the shared profile store.
 * Called after REAL-ID linking and when the user updates their profile.
 * Silently no-ops on network failure (profile sync is best-effort).
 */
export async function pushEcosystemProfile(
  deviceId:    string,
  handle:      string,
  displayName: string,
  avatarEmoji: string,
  avatarColor: string,
  persona:     string,
): Promise<void> {
  if (!deviceId) return;
  try {
    await post('save-real-profile', {
      device_id:    deviceId,
      handle,
      display_name: displayName,
      avatar_emoji: avatarEmoji,
      avatar_color: avatarColor,
      persona:      persona || '',
    });
  } catch { /* best-effort */ }
}

/**
 * Read the shared ecosystem profile for a given REAL account.
 * Used by Shahnameh / RealGram / TrustAI to resolve avatar+handle
 * without re-asking the user. Returns null on error.
 */
export async function fetchEcosystemProfile(account: string): Promise<EcosystemProfile | null> {
  if (!account) return null;
  try {
    const data = await get('get-real-profile', { account });
    return data as EcosystemProfile;
  } catch {
    return null;
  }
}

export interface PeerProfile {
  user_id:      string;
  account?:     string;
  handle?:      string;
  display_name?: string;
  avatar_emoji?: string;
  avatar_color?: string;
  persona?:     string;
}

/**
 * Read another user's public RealGram profile from their device_id — the
 * one identifier a DM thread actually carries (Khabat, 2026-07-29: "trykk
 * på profilbilde til sender... se deres realgram profil og offentlig
 * info"). Resolves device_id -> linked account -> the same public profile
 * fetchEcosystemProfile reads by account (api.php's new get-peer-profile
 * action, same "open to all apps" posture as get-real-profile — no new
 * data exposure, just a new lookup path). Returns null on error; a
 * peer who's never set a handle/avatar still resolves with just
 * `user_id` (a real, honest "no public profile yet" state, not a
 * failure).
 */
export async function getPeerProfile(peerDeviceId: string): Promise<PeerProfile | null> {
  if (!peerDeviceId) return null;
  try {
    const data = await get('get-peer-profile', { device_id: peerDeviceId });
    return data as PeerProfile;
  } catch {
    return null;
  }
}
