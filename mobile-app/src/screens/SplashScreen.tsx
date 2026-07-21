/**
 * Splash Screen
 *
 * Animation sequence:
 * 1. Dark void (300ms)
 * 2. Logo mark scales in with glow (600ms)
 * 3. Wordmark fades in below (400ms)
 * 4. Tagline types in (500ms)
 * 5. Whole screen fades out → navigate to Auth or Home
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Animated, StyleSheet, Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, Typography, Animation } from '../design/tokens';
import { APP_VERSION } from '../utils/version';

const { width, height } = Dimensions.get('window');

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

      Animated.delay(900),

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

          {/* RealGram mark — bubble + spark (brand/realgram.svg), gold to match
              the app's existing REAL-token identity (ic_launcher.png) rather
              than introducing BRAND.md's separate proposed purple accent. */}
          <View style={styles.logoMarkContainer}>
            <View style={styles.maneRing} />
            <Svg width={52} height={52} viewBox="0 0 24 24" fill="none">
              <Path
                d="M7.9 20A9 9 0 1 0 4 16.1L2.5 21.5z"
                stroke={Colors.gold[300]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path d="M12 8.5v6" stroke={Colors.gold[300]} strokeWidth={2} strokeLinecap="round" />
              <Path d="M9 11.5h6" stroke={Colors.gold[300]} strokeWidth={2} strokeLinecap="round" />
            </Svg>
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
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maneRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.gold[500],
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
