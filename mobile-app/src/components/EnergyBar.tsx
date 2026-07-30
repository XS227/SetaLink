import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';

/** Compact horizontal energy/stamina bar for the tap section (see useTapEnergy). */
interface Props {
  energy: number;
  maxEnergy: number;
  pct: number;
}

function formatEnergy(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function EnergyBar({ energy, maxEnergy, pct }: Props) {
  const low = pct <= 0.15;
  return (
    <View style={styles.row}>
      <Text style={styles.icon}>⚡</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` as any }, low && styles.fillLow]} />
      </View>
      <Text style={[styles.value, low && styles.valueLow]}>{formatEnergy(energy)}/{formatEnergy(maxEnergy)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], width: '100%', paddingHorizontal: Spacing[2] },
  icon:  { fontSize: 12 },
  track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },
  fillLow: { backgroundColor: Colors.red[400] },
  value: { fontSize: 10, fontFamily: Typography.family.mono, color: Colors.text.muted, minWidth: 52, textAlign: 'right' },
  valueLow: { color: Colors.red[400] },
});
