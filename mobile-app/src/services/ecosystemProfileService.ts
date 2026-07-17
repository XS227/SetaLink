/**
 * Ecosystem profile service — cross-app identity layer.
 *
 * The `real_profiles` table on the SetaLink panel is the single source of truth
 * for a user's visible identity across all REAL products (ReaLink, RealGram,
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

async function get(action: string, params: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const qs  = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
    const res = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'profile API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Push the current ReaLink identity to the shared profile store.
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
