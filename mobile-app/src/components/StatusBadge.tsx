import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';

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
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'connecting') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  const color = Colors.status[status];

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulseAnim }]} />
      <Text style={[styles.label, { color }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  label: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    letterSpacing: Typography.tracking.wider,
    textTransform: 'uppercase',
  },
});
