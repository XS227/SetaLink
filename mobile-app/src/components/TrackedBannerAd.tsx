/**
 * TrackedBannerAd — the one place a banner ad is actually requested from AdMob.
 *
 * HomeBanner (Home tab) and AdBanner (Freedom/Servers tab) both render this
 * underneath so the two placements share identical AdMob config (same unit ID,
 * same non-personalized request options, same size) and identical telemetry —
 * only `slot` differs, so admin can tell the two placements apart in the data
 * (Khabat, 2026-07-18: confirm AdMob works regardless of where in the app the
 * user is, and be able to compare the two placements).
 *
 * Revised 2026-07-20 (Khabat: fix excessive AD_LOAD_ERROR volume on
 * home_banner/interstitial):
 *  - Waits for `initAds()`/MobileAds.initialize() to actually finish before
 *    the underlying <BannerAd> ever mounts, instead of racing it.
 *  - A failed load retries itself via the native `.load()` command (same
 *    mounted instance, same native view — no remount, no fresh AdMob "new
 *    banner" cycle) on the shared 5s/15s/30s backoff, then gives up and tells
 *    the parent so it can fall back to the promo. A LOADED banner is never
 *    reloaded — it just sits there until the component itself unmounts.
 *  - A per-slot module-level lock stops two instances of the same slot from
 *    ever having overlapping in-flight loads.
 */

import React, { useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
// Type-only import — erased at compile time, so it never becomes a runtime
// require() and is safe to keep even on Windows (see the guarded value
// require() below, which IS a real runtime import and must stay conditional).
import type { BannerAd as BannerAdInstance } from 'react-native-google-mobile-ads';
import {
  ADS_SUPPORTED, AD_RETRY_BACKOFF_MS, BANNER_UNIT_ID, initAds, isAdsInitialized, vpnConnectedNow,
} from '../services/adsService';
import { trackEvent } from '../services/analytics';
import { useAuthStore } from '../stores/authStore';

// Same reasoning as adsService.ts: react-native-google-mobile-ads throws at
// MODULE LOAD TIME on a platform without a native implementation, so the
// package must never be required at all on Windows — not even just to grab
// its types. Guarded so the require() itself is skipped there.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BannerAd, BannerAdSize } = ADS_SUPPORTED
  ? require('react-native-google-mobile-ads')
  : { BannerAd: null as any, BannerAdSize: null as any };

export type BannerSlot = 'home_banner' | 'freedom_banner' | 'inbox_banner';

type Props = {
  slot: BannerSlot;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: Error) => void;
};

// One load in flight per slot, ever — guards against two mounted instances of
// the same slot (shouldn't normally happen, but is cheap to make impossible).
const _slotLoading: Partial<Record<BannerSlot, boolean>> = {};

export function TrackedBannerAd({ slot, onAdLoaded, onAdFailedToLoad }: Props) {
  const [ready, setReady] = useState(isAdsInitialized());
  // Khabat, 2026-07-29: real device session showed the banner's automatic
  // native ad request landing right as a screen was still transitioning in
  // (app-wide lag + Profile flicker report) — hold the actual <BannerAd>
  // mount (and its implicit request) until the transition/interactions
  // settle, same fix as adsService.ts's interstitial/rewarded loaders.
  const [interactionsDone, setInteractionsDone] = useState(false);
  const adRef = useRef<BannerAdInstance>(null);
  const retryIdxRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    initAds().then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [ready]);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setInteractionsDone(true));
    return () => handle.cancel();
  }, []);

  useEffect(() => () => {
    // Unmount: release this slot's lock and cancel any pending retry so a
    // stale timer from a torn-down instance can't fire `.load()` on nothing.
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    _slotLoading[slot] = false;
  }, [slot]);

  // AdMob's SDK has no "request started" callback of its own — the BannerAd
  // view requests automatically on mount. Fired here (not derived server-side
  // as loaded+failed) so admin's Requests column reflects every mount
  // attempt, even one that never resolves (e.g. the app backgrounded before
  // load/fail fired) — see docs/realgram/TASK_SPLIT.md banner-ads-admin entry.
  useEffect(() => {
    if (!ADS_SUPPORTED || !ready || !interactionsDone) return;
    _slotLoading[slot] = true;
    trackEvent('AD_BANNER_REQUEST', useAuthStore.getState().user?.deviceId, { slot });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, ready, interactionsDone]);

  // ADS_SUPPORTED checked first: `ready` can still flip true on Windows (see
  // adsService.ts's initAds(), which resolves without an SDK on unsupported
  // platforms) — this must short-circuit before ever reaching <BannerAd>,
  // which is null there.
  if (!ADS_SUPPORTED || !ready || !interactionsDone) return null;

  return (
    <BannerAd
      ref={adRef}
      unitId={BANNER_UNIT_ID}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      onAdLoaded={() => {
        _slotLoading[slot] = false;
        retryIdxRef.current = 0;
        trackEvent('AD_BANNER_LOADED', useAuthStore.getState().user?.deviceId, { slot });
        onAdLoaded?.();
      }}
      onAdFailedToLoad={(error: Error & { code?: string; namespace?: string }) => {
        trackEvent('AD_LOAD_ERROR', useAuthStore.getState().user?.deviceId, {
          slot, domain: error?.namespace || 'googleMobileAds',
          code: error?.code || '', message: error?.message || '',
          vpn_connected: vpnConnectedNow(), platform: Platform.OS,
        });

        if (retryIdxRef.current < AD_RETRY_BACKOFF_MS.length) {
          const delay = AD_RETRY_BACKOFF_MS[retryIdxRef.current];
          retryIdxRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            if (_slotLoading[slot] === false) return;   // instance unmounted meanwhile
            adRef.current?.load();
          }, delay);
          return;   // don't tell the parent yet — still retrying, keep showing pending state
        }

        // Backoff exhausted — stop retrying temporarily and let the parent fall
        // back to the promo/hide, same as a terminal failure always did.
        _slotLoading[slot] = false;
        onAdFailedToLoad?.(error);
      }}
      onAdOpened={() => {
        // Nearest thing this SDK exposes to a banner "click" — fires when the
        // user taps the ad and it's about to open (browser/store).
        trackEvent('AD_BANNER_CLICK', useAuthStore.getState().user?.deviceId, { slot });
      }}
      onPaid={(event: { value: number; currency: string }) => {
        // Impression-level ad revenue — fires once per real, counted impression.
        trackEvent('AD_BANNER_IMPRESSION', useAuthStore.getState().user?.deviceId, {
          slot, value: event.value, currency: event.currency,
        });
      }}
    />
  );
}
