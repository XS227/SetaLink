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

import mobileAds, {
  RewardedAd, RewardedAdEventType, AdEventType, TestIds, MaxAdContentRating,
} from 'react-native-google-mobile-ads';

// Real ids (must match backend admob_app_id / admob_rewarded_unit_id). Test ad unit
// in dev so we never serve live ads against test traffic.
export const ADMOB_APP_ID  = 'ca-app-pub-5788265416382988~2740153482';
const REWARDED_UNIT_PROD   = 'ca-app-pub-5788265416382988/5769978218';
export const REWARDED_UNIT_ID = __DEV__ ? TestIds.REWARDED : REWARDED_UNIT_PROD;

let _initialized = false;
let _adapterStatuses: Record<string, { state: number; description: string }> = {};
let _initError = '';

/** Initialize the Mobile Ads SDK once (safe to call repeatedly). */
export async function initAds(): Promise<void> {
  if (_initialized) return;
  try {
    await mobileAds().setRequestConfiguration({
      maxAdContentRating: MaxAdContentRating.PG,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
    });
    const statuses = await mobileAds().initialize();
    // statuses is an array of AdapterStatus { name, state, description }
    _adapterStatuses = {};
    (statuses as any[] || []).forEach((s) => {
      if (s?.name) _adapterStatuses[s.name] = { state: s.state, description: s.description };
    });
    _initialized = true;
  } catch (e) {
    _initError = (e as Error)?.message || String(e);
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

export type AdDiagnostics = {
  sdkInitialized: boolean;
  initError: string;
  adapters: Record<string, { state: number; description: string }>;
  appId: string;
  adUnitId: string;
  isDevUnit: boolean;
  loadOk: boolean;
  errorCode: string;
  errorMessage: string;
};

/**
 * Standalone diagnostics: (re)initialize, then attempt a single rewarded load and
 * capture the exact outcome — SDK init, adapter states, the app/ad-unit ids actually
 * used, and any load error code/message. Distinguishes no-fill from misconfiguration.
 */
export function runAdDiagnostics(deviceId: string, timeoutMs = 20000): Promise<AdDiagnostics> {
  return new Promise<AdDiagnostics>(async (resolve) => {
    await initAds();
    const base: AdDiagnostics = {
      sdkInitialized: _initialized,
      initError: _initError,
      adapters: _adapterStatuses,
      appId: ADMOB_APP_ID,
      adUnitId: REWARDED_UNIT_ID,
      isDevUnit: __DEV__,
      loadOk: false,
      errorCode: '',
      errorMessage: '',
    };

    const ad = RewardedAd.createForAdRequest(REWARDED_UNIT_ID, {
      serverSideVerificationOptions: { userId: deviceId },
      requestNonPersonalizedAdsOnly: true,
    });
    let done = false;
    const subs: Array<() => void> = [];
    const cleanup = () => subs.forEach((u) => { try { u(); } catch {} });
    const finish = (patch: Partial<AdDiagnostics>) => {
      if (done) return; done = true; clearTimeout(timer); cleanup();
      resolve({ ...base, ...patch });
    };
    const timer = setTimeout(() => finish({ errorCode: 'timeout', errorMessage: 'load timed out' }), timeoutMs);

    subs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => finish({ loadOk: true })));
    subs.push(ad.addAdEventListener(AdEventType.ERROR, (e: any) =>
      finish({ errorCode: e?.code || 'error', errorMessage: e?.message || 'unknown' })));

    try { ad.load(); } catch (e) { finish({ errorCode: 'throw', errorMessage: (e as Error).message }); }
  });
}
