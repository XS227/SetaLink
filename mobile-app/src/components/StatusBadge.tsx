import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { usePulse } from '../hooks/usePulse';

type Status = 'connected' | 'connecting' | 'disconnected' | 'idle';

interface Props {
  status: Status;
}

const STATUS_LABELS: Record<Status, string> = {
  connected:    'Connected',
  connecting:   'Connecting...',
  disconnected: 'Disconnected',
  idle:         'Tap to Connect',
};

export function StatusBadge({ status }: Props) {
  const pulseStyle = usePulse({
    running:    status === 'connecting',
    minOpacity: 0.3,
    maxOpacity: 1,
    duration:   600,
  });

  const color = Colors.status[status];

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, pulseStyle]} />
      <Text style={[styles.label, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  dot:   { width: 8, height: 8, borderRadius: Radius.full },
  label: {
    fontSize:      Typography.size.sm,
    fontFamily:    Typography.family.label,
    letterSpacing: Typography.tracking.wider,
    textTransform: 'uppercase',
  },
});
