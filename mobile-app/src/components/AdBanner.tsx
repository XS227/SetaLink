/**
 * AdBanner — a single, fixed AdMob banner ad (B-19: Servers gets "1 AdMob
 * only", no promo rotation — unlike HomeBanner, which falls back to the
 * ecosystem cross-promo for Home). Invisible until it loads (no blank
 * flash) and collapses to nothing on load failure (no dead space). Premium
 * users never see it — gate with `show` at the call site.
 *
 * Revised 2026-07-19: was collapsing this to `height: 0` pre-load and
 * un-collapsing it once `onAdLoaded` fired. That let the banner report as
 * loaded (telemetry fires regardless of layout) while never actually
 * becoming visible — collapsing a live native ad view's height doesn't
 * reliably make the native side re-measure once JS flips the style back.
 * Now the ad view stays normally laid out/measured throughout; only its
 * position + opacity change, which native views handle correctly.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing } from '../design/tokens';
import { TrackedBannerAd, BannerSlot } from './TrackedBannerAd';

export function AdBanner({ show, style, slot = 'freedom_banner' }: { show: boolean; style?: object; slot?: BannerSlot }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!show || failed) return null;

  return (
    <View
      style={[loaded ? styles.wrap : styles.pending, style]}
      pointerEvents={loaded ? 'auto' : 'none'}
    >
      <TrackedBannerAd
        slot={slot}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
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
  // Fully laid out/measured (real native view, real adaptive-banner size),
  // just off-flow and invisible until there's an ad to show — see header
  // comment for why this replaced a height:0 collapse.
  pending: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
});
