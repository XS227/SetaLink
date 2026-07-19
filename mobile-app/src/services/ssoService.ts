/**
 * Ecosystem SSO client (contract 6).
 *
 * REAL-ID is the canonical identity shared across all REAL ecosystem products
 * (Shahnameh, 3REAL, TrustAI, RealGram). The panel proxies the SSO mint so
 * the app never holds the ecosystem API key.
 *
 * Flow:
 *   1. App sends device_id (secure lookup key) to the panel.
 *   2. Panel checks for a linked REAL-ID and mints a short-lived RS256 JWT.
 *   3. JWT + real_id are passed to the WebView URL for authentication.
 *
 * status values:
 *   'ok'          — JWT minted; game opens directly, no extra login
 *   'unlinked'    — device has no REAL-ID; caller shows creation prompt
 *   'unavailable' — issuer unreachable; caller may retry silently
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

/**
 * @param forGame - true only for Shahnameh game entry points (GameScreen:
 *   checkAndCacheRealId, GameWebView, RealIdGate.checkLinked). Opts into the
 *   panel's REAL-ID auto-fallback (re_sso_token() in real_economy.php): no
 *   linked Telegram account -> mint straight off the device's own RealGram
 *   identity instead of returning 'unlinked', so opening the game never
 *   requires a Telegram sign-in. Deliberately NOT the default —
 *   TrustAiLinkScreen shares this same call and is a separate product this
 *   repo doesn't own; auto-provisioning there hasn't been discussed, so it
 *   keeps the original 'unlinked' behavior.
 */
export async function getSsoToken(deviceId: string, forGame = false): Promise<SsoResult> {
  const qs = new URLSearchParams({ mobile: '1', action: 'sso-token', _token: TOKEN, device_id: deviceId });
  if (forGame) qs.set('game', '1');
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
 * Build the authenticated game URL.
 *
 * Identity in the URL (priority order):
 *   sso=JWT     primary auth — game verifies with RS256 public key
 *   real_id     REAL-ID for pre-auth routing / ZAR attribution
 *   device_id   security context (rate-limiting, anti-abuse only — NOT the account)
 *   src         traffic source tag
 */
/**
 * Silently probe SSO on mount/tab-open. If already linked server-side
 * (e.g. user linked via Telegram deep-link in a previous session), this
 * caches the REAL-ID in authStore so the gate disappears immediately.
 * Never throws; safe to call without awaiting.
 */
export async function checkAndCacheRealId(deviceId: string): Promise<void> {
  if (!deviceId) return;
  try {
    const r = await getSsoToken(deviceId, true);
    if (r.status === 'ok' && r.account) {
      // Lazy require avoids circular import: ssoService ↛ authStore at module load.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAuthStore } = require('../stores/authStore');
      const current = useAuthStore.getState().user?.realId;
      if (!current) useAuthStore.getState().setRealId(r.account);
    }
  } catch { /* network unreachable — ignore */ }
}

export function buildGameUrl(sso: SsoResult, deviceId: string, realId?: string): string {
  const base   = sso.game_url || 'https://shahnameh.setaei.com';
  const sep    = base.includes('?') ? '&' : '?';
  const params = new URLSearchParams({ src: 'realink', device_id: deviceId });
  const id     = realId || sso.account;
  if (id)                                params.set('real_id', id);
  if (sso.status === 'ok' && sso.token) params.set('sso', sso.token);
  return `${base}${sep}${params.toString()}`;
}
