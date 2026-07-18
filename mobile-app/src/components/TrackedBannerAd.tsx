/**
 * TrackedBannerAd — the one place a banner ad is actually requested from AdMob.
 *
 * HomeBanner (Home tab) and AdBanner (Freedom/Servers tab) both render this
 * underneath so the two placements share identical AdMob config (same unit ID,
 * same non-personalized request options, same size) and identical telemetry —
 * only `slot` differs, so admin can tell the two placements apart in the data
 * (Khabat, 2026-07-18: confirm AdMob works regardless of where in the app the
 * user is, and be able to compare the two placements).
 */

import React from 'react';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { BANNER_UNIT_ID } from '../services/adsService';
import { trackEvent } from '../services/analytics';
import { useAuthStore } from '../stores/authStore';

export type BannerSlot = 'home_banner' | 'freedom_banner';

type Props = {
  slot: BannerSlot;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: Error) => void;
};

export function TrackedBannerAd({ slot, onAdLoaded, onAdFailedToLoad }: Props) {
  return (
    <BannerAd
      unitId={BANNER_UNIT_ID}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      onAdLoaded={() => {
        trackEvent('AD_BANNER_LOADED', useAuthStore.getState().user?.deviceId, { slot });
        onAdLoaded?.();
      }}
      onAdFailedToLoad={(error: Error & { code?: string }) => {
        trackEvent('AD_LOAD_ERROR', useAuthStore.getState().user?.deviceId, {
          slot, code: error?.code || '', message: error?.message || '',
        });
        onAdFailedToLoad?.(error);
      }}
      onAdOpened={() => {
        // Nearest thing this SDK exposes to a banner "click" — fires when the
        // user taps the ad and it's about to open (browser/store).
        trackEvent('AD_BANNER_CLICK', useAuthStore.getState().user?.deviceId, { slot });
      }}
      onPaid={(event) => {
        // Impression-level ad revenue — fires once per real, counted impression.
        trackEvent('AD_BANNER_IMPRESSION', useAuthStore.getState().user?.deviceId, {
          slot, value: event.value, currency: event.currency,
        });
      }}
    />
  );
}
