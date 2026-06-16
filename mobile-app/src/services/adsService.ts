/**
 * AdMob rewarded ads — earn bonus data by watching a rewarded video.
 *
 * The reward is granted SERVER-SIDE: AdMob calls our SSV endpoint (public/ssv.php)
 * after a verified impression, which credits the device's quota ledger. The client
 * NEVER grants quota itself — it only triggers the ad and then re-syncs entitlement.
 *
 * SSV mapping (see lib/ads_recovery.php ar_verify_ssv): user_id = deviceId,
 * transaction_id = nonce. So we set serverSideVerificationOptions.userId = deviceId;
 * AdMob generates the transaction_id. No /ads/reward/init needed — SSV creates the
 * pending row itself and ar_confirm_reward is idempotent.
 */

import mobileAds, {
  RewardedAd, RewardedAdEventType, AdEventType, TestIds, MaxAdContentRating,
} from 'react-native-google-mobile-ads';

// Production rewarded unit (admob_rewarded_unit_id). Test ID in dev so we never
// serve live ads against test traffic (and avoid policy strikes).
const REWARDED_UNIT_ID = __DEV__
  ? TestIds.REWARDED
  : 'ca-app-pub-5788265416382988/5769978218';

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
    // Leave _initialized false so a later attempt can retry.
  }
}

export type RewardOutcome = { earned: boolean };

/**
 * Load and show a rewarded ad for this device. Resolves { earned } when the ad
 * closes; rejects if the ad fails to load/show. The actual quota credit lands via
 * SSV — callers should re-sync entitlement after `earned` is true.
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
    subs.push(ad.addAdEventListener(AdEventType.ERROR, (e) => finish(() => reject(e as Error))));

    ad.load();
  });
}
