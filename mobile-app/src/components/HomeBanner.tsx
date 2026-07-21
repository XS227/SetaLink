import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing } from '../design/tokens';
import { TrackedBannerAd } from './TrackedBannerAd';
import { RealGramInfoCard } from './RealGramInfoCard';

/**
 * HomeBanner — a fixed AdMob banner on the front page, falling back to a
 * tasteful RealGram info card when there's no ad to show (Khabat 2026-07-08,
 * revised 2026-07-19: dropped the timed ad/promo rotation — a banner slot
 * doesn't need to cycle, it just needs to show the right thing once it's
 * ready; revised again 2026-07-22: this slot is the AdMob monetization
 * placement now — the old Shahnameh/3real cross-promo (EcosystemBanner)
 * doesn't belong here anymore, that's a separate, deliberate placement
 * elsewhere if/when needed).
 *
 * Rules:
 *  • Premium users are ad-free → always the ecosystem promo, no ad requested.
 *  • Free users: request the ad once per mount. Promo stays visible until the
 *    ad has actually loaded (no blank flash) or fails (falls back to promo
 *    for good on this mount — no retry loop fighting the layout).
 *  • The ad view is always mounted (so AdMob can size/load it), just
 *    positioned off-screen and invisible pre-load instead of collapsed to
 *    height 0 — collapsing a live native ad view's height and un-collapsing
 *    it later doesn't reliably force the native side to re-measure, which is
 *    how a banner can log as loaded and still never actually appear.
 */
type Props = {
  /** Offset so different screens start the promo on different items. */
  seed?: number;
  /** Request a paid ad for this placement (free users only). */
  showAds: boolean;
};

export function HomeBanner({ seed = 0, showAds }: Props) {
  const [adLoaded, setAdLoaded] = useState(false);
  const [adFailed, setAdFailed] = useState(false);

  const adShowing = showAds && adLoaded && !adFailed;

  return (
    <View>
      {/* Info-card fallback covers: ads off, ad not loaded yet, or ad failed. */}
      {!adShowing && <RealGramInfoCard />}

      {showAds && !adFailed && (
        <View
          style={adLoaded ? styles.adWrap : styles.adPending}
          pointerEvents={adLoaded ? 'auto' : 'none'}
        >
          <TrackedBannerAd
            slot="home_banner"
            onAdLoaded={() => setAdLoaded(true)}
            onAdFailedToLoad={() => setAdFailed(true)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Paid ads render inside the same card frame as the server rows / promo card,
  // so the slot keeps one calm, consistent shape whichever content is showing.
  adWrap: {
    alignItems: 'center',
    paddingVertical: Spacing[2],
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    overflow: 'hidden',
  },
  // Still fully laid out/measured (so AdMob's adaptive-banner sizing and the
  // native view itself are real, not zeroed) — just moved out of flow and
  // made invisible until it has something to show. No height/overflow
  // tricks, which is what left native views stuck at a stale size before.
  adPending: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
});
