import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { RealTokenIcon } from './RealTokenIcon';

/**
 * TreasuryTile — gold/glow "treasury box" balance tile (Khabat, 2026-07-30:
 * the plain StatPill/StatCell grid "looks a bit dead", wanted something
 * shinier for the Home Treasury row + Profile Economy grid). Same data,
 * gold-glow GlassCard-style border + a diagonal shine sweep baked in with
 * SVG (RN has no CSS shine/shimmer, so this is a static gradient band
 * rather than an animated one — cheap enough to put in a 4-wide grid
 * without a perf cost, unlike looping every tile's own Animated shine).
 *
 * `real` renders the ﷼ RealTokenIcon instead of an emoji — pass it for the
 * REAL token cell specifically, `icon` (emoji) for ZAR/XP/Gems/Farr/etc.
 */
interface Props {
  icon?: string;
  real?: boolean;
  value: string;
  label: string;
  style?: object;
}

function Shine({ width, height }: { width: number; height: number }) {
  if (!width || !height) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Defs>
        <LinearGradient id="tileShine" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.14} />
          <Stop offset="35%" stopColor="#FFFFFF" stopOpacity={0.02} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} rx={Radius.lg} fill="url(#tileShine)" />
    </Svg>
  );
}

export function TreasuryTile({ icon, real, value, label, style }: Props) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  return (
    <View
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      style={[styles.tile, style]}
    >
      <Shine width={size.width} height={size.height} />
      {real ? <RealTokenIcon size={20} style={styles.iconSpacing} /> : (
        <Text style={[styles.emoji, styles.iconSpacing]}>{icon}</Text>
      )}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.bg.elevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.28)',
    paddingVertical: Spacing[3],
    shadowColor: Colors.gold[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
    overflow: 'hidden',
  },
  iconSpacing: { marginBottom: 3 },
  emoji: { fontSize: 15 },
  value: { fontSize: 13, fontFamily: Typography.family.mono, color: Colors.text.primary },
  label: { fontSize: 9, color: Colors.text.muted, fontFamily: Typography.family.label, marginTop: 2, textTransform: 'uppercase' },
});
