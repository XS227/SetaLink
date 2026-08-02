import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, GestureResponderEvent } from 'react-native';
import { Colors, Typography, Radius } from '../design/tokens';
import { useT } from '../i18n';

interface Props {
  /** Composite health score 0–100 (same value that fed the old Network Quality bar). */
  quality: number;
  /** Whether the tunnel is up — when idle the icon is shown dimmed/neutral. */
  connected?: boolean;
  onPress?: (e: GestureResponderEvent) => void;
}

/**
 * CoverageIcon — compact "dekning" (coverage) indicator for the top bar.
 *
 * Replaces the full-width Network Quality card that used to sit in the home
 * body. Renders four signal bars whose ACTIVE COUNT is the level (0–4) and
 * whose COLOUR is the quality band (3 colours: green / amber / red). Kept tiny
 * so the home screen stays focused on the one action that matters — Connect.
 */
export function CoverageIcon({ quality, connected = false, onPress }: Props) {
  const { t } = useT();
  const q = Math.max(0, Math.min(100, Math.round(quality)));

  const color = !connected
    ? Colors.text.muted
    : q >= 75 ? Colors.emerald[400]
    : q >= 45 ? '#FFB800'
    : Colors.status.disconnected;

  // level 0–4 mirrors the band thresholds used by NetworkQualityBar
  const level = !connected ? 0
    : q >= 75 ? 4
    : q >= 45 ? 3
    : q >= 20 ? 2
    : q > 0   ? 1 : 0;

  return (
    <TouchableOpacity
      style={styles.wrap}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
      accessibilityRole="image"
      accessibilityLabel={connected ? t('home.coverage').replace('{pct}', String(q)) : t('home.coverageOffline')}
    >
      <View style={styles.bars}>
        {[0, 1, 2, 3].map(i => {
          const active = i < level;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height:          5 + i * 3,
                  backgroundColor: active ? color : Colors.bg.elevated,
                  opacity:         active ? 1 : 0.4,
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={[styles.pct, { color }]}>{connected ? `${q}%` : '—'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 40, paddingHorizontal: 10, borderRadius: 20,
    backgroundColor: Colors.bg.surface, borderWidth: 1, borderColor: Colors.border.default,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 },
  bar:  { width: 3, borderRadius: 1.5 },
  pct:  { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, letterSpacing: 0.3 },
});
