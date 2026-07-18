import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing } from '../design/tokens';
import { TrackedBannerAd } from './TrackedBannerAd';
import { EcosystemBanner } from './EcosystemBanner';

/**
 * HomeBanner — rotates the front-page banner slot between a paid AdMob banner
 * and our own EcosystemBanner promo (Khabat 2026-07-08).
 *
 * Rules:
 *  • Premium users are ad-free → always the ecosystem promo.
 *  • For free users the slot flips to the ad every ROTATE_MS, but the promo stays
 *    visible until the ad has actually loaded (no blank flash), and any ad
 *    load-failure falls straight back to the promo — the ad never leaves an empty
 *    or broken strip on screen.
 */
const ROTATE_MS = 12000;

type Props = {
  /** Offset so different screens start the promo on different items. */
  seed?: number;
  /** Include paid ads in the rotation (free users only). */
  showAds: boolean;
};

export function HomeBanner({ seed = 0, showAds }: Props) {
  const [phase, setPhase]       = useState<'promo' | 'ad'>('promo');
  const [adLoaded, setAdLoaded] = useState(false);

  useEffect(() => {
    if (!showAds) { setPhase('promo'); setAdLoaded(false); return; }
    const id = setInterval(() => {
      setPhase(p => (p === 'promo' ? 'ad' : 'promo'));
      setAdLoaded(false);   // fresh request each ad turn; promo shows until it loads
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [showAds]);

  const showAd = showAds && phase === 'ad';

  return (
    <View>
      {/* Promo stays up until the ad has loaded — avoids a blank slot. */}
      {(!showAd || !adLoaded) && <EcosystemBanner seed={seed} />}

      {showAd && (
        <View style={adLoaded ? styles.adWrap : styles.hidden} pointerEvents={adLoaded ? 'auto' : 'none'}>
          <TrackedBannerAd
            slot="home_banner"
            onAdLoaded={() => setAdLoaded(true)}
            onAdFailedToLoad={() => { setAdLoaded(false); setPhase('promo'); }}
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
  hidden: { height: 0, overflow: 'hidden', opacity: 0 },
});
