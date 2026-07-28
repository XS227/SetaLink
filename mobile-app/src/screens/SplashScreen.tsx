/**
 * Splash Screen
 *
 * Animation sequence:
 * 1. Dark void (300ms)
 * 2. Coin mark scales in with glow, silver (600ms)
 * 3. Wordmark fades in below (400ms)
 * 4. Tagline types in (500ms)
 * 5. Coin flips silver -> gold, "ready" cue (400ms)
 * 6. Whole screen fades out → navigate to Auth or Home
 *
 * Khabat, 2026-07-28: the app now shows ﷼ (same glyph as RealCoin.tsx's
 * tap-to-earn coin) as the REAL-token mark everywhere instead of the old
 * `logo_mark.png` image, so the splash should match — same silver/gold
 * coin visual, not a separate static image. Silver = not ready yet, gold =
 * ready, same rule RealCoin already uses for connected/disconnected.
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Animated, StyleSheet, Dimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Colors, Typography, Animation } from '../design/tokens';
import { APP_VERSION } from '../utils/version';

const { width, height } = Dimensions.get('window');
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const COIN_SIZE = 100;

interface Props {
  onFinish: () => void;
}

export function SplashScreen({ onFinish }: Props) {
  const logoScale   = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const tagOpacity  = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const coinGoldOpacity = useRef(new Animated.Value(0)).current; // 0 = silver, 1 = gold

  // Particle positions (static — in production animate with Reanimated worklets)
  const particles = Array.from({ length: 20 }, (_, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: 1 + Math.random() * 2,
    opacity: 0.1 + Math.random() * 0.3,
  }));

  useEffect(() => {
    Animated.sequence([
      Animated.delay(300),

      // Logo mark appears
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          ...Animation.spring.gentle,
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: Animation.duration.slow,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 1,
          duration: Animation.duration.verySlow,
          useNativeDriver: true,
        }),
      ]),

      Animated.delay(200),

      // Wordmark
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: Animation.duration.slow,
        useNativeDriver: true,
      }),

      Animated.delay(100),

      // Tagline
      Animated.timing(tagOpacity, {
        toValue: 1,
        duration: Animation.duration.slow,
        useNativeDriver: true,
      }),

      Animated.delay(500),

      // Coin flips gold — the "ready" cue, same silver/gold rule RealCoin
      // uses for disconnected/connected. JS-driven (not native): this same
      // value also drives the glyph's Text color interpolation below, and
      // Text color + SVG opacity aren't reliably native-driver-supported —
      // fine for a single 400ms one-time fade on an otherwise-idle screen.
      Animated.timing(coinGoldOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }),

      Animated.delay(400),

      // Exit
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: Animation.duration.cinematic,
        useNativeDriver: true,
      }),
    ]).start(() => onFinish());
  }, []);

  return (
    <Animated.View style={[styles.screen, { opacity: screenOpacity }]}>
      {/* Ambient particles */}
      {particles.map((p, i) => (
        <View
          key={i}
          style={[
            styles.particle,
            {
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              opacity: p.opacity,
            },
          ]}
        />
      ))}

      {/* Radial ambient gradient — simulated via layered circles */}
      <View style={styles.ambientGlow} pointerEvents="none" />

      <View style={styles.center}>
        {/* Logo mark */}
        <Animated.View
          style={[
            styles.logoWrapper,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          {/* Glow halo */}
          <Animated.View style={[styles.logoGlow, { opacity: glowOpacity }]} />

          {/* REAL-token coin — silver base, gold layer crossfades in as the
              "ready" cue (coinGoldOpacity: 0 -> 1), same visual rule as the
              tap-to-earn RealCoin.tsx (gold = ready/connected, silver =
              not yet). Presentational only here — no gestures, this isn't
              tappable. */}
          <View style={styles.logoMarkContainer}>
            <Svg width={COIN_SIZE} height={COIN_SIZE} viewBox={`0 0 ${COIN_SIZE} ${COIN_SIZE}`}>
              <Defs>
                <RadialGradient id="splashSilver" cx="35%" cy="30%" r="75%">
                  <Stop offset="0%"  stopColor={Colors.silver[100]} />
                  <Stop offset="55%" stopColor={Colors.silver[300]} />
                  <Stop offset="100%" stopColor="#4B525D" />
                </RadialGradient>
                <RadialGradient id="splashGold" cx="35%" cy="30%" r="75%">
                  <Stop offset="0%"  stopColor={Colors.gold[100]} />
                  <Stop offset="55%" stopColor={Colors.gold[400]} />
                  <Stop offset="100%" stopColor={Colors.gold[700]} />
                </RadialGradient>
              </Defs>
              <Circle cx={COIN_SIZE / 2} cy={COIN_SIZE / 2} r={COIN_SIZE / 2 - 2} fill="url(#splashSilver)" />
              <AnimatedCircle
                cx={COIN_SIZE / 2} cy={COIN_SIZE / 2} r={COIN_SIZE / 2 - 2}
                fill="url(#splashGold)" opacity={coinGoldOpacity}
              />
            </Svg>
            <Animated.Text
              style={[
                styles.coinGlyph,
                {
                  color: coinGoldOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['#20242B', '#241605'],
                  }),
                },
              ]}
            >
              {'﷼'}
            </Animated.Text>
          </View>
        </Animated.View>

        {/* Wordmark */}
        <Animated.View style={{ opacity: wordOpacity }}>
          <Text style={styles.wordmark}>
            <Text style={styles.wordmarkAccent}>Real</Text>Gram
          </Text>

        </Animated.View>

        {/* Tagline */}
        <Animated.Text style={[styles.tagline, { opacity: tagOpacity }]}>
          Intelligent Connectivity
        </Animated.Text>
      </View>

      {/* Version tag */}
      <Animated.Text style={[styles.version, { opacity: tagOpacity }]}>
        v{APP_VERSION}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.bg.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    borderRadius: 2,
    backgroundColor: Colors.gold[400],
  },
  ambientGlow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: Colors.gold[600],
    opacity: 0.12,
    top: height / 2 - 160,
    left: width / 2 - 160,
  },
  center: {
    alignItems: 'center',
    gap: 16,
  },
  logoWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.gold[400],
    opacity: 0.12,
    shadowColor: Colors.gold[300],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 48,
  },
  logoMarkContainer: {
    width: COIN_SIZE,
    height: COIN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinGlyph: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: Typography.family.persian,
    fontWeight: '700',
    fontSize: Math.round(COIN_SIZE * 0.64),
  },
  wordmark: {
    fontSize: Typography.size['3xl'],
    fontFamily: Typography.family.display,
    color: Colors.text.primary,
    letterSpacing: Typography.tracking.tightest,
  },
  wordmarkAccent: {
    color: Colors.gold[400],
  },
  tagline: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.body,
    color: Colors.text.muted,
    letterSpacing: Typography.tracking.widest,
    textTransform: 'uppercase',
  },
  version: {
    position: 'absolute',
    bottom: 48,
    fontSize: Typography.size.xs,
    fontFamily: Typography.family.mono,
    color: Colors.text.muted,
    opacity: 0.5,
  },
});
