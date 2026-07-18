/**
 * AdBanner — a single bare AdMob banner ad (B-19: Servers gets "1 AdMob
 * only", no promo rotation — unlike HomeBanner, which deliberately mixes
 * in the ecosystem cross-promo for Home). Hidden until it loads (no blank
 * flash) and collapses to nothing on load failure (no dead space). Premium
 * users never see it — gate with `show` at the call site.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing } from '../design/tokens';
import { TrackedBannerAd } from './TrackedBannerAd';

export function AdBanner({ show, style }: { show: boolean; style?: object }) {
  const [loaded, setLoaded] = useState(false);

  if (!show) return null;

  return (
    <View style={[loaded ? styles.wrap : styles.hidden, style]} pointerEvents={loaded ? 'auto' : 'none'}>
      <TrackedBannerAd
        slot="freedom_banner"
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setLoaded(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
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
