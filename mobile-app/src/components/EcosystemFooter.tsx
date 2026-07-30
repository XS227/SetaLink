/**
 * EcosystemFooter — the REAL ecosystem brand row shown with the copyright
 * line, so users see RealGram is one piece of a unified package:
 * game · learn · earn · connect · free.
 *
 * Real logo lockups (B-15, agent B's RealGram design-identity task) —
 * pre-colored SVGs from brand/lockup-*.svg, rasterized to bundled PNGs
 * @1x/2x/3x since this codebase's logo-mark convention is require()'d
 * bitmaps (see src/assets/logo_mark.png) rather than react-native-svg.
 *
 * Khabat, 2026-07-30: swapped Realink + TrustAI out for Starlink + the AI
 * assistant credit, kept Shahnameh, switched RealGram to its coin mark
 * (was the wordmark) per her "﷼ logo/ikon" ask specifically. Starlink and
 * the AI credit have no bundled logo asset (never existed in this
 * codebase) — rendered as plain text badges instead of fabricating a
 * mark, same "no real asset yet, don't invent one" pattern already used
 * for Starlink's satellite emoji elsewhere (StarlinkBanner.tsx). Text
 * label deliberately says "Fable 5" rather than reproducing Anthropic's
 * actual Claude logo/wordmark here — a real logo asset can replace this
 * text badge later if one gets supplied.
 */

import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { useT } from '../i18n';

type Brand =
  | { name: string; kind: 'image'; source: number; width: number }
  | { name: string; kind: 'text'; label: string };

const BRANDS: Brand[] = [
  { name: 'AI',        kind: 'text',  label: '✨ Fable 5' },
  { name: 'Starlink',  kind: 'text',  label: '🛰️ Starlink' },
  { name: 'RealGram',  kind: 'image', source: require('../assets/ecosystem/icon-realgram-coin.png'), width: 22 },
  { name: 'Shahnameh', kind: 'image', source: require('../assets/ecosystem/lockup-shahnameh.png'),   width: 84 },
];

export function EcosystemFooter() {
  const { t } = useT();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {BRANDS.map((b) => (
          b.kind === 'image' ? (
            <Image
              key={b.name}
              source={b.source}
              style={{ width: b.width, height: 22 }}
              resizeMode="contain"
              accessibilityLabel={b.name}
            />
          ) : (
            <Text key={b.name} style={styles.textBadge} accessibilityLabel={b.name}>{b.label}</Text>
          )
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
  textBadge: { fontSize: Typography.size.xs, color: Colors.text.secondary, fontFamily: Typography.family.heading },
});
