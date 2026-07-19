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
  const url = `${BASE_URL}?${qs.toString()}`;
  // TEMP DEBUG (2026-07-19, Khabat's build-109 real-device report: zero
  // /v1/sso-token requests ever leave the phone, incl. after "Try again").
  // This is the actual network boundary — log here so nothing upstream
  // (checkAndCacheRealId's catch, RealIdGate.retry) can hide *why* a call
  // never completed. Remove once confirmed fixed on device.
  console.log('[REALDBG:5/7] getSsoToken: about to fetch', { url, deviceId, forGame });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => {
    console.log('[REALDBG:5/7] getSsoToken: TIMEOUT firing abort()', { url, timeoutMs: TIMEOUT });
    ctrl.abort();
  }, TIMEOUT);
  // Hard watchdog, independent of the AbortController above (2026-07-19,
  // Khabat's black-spinner investigation): server-side access-log evidence
  // shows real Android requests never even reach shahnameh.setaei.com on
  // the affected device, which points here — some Android/network stacks
  // (plausibly this app's own VPN tunnel) don't actually unstick a
  // genuinely hung fetch() when .abort() is called, leaving this whole
  // function's promise pending forever despite the timer above firing.
  // Every caller (checkAndCacheRealId -> ShahnamehEmbed's identity probe,
  // RealIdGate.retry, ShahnamehWebView) awaits this directly, so an
  // unbounded hang here is indistinguishable from "still loading" at every
  // one of those call sites — exactly the reported symptom. This forces a
  // bound regardless of whether abort() actually works on this device.
  const hardTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      console.log('[REALDBG:5/7] getSsoToken: HARD TIMEOUT — fetch() never settled even after abort(), forcing failure', { url, afterMs: TIMEOUT + 3000 });
      reject(Object.assign(new Error('sso-token hard timeout'), { code: 'HARD_TIMEOUT' }));
    }, TIMEOUT + 3000);
  });
  try {
    let res;
    try {
      res = await Promise.race([fetch(url, { signal: ctrl.signal }), hardTimeout]);
    } catch (e: any) {
      console.log('[REALDBG:5/7] getSsoToken: fetch() itself threw — request never reached the server', {
        name: e?.name, message: e?.message, code: e?.code,
      });
      throw e;
    }
    console.log('[REALDBG:5/7] getSsoToken: fetch resolved', { httpStatus: res.status });
    const json = await res.json() as { ok: boolean; data?: SsoResult; error?: string };
    if (!json.ok || !json.data) {
      console.log('[REALDBG:5/7] getSsoToken: server responded but json.ok is false', { json });
      throw new Error(json.error ?? 'sso error');
    }
    console.log('[REALDBG:5/7] getSsoToken: success', { status: json.data.status, hasToken: !!json.data.token });
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
  // TEMP DEBUG (2026-07-19, build-109 real-device report) — this function's
  // contract is "never throws", which previously meant its catch swallowed
  // the real failure reason completely (getSsoToken's exact error was never
  // visible anywhere). Logging every branch here so "why" is always on
  // record even though the function still resolves cleanly for callers.
  console.log('[REALDBG:4/7] checkAndCacheRealId: starting', { deviceId, hasDeviceId: !!deviceId });
  if (!deviceId) {
    console.log('[REALDBG:4/7] checkAndCacheRealId: ABORTING — deviceId is empty, getSsoToken will never be called');
    return;
  }
  try {
    const r = await getSsoToken(deviceId, true);
    console.log('[REALDBG:4/7] checkAndCacheRealId: getSsoToken returned', { status: r.status, hasAccount: !!r.account });
    if (r.status === 'ok' && r.account) {
      // Lazy require avoids circular import: ssoService ↛ authStore at module load.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAuthStore } = require('../stores/authStore');
      const current = useAuthStore.getState().user?.realId;
      if (!current) {
        useAuthStore.getState().setRealId(r.account);
        console.log('[REALDBG:4/7] checkAndCacheRealId: setRealId applied', { account: r.account });
      } else {
        console.log('[REALDBG:4/7] checkAndCacheRealId: realId already cached, not overwriting', { current });
      }
    } else {
      console.log('[REALDBG:4/7] checkAndCacheRealId: NOT applying — status/account did not qualify', {
        status: r.status, account: r.account,
      });
    }
  } catch (e: any) {
    // Previously: silent. This is the exact reason "Try again" can look like
    // it does nothing — getSsoToken threw and nobody ever saw why.
    console.log('[REALDBG:4/7] checkAndCacheRealId: getSsoToken THREW (swallowed for caller, logged here)', {
      name: e?.name, message: e?.message,
    });
  }
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
