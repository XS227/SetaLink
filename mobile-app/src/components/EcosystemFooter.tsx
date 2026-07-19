/**
 * EcosystemFooter — the REAL ecosystem brand row shown with the copyright
 * line, so users see RealGram is one piece of a unified package:
 * game · learn · earn · connect · free.
 *
 * Real logo lockups (B-15, agent B's RealGram design-identity task) —
 * pre-colored SVGs from brand/lockup-*.svg, rasterized to bundled PNGs
 * @1x/2x/3x since this codebase's logo-mark convention is require()'d
 * bitmaps (see src/assets/logo_mark.png) rather than react-native-svg.
 */

import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { useT } from '../i18n';

const BRANDS: { name: string; source: number; width: number }[] = [
  { name: 'Realink',   source: require('../assets/ecosystem/lockup-realink.png'),   width: 66 },
  { name: 'Shahnameh', source: require('../assets/ecosystem/lockup-shahnameh.png'), width: 84 },
  { name: 'TrustAI',   source: require('../assets/ecosystem/lockup-trustai.png'),   width: 65 },
  { name: 'RealGram',  source: require('../assets/ecosystem/lockup-realgram.png'),  width: 80 },
];

export function EcosystemFooter() {
  const { t } = useT();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {BRANDS.map((b) => (
          <Image
            key={b.name}
            source={b.source}
            style={{ width: b.width, height: 22 }}
            resizeMode="contain"
            accessibilityLabel={b.name}
          />
        ))}
      </View>
      <Text style={styles.tagline}>{t('eco.tagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { alignItems: 'center', gap: 8, marginTop: 10 },
  row:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 14 },
  tagline:  { fontSize: Typography.size.xs, color: Colors.text.muted, letterSpacing: 1,
              textTransform: 'lowercase' },
});
