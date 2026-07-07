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
} from 'react-native-google-mobile-ads';

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
