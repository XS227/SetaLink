import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Typography, Radius, Spacing } from '../design/tokens';

interface Props {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  style?: ViewStyle;
}

export function MetricPill({ label, value, unit, accent, style }: Props) {
  return (
    <View style={[styles.pill, accent && styles.accentPill, style]}>
      <Text style={[styles.value, accent && styles.accentValue]}>
        {value}
        {unit && <Text style={styles.unit}> {unit}</Text>}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    alignItems: 'center',
    minWidth: 80,
  },
  accentPill: {
    borderColor: Colors.border.glow,
    backgroundColor: 'rgba(0,232,122,0.06)',
  },
  value: {
    fontSize: Typography.size.xl,
    fontFamily: Typography.family.heading,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tight,
  },
  accentValue: {
    color: Colors.emerald[400],
  },
  unit: {
    fontSize: Typography.size.sm,
    color: Colors.text.muted,
    fontFamily: Typography.family.body,
  },
  label: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.label,
    color: Colors.text.muted,
    letterSpacing: Typography.tracking.wide,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});
