/**
 * EcosystemFooter — the REAL ecosystem brand row shown with the copyright
 * line, so users see RealGram is one piece of a unified package:
 * game · learn · earn · connect · free.
 *
 * The wordmark chips are typographic placeholders; agent B's RealGram
 * design-identity task (docs/realgram/TASK_SPLIT.md) delivers the real logo
 * set, which swaps in here without touching the screens that embed this.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Radius } from '../design/tokens';
import { useT } from '../i18n';

const BRANDS: { name: string; color: string }[] = [
  { name: 'RealGram',   color: Colors.emerald[400] },
  { name: 'Shahnameh', color: Colors.gold[400] },
  { name: 'TrustAI',   color: Colors.blue[400] },
  { name: 'RealGram',  color: '#C77DFF' },
];

export function EcosystemFooter() {
  const { t } = useT();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {BRANDS.map((b) => (
          <View key={b.name} style={[styles.chip, { borderColor: b.color + '55' }]}>
            <Text style={[styles.chipText, { color: b.color }]}>{b.name}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.tagline}>{t('eco.tagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { alignItems: 'center', gap: 6, marginTop: 10 },
  row:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip:     { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { fontSize: 10, fontFamily: Typography.family.heading, letterSpacing: 0.5 },
  tagline:  { fontSize: Typography.size.xs, color: Colors.text.muted, letterSpacing: 1,
              textTransform: 'lowercase' },
});
