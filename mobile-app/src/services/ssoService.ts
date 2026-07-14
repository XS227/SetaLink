/**
 * Ecosystem SSO client (contract 6).
 *
 * The REAL ecosystem backend is the identity provider: it mints a short-lived
 * JWT for a linked account, signed with its own key, and every ecosystem app
 * (Shahnameh, 3real, TrustAI, …) verifies it with the published public key.
 * The app never holds the ecosystem API key — the SetaLink panel proxies the
 * mint. This service just asks the panel for a token for the current device.
 *
 * Fails safe: `unlinked` → the caller should prompt the user to link their REAL
 * account; `unavailable` → the issuer isn't live yet, load the game as a guest.
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface SsoResult {
  status:      'ok' | 'unlinked' | 'unavailable';
  token:       string;   // JWT (empty unless status==='ok')
  expires_in:  number;   // seconds
  account:     string;
  game_url:    string;   // ecosystem game URL (remote-config, rotatable)
  sso_enabled: boolean;
}

export async function getSsoToken(deviceId: string): Promise<SsoResult> {
  const qs = new URLSearchParams({ mobile: '1', action: 'sso-token', _token: TOKEN, device_id: deviceId });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: SsoResult; error?: string };
    if (!json.ok || !json.data) throw new Error(json.error ?? 'sso error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Build the game URL to load in the WebView. The SSO token (when present) is
 * passed as a query param the ecosystem app reads to authenticate; the
 * device_id is always passed so the game can attribute activity / offer to
 * link even before SSO is live. Guests just get the plain game.
 */
export function buildGameUrl(sso: SsoResult, deviceId: string): string {
  const base = sso.game_url || 'https://shahnameh.setaei.com';
  const sep  = base.includes('?') ? '&' : '?';
  const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
  if (sso.status === 'ok' && sso.token) params.set('sso', sso.token);
  return `${base}${sep}${params.toString()}`;
}
