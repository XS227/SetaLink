import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout, Shadow } from '../design/tokens';
import { useT } from '../i18n';

/**
 * StarlinkCelebration — one-time "Satellite Route Active" moment, shown the
 * first time (ever) a device connects through the Starlink node. Distinct
 * from GoldBeatBurst (which fires on every connect): this is a single
 * milestone banner, not a recurring heartbeat.
 *
 * Self-contained: caller just increments `burstKey` when the condition is
 * met (first Starlink connect) — the seen-once flag lives in settingsStore
 * (hasSeenStarlinkCelebration) and is the caller's responsibility to check
 * and mark, same pattern as the Path B0 Telegram tip in vpnStore.ts.
 */

const AUTO_DISMISS_MS = 5200;

interface Props {
  /** Increment to fire the celebration (0 = never fired). */
  burstKey: number;
}

export function StarlinkCelebration({ burstKey }: Props) {
  const { t } = useT();
  const [alive, setAlive] = useState(false);
  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity     = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -140, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,    duration: 220, useNativeDriver: true }),
    ]).start(() => setAlive(false));
  };

  useEffect(() => {
    if (burstKey <= 0) return;
    setAlive(true);
    translateY.setValue(-140);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, damping: 16, stiffness: 140, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();

    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(dismiss, AUTO_DISMISS_MS);

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey]);

  if (!alive) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.layer, { opacity, transform: [{ translateY }] }]}
    >
      <TouchableOpacity style={styles.card} onPress={dismiss} activeOpacity={0.9}>
        <Text style={styles.icon}>🛰️</Text>
        <Text style={styles.title}>{t('sl.celebrationTitle')}</Text>
        <Text style={styles.subtitle}>{t('sl.celebrationSubtitle')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const GOLD = '#C9A42A';

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: Layout.statusBarHeight,
    left: Layout.screenPadding,
    right: Layout.screenPadding,
    zIndex: 50,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: Colors.bg.elevated,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[4],
    alignItems: 'center',
    gap: 6,
    ...Shadow.card,
  },
  icon: { fontSize: 30, marginBottom: 2 },
  title: {
    fontSize: Typography.size.md,
    fontFamily: Typography.family.heading,
    color: GOLD,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.body,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
