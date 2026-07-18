/**
 * AdMob rewarded ads — earn bonus data by watching a rewarded video.
 *
 * The reward is granted SERVER-SIDE: AdMob calls our SSV endpoint (public/ssv.php)
 * after a verified impression, which credits the device's quota ledger. The client
 * NEVER grants quota itself — it only triggers the ad and then re-syncs entitlement.
 *
 * SSV mapping (see lib/ads_recovery.php ar_verify_ssv): user_id = deviceId,
 * transaction_id = nonce. So we set serverSideVerificationOptions.userId = deviceId;
 * AdMob generates the transaction_id.
 */

import { Platform } from 'react-native';
import mobileAds, {
  RewardedAd, RewardedAdEventType, AdEventType, TestIds, MaxAdContentRating,
  InterstitialAd,
} from 'react-native-google-mobile-ads';
import { trackEvent } from './analytics';

// Lazy require to avoid a static import cycle (adsService is imported by
// screens that authStore itself doesn't depend on, but keep the same
// lazy pattern used for vpnStore below just in case).
function currentDeviceId(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAuthStore } = require('../stores/authStore');
    return useAuthStore.getState().user?.deviceId;
  } catch { return undefined; }
}

// Real ids (must match backend admob_app_id / admob_rewarded_unit_id). Test ad unit
// in dev so we never serve live ads against test traffic.
// AdMob ad units belong to ONE app each — the Android unit never fills on iOS,
// which is why rewarded ads were dead there until the iOS unit existed.
export const ADMOB_APP_ID  = Platform.OS === 'ios'
  ? 'ca-app-pub-5788265416382988~9590370979'
  : 'ca-app-pub-5788265416382988~2740153482';
const REWARDED_UNIT_PROD   = Platform.OS === 'ios'
  ? 'ca-app-pub-5788265416382988/2879120797'
  : 'ca-app-pub-5788265416382988/5769978218';

// Diagnostics escape hatch: force Google's always-fill TEST rewarded unit even in
// release. Confirmed the SDK/integration once (v0.9.45) — keep OFF for production;
// the test unit does not call our SSV so it never credits quota.
const FORCE_TEST_REWARDED = false;

export const REWARDED_UNIT_ID =
  (__DEV__ || FORCE_TEST_REWARDED) ? TestIds.REWARDED : REWARDED_UNIT_PROD;

let _initialized = false;

/** Initialize the Mobile Ads SDK once (safe to call repeatedly). */
export async function initAds(): Promise<void> {
  if (_initialized) return;
  try {
    await mobileAds().setRequestConfiguration({
      maxAdContentRating: MaxAdContentRating.PG,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    await mobileAds().initialize();
    _initialized = true;
  } catch {
    // leave _initialized false so a later attempt can retry
  }
}

export type RewardOutcome = { earned: boolean };

type AdError = Error & { code?: string };

/**
 * Load and show a rewarded ad for this device. Resolves { earned } when the ad
 * closes; rejects (with .code when available) if the ad fails to load/show.
 */
export function showRewardedForData(deviceId: string, timeoutMs = 30000): Promise<RewardOutcome> {
  return new Promise<RewardOutcome>((resolve, reject) => {
    if (!deviceId) { reject(new Error('no device id')); return; }

    const ad = RewardedAd.createForAdRequest(REWARDED_UNIT_ID, {
      serverSideVerificationOptions: { userId: deviceId },
      requestNonPersonalizedAdsOnly: true,
    });

    let earned = false;
    let settled = false;
    const subs: Array<() => void> = [];
    const cleanup = () => { subs.forEach((u) => { try { u(); } catch {} }); };
    const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); fn(); };
    const timer = setTimeout(() => finish(() => reject(new Error('ad timeout'))), timeoutMs);

    subs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      try { ad.show(); } catch (e) { finish(() => reject(e as Error)); }
    }));
    subs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }));
    subs.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(() => resolve({ earned }))));
    subs.push(ad.addAdEventListener(AdEventType.ERROR, (e: any) => {
      const err: AdError = new Error(e?.message || 'ad error');
      err.code = e?.code || '';
      finish(() => reject(err));
    }));

    ad.load();
  });
}

// ── Interstitial ads shown on Connect (revenue per connection) ────────────────
// A full-screen interstitial is shown when the user taps Connect, so every new
// connection has a chance to earn ad revenue. It is STRICTLY best-effort: if no
// ad is loaded it never blocks or delays connecting (see showInterstitialOnConnect).
//
// Dedicated Interstitial ad units (one per app; shown on Connect).
const INTERSTITIAL_UNIT_PROD = Platform.OS === 'ios'
  ? 'ca-app-pub-5788265416382988/1585189182'
  : 'ca-app-pub-5788265416382988/2914618117';

export const INTERSTITIAL_UNIT_ID =
  (__DEV__ || FORCE_TEST_REWARDED) ? TestIds.INTERSTITIAL : INTERSTITIAL_UNIT_PROD;

// Banner ad units (one per app; rotated with the ecosystem banner on Home).
const BANNER_UNIT_PROD = Platform.OS === 'ios'
  ? 'ca-app-pub-5788265416382988/9407874272'
  : 'ca-app-pub-5788265416382988/7975373101';

export const BANNER_UNIT_ID =
  (__DEV__ || FORCE_TEST_REWARDED) ? TestIds.BANNER : BANNER_UNIT_PROD;

let _interstitial: InterstitialAd | null = null;
let _interReady   = false;
let _interLoading = false;
let _interLoadedAt     = 0;     // when the current preload finished
let _interLoadedViaVpn = false; // creative was fetched while the tunnel was up

// AdMob interstitials go stale (roughly an hour); a stale show renders blank.
const INTERSTITIAL_MAX_AGE_MS = 55 * 60_000;

// Post-connect show window: when the Connect tap had no ad ready (typical where
// Google is unreachable outside the tunnel), show the ad as soon as a preload
// lands through the freshly-up tunnel — but only within this window, so an ad
// never pops long after the user moved on.
let _pendingShowUntil = 0;
let _pendingRetries   = 0;
const MAX_PENDING_RETRIES = 3;
const RETRY_BACKOFF_MS    = 1200;

// A load against a blocked direct network (Iran) doesn't fail fast — it can hang
// for many seconds before AdMob's SDK gives up. Left unbounded, that hang used to
// occupy `_interLoading` for the whole post-connect window, so the tunnel-side
// retry (which just wants a *new* request) silently no-op'ed against the guard
// below. This timeout force-fails a stuck load so a fresh one can start.
const INTERSTITIAL_LOAD_TIMEOUT_MS = 8_000;
let _loadToken = 0;       // bumped on every new load; late callbacks from a
                          // superseded attempt check this and no-op instead of
                          // corrupting the state of whatever load replaced them
let _loadTimer: ReturnType<typeof setTimeout> | null = null;

function clearLoadTimer(): void {
  if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
}

function vpnConnectedNow(): boolean {
  try {
    // Lazy require: avoids a static import cycle (screens → adsService → stores)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useVpnStore } = require('../stores/vpnStore');
    return useVpnStore.getState().connectionState === 'connected';
  } catch { return false; }
}

/** An ad loaded through the tunnel cannot stream its creative once the tunnel is
 *  down (Google is blocked on the direct network in our main markets) — showing
 *  it then renders a blank flash. Expired ads do the same. */
function interstitialIsStale(): boolean {
  if (Date.now() - _interLoadedAt > INTERSTITIAL_MAX_AGE_MS) return true;
  return _interLoadedViaVpn && !vpnConnectedNow();
}

function dropInterstitial(): void {
  clearLoadTimer();
  _interstitial = null; _interReady = false; _interLoading = false;
}

/** Bounded, backed-off retry shared by the load-error and load-timeout paths —
 *  only fires while a post-connect show window is still open, so a market
 *  where AdMob simply never fills doesn't retry forever. */
function retryPendingLoad(): void {
  if (!(_pendingShowUntil && Date.now() <= _pendingShowUntil)) return;
  if (_pendingRetries >= MAX_PENDING_RETRIES) return;
  _pendingRetries += 1;
  setTimeout(() => preloadInterstitial(), RETRY_BACKOFF_MS);
}

/** Preload one interstitial so it is ready by the next Connect tap. Idempotent;
 *  self-reloads after each show/error. Never throws. */
export function preloadInterstitial(): void {
  if (_interReady || _interLoading) return;
  const token = ++_loadToken;
  try {
    _interLoading = true;
    const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    _loadTimer = setTimeout(() => {
      if (token !== _loadToken) return;   // a newer load already replaced this one
      trackEvent('AD_LOAD_ERROR', currentDeviceId(), {
        slot: 'interstitial', code: 'timeout',
        message: `load exceeded ${INTERSTITIAL_LOAD_TIMEOUT_MS}ms — likely blocked direct network`,
      });
      _interLoading = false;
      _loadTimer = null;
      retryPendingLoad();
    }, INTERSTITIAL_LOAD_TIMEOUT_MS);

    ad.addAdEventListener(AdEventType.LOADED, () => {
      if (token !== _loadToken) return;   // stale — a fresher attempt has since started
      clearLoadTimer();
      _interReady = true; _interLoading = false;
      _interLoadedAt = Date.now();
      _interLoadedViaVpn = vpnConnectedNow();
      // A post-connect show was requested and the window is still open → show
      // now, while the tunnel that fetched the creative is still up.
      if (_pendingShowUntil && Date.now() <= _pendingShowUntil && vpnConnectedNow()) {
        _pendingShowUntil = 0;
        try { ad.show(); _interReady = false; } catch { dropInterstitial(); }
      }
    });
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      if (token !== _loadToken) return;
      dropInterstitial();
      preloadInterstitial();   // get the next one ready
    });
    ad.addAdEventListener(AdEventType.ERROR, (e: any) => {
      if (token !== _loadToken) return;
      // Was silent before — interstitial failures had zero telemetry, unlike
      // the rewarded path's AD_LOAD_ERROR, which made "no ads at all" reports
      // impossible to diagnose (no-fill vs network vs something else).
      trackEvent('AD_LOAD_ERROR', currentDeviceId(), {
        slot: 'interstitial', code: e?.code || '', message: e?.message || '',
      });
      dropInterstitial();
      // Loads started just before the tunnel came up often die in the network
      // switch — retry (bounded, backed off) while a post-connect window is open.
      retryPendingLoad();
    });
    _interstitial = ad;
    ad.load();
  } catch {
    _interLoading = false;
  }
}

/**
 * Show a preloaded interstitial if — and only if — one is ready RIGHT NOW.
 * NON-BLOCKING by contract: returns immediately, never awaits an ad load, so it
 * can never stand between the user and connecting. When nothing is ready it just
 * kicks off a preload for the next Connect. Returns true if an ad was shown.
 */
export function showInterstitialOnConnect(): boolean {
  if (_interReady && _interstitial) {
    if (interstitialIsStale()) {
      // Tunnel-loaded or expired ad would flash blank — drop it and reload.
      dropInterstitial();
      preloadInterstitial();
      return false;
    }
    try {
      _interstitial.show();
      _interReady = false;   // one-shot; CLOSED handler preloads the next
      return true;
    } catch {
      dropInterstitial();
    }
  }
  preloadInterstitial();     // not ready → prepare for next time, don't block
  return false;
}

/**
 * Fallback for markets where the ad can only load THROUGH the tunnel (e.g. Iran,
 * where Google is unreachable on the direct network): call on the transition to
 * connected when the Connect tap showed nothing. Shows a ready ad immediately,
 * otherwise preloads via the tunnel and shows on arrival — but only within
 * `windowMs`, so nothing pops up long after connecting. Never throws.
 */
export function showInterstitialAfterConnect(windowMs = 12_000): boolean {
  if (_interReady && _interstitial && !interstitialIsStale()) {
    try {
      _interstitial.show();
      _interReady = false;
      return true;
    } catch {
      dropInterstitial();
    }
  }
  _pendingShowUntil = Date.now() + windowMs;
  _pendingRetries   = 0;
  if (_interReady) dropInterstitial();   // stale leftover → replace via tunnel
  // Force a genuinely fresh load through the now-up tunnel. A preload kicked off
  // before the tunnel existed may still be in flight (and, against a blocked
  // direct network, can hang well past this point) — invalidate it via the token
  // and clear the loading flag so the call below actually starts a new request
  // instead of being no-op'ed by the "already loading" guard.
  _loadToken += 1;
  _interLoading = false;
  preloadInterstitial();
  return false;
}

/**
 * Call when the VPN tunnel goes down. Never fires a new load attempt here — in
 * a market where Google is only reachable through the tunnel that would just be
 * a doomed direct-network request. Only clears in-flight state so a stuck
 * loading flag can't block the fresh load `showInterstitialAfterConnect` fires
 * on the next Connect. Any already-loaded creative is left in place; the
 * existing staleness check drops it lazily at show-time if it was fetched via
 * the (now-down) tunnel.
 */
export function notifyVpnDisconnected(): void {
  _loadToken += 1;
  clearLoadTimer();
  _interLoading = false;
  _pendingShowUntil = 0;
}
