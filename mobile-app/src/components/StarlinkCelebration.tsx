import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { Colors, Typography, Spacing } from '../design/tokens';
import { useT } from '../i18n';

/**
 * 🛰️ Satellite Route Active — the once-per-device first-connect achievement
 * (b97 addendum #2). Khabat: the first Starlink connect must feel like an
 * accomplishment, not "Connected." — this is the detail users remember and
 * tell others about.
 *
 * Pure Animated (no deps): a starfield fades in, expanding gold rings pulse
 * from the satellite as it rises, then the copy lands. Dismiss on tap.
 */

const { width, height } = Dimensions.get('window');

// Deterministic pseudo-random star positions — stable across renders, no
// re-layout jitter, and no Math.random() in render.
const STARS = Array.from({ length: 26 }, (_, i) => ({
  left: ((i * 137.5) % 100),          // golden-angle spread
  top:  ((i * 61.8) % 100),
  size: 1.5 + (i % 3),
  delay: (i % 7) * 180,
}));

interface Props {
  visible:   boolean;
  onDismiss: () => void;
}

function Star({ left, top, size, delay }: { left: number; top: number; size: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 0.9, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.15, duration: 900, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: `${left}%` as unknown as number,
        top:  `${top}%` as unknown as number,
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: '#F0F6FF', opacity,
      }}
    />
  );
}

function PulseRing({ delay }: { delay: number }) {
  const scale   = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.8, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.7, duration: 300, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 1700, useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(scale, { toValue: 0.3, duration: 0, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[styles.ring, { opacity, transform: [{ scale }] }]} />;
}

export function StarlinkCelebration({ visible, onDismiss }: Props) {
  const { t, isRTL } = useT();
  const fade    = useRef(new Animated.Value(0)).current;
  const rise    = useRef(new Animated.Value(40)).current;
  const textIn  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { fade.setValue(0); rise.setValue(40); textIn.setValue(0); return; }
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(rise, { toValue: 0, damping: 12, stiffness: 120, useNativeDriver: true }),
      ]),
      Animated.timing(textIn, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: fade }]} pointerEvents="auto">
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss}>
        {STARS.map((s, i) => <Star key={i} {...s} />)}

        <View style={styles.center}>
          <View style={styles.ringAnchor}>
            <PulseRing delay={0} />
            <PulseRing delay={650} />
            <PulseRing delay={1300} />
            <Animated.Text style={[styles.satellite, { transform: [{ translateY: rise }] }]}>
              🛰️
            </Animated.Text>
          </View>

          <Animated.View style={[styles.textBlock, { opacity: textIn }]}>
            <Text style={[styles.title, isRTL && styles.rtlText]}>{t('sl.celebrationTitle')}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t('sl.celebrationBody')}</Text>
            <View style={styles.divider} />
            <Text style={styles.hint}>{t('sl.celebrationDismiss')}</Text>
          </Animated.View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const RING = Math.min(width * 0.55, 220);

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, width, height,
    backgroundColor: 'rgba(2,4,10,0.96)',
    zIndex: 1000, elevation: 20,
  },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[6], padding: Spacing[6] },
  ringAnchor: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute', width: RING, height: RING, borderRadius: RING / 2,
    borderWidth: 1.5, borderColor: Colors.gold[400],
  },
  satellite: { fontSize: 64 },
  textBlock: { alignItems: 'center', gap: Spacing[2], maxWidth: 320 },
  title: {
    fontSize: Typography.size.xl, fontFamily: Typography.family.heading,
    color: Colors.gold[300], letterSpacing: 1, textAlign: 'center',
  },
  body: {
    fontSize: Typography.size.base, fontFamily: Typography.family.body,
    color: Colors.text.secondary, textAlign: 'center', lineHeight: 22,
  },
  rtlText: { writingDirection: 'rtl' },
  divider: { width: 48, height: 1, backgroundColor: 'rgba(212,175,55,0.4)', marginTop: Spacing[3] },
  hint: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.label,
    color: Colors.text.muted, letterSpacing: 1, textTransform: 'uppercase', marginTop: Spacing[1],
  },
});
