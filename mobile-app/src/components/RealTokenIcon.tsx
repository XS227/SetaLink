import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';

/**
 * RealTokenIcon — the ﷼ glyph in a small gold coin badge, for use anywhere
 * the REAL token needs a compact icon (stat tiles, wallet balance header,
 * exchange-flow icon pairs). RealCoin.tsx already renders this same glyph
 * for the big interactive tap coin; this is the small, static, non-gesture
 * equivalent so call sites that previously used a generic 💎 emoji or the
 * external REAL_TOKEN_IMAGE (a third-party ston.fi asset URL, not a brand
 * asset) have one real, on-brand icon to share instead.
 */
interface Props {
  size?: number;
  style?: object;
}

export function RealTokenIcon({ size = 22, style }: Props) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <Text style={[styles.glyph, { fontSize: Math.round(size * 0.58) }]}>{'﷼'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.gold[400],
    borderWidth: 1,
    borderColor: Colors.gold[600],
  },
  glyph: {
    fontFamily: Typography.family.persian,
    color: '#2E1E00',
  },
});
