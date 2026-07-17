/**
 * NetworkQualityDots — a phone-signal-style quality meter for the tunnel.
 *
 * Three dots, lit like a traffic light: green = strong, amber = ok, red =
 * weak, dim = not connected. Quality is derived from the live connection
 * state + the last latency sample, so the user gets an at-a-glance read of
 * how good their connection is right now without any technical numbers.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { useVpnStore } from '../stores/vpnStore';
import { useT } from '../i18n';

type Tier = 'strong' | 'ok' | 'weak' | 'off';

const COLOR: Record<Tier, string> = {
  strong: Colors.emerald[400],   // green
  ok:     Colors.gold[300],      // amber
  weak:   '#FF6B6B',             // red
  off:    'rgba(255,255,255,0.15)',
};
const LIT: Record<Tier, number> = { strong: 3, ok: 2, weak: 1, off: 0 };
const LABEL_KEY: Record<Tier, string> = {
  strong: 'nq.strong', ok: 'nq.ok', weak: 'nq.weak', off: 'nq.off',
};

/** Map connection state + latency to a quality tier. */
export function qualityTier(connected: boolean, pingMs: number): Tier {
  if (!connected) return 'off';
  if (pingMs <= 0)    return 'ok';    // connected, no sample yet → neutral
  if (pingMs < 90)    return 'strong';
  if (pingMs < 250)   return 'ok';
  return 'weak';
}

export function NetworkQualityDots({ showLabel = true, size = 8 }: { showLabel?: boolean; size?: number }) {
  const { t } = useT();
  const connected = useVpnStore((s) => s.connectionState === 'connected');
  const pingMs    = useVpnStore((s) => s.lastPingMs);

  const tier = qualityTier(connected, pingMs);
  const lit  = LIT[tier];

  return (
    <View style={styles.row} accessibilityLabel={t(LABEL_KEY[tier])}>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: size, height: size, borderRadius: size / 2,
              marginHorizontal: 2,
              backgroundColor: i < lit ? COLOR[tier] : COLOR.off,
            }}
          />
        ))}
      </View>
      {showLabel && <Text style={[styles.label, { color: COLOR[tier] === COLOR.off ? Colors.text.muted : COLOR[tier] }]}>{t(LABEL_KEY[tier])}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dots:  { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 11, fontFamily: Typography.family.label ?? undefined, letterSpacing: 0.3 },
});
