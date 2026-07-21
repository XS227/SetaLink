/**
 * RealGramInfoCard — tasteful, non-promotional filler for the Home ad slot
 * when no AdMob ad is available to show (Khabat, 2026-07-22: the old
 * "Play Shahnameh — earn REAL" EcosystemBanner promo doesn't belong in this
 * spot anymore — this slot is the AdMob placement now, not a cross-promo
 * strip). Same card geometry as ServerRow/EcosystemBanner so the layout
 * doesn't shift depending on what's showing.
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';

const REAL_LOGO_MARK = require('../assets/logo_mark.png');

export function RealGramInfoCard() {
  return (
    <View style={styles.card}>
      <Image source={REAL_LOGO_MARK} style={styles.mark} resizeMode="contain" />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>RealGram</Text>
        <Text style={styles.sub} numberOfLines={1}>realgram.no</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  mark: { width: 28, height: 28 },
  body: { flex: 1 },
  title: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.secondary },
  sub: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
});
