import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { REAL_TOKEN_IMAGE } from './EcosystemBanner';

/**
 * GoldBeatBurst — the "beating heart" connect celebration.
 *
 * When the tunnel reaches connected, a handful of small gold REAL coins bloom
 * out from the connect button, each pulsing in a heartbeat rhythm (lub-dub)
 * while it drifts outward and fades. The idea it carries: every connection is
 * a heartbeat of the shared network — the more and the faster it beats, the
 * stronger the free internet gets (قلبی که می‌تپد؛ هرچه بیشتر بتپد قوی‌تر می‌شود).
 *
 * Purely decorative: pointerEvents none, native-driver transforms/opacity
 * only, self-unmounts when the burst finishes.
 */

const COIN_COUNT  = 12;
const LIFE_MS     = 2600;   // per-coin lifetime
const STAGGER_MS  = 90;     // delay between coins
const COIN_SIZE   = 18;

type Coin = {
  angle: number;      // direction out from the button centre
  dist: number;       // how far it drifts
  progress: Animated.Value;
  beat: Animated.Value;
};

interface Props {
  /** Increment to fire a new burst (0 = never fired). */
  burstKey: number;
}

export function GoldBeatBurst({ burstKey }: Props) {
  const [alive, setAlive] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const coins = useMemo<Coin[]>(
    () => Array.from({ length: COIN_COUNT }, (_, i) => ({
      angle: (i / COIN_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      dist:  80 + Math.random() * 60,
      progress: new Animated.Value(0),
      beat:     new Animated.Value(1),
    })),
    // Fresh coin set (fresh random directions) per burst.
    [burstKey],
  );

  useEffect(() => {
    if (burstKey <= 0) return;
    setAlive(true);
    const animations = coins.map((c, i) => {
      c.progress.setValue(0);
      c.beat.setValue(0.4);
      return Animated.parallel([
        // Drift out + (via interpolation) fade in and out.
        Animated.timing(c.progress, {
          toValue: 1, duration: LIFE_MS, delay: i * STAGGER_MS,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        // Heartbeat: two quick lub-dub double-pulses over the coin's life.
        Animated.sequence([
          Animated.delay(i * STAGGER_MS),
          Animated.timing(c.beat, { toValue: 1.25, duration: 180, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 0.95, duration: 140, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 1.35, duration: 180, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 1.0,  duration: 200, useNativeDriver: true }),
          Animated.delay(420),
          Animated.timing(c.beat, { toValue: 1.3,  duration: 170, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 0.9,  duration: 160, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 1.15, duration: 170, useNativeDriver: true }),
          Animated.timing(c.beat, { toValue: 0.8,  duration: 260, useNativeDriver: true }),
        ]),
      ]);
    });
    const all = Animated.parallel(animations);
    all.start();
    doneTimer.current = setTimeout(
      () => setAlive(false),
      LIFE_MS + COIN_COUNT * STAGGER_MS + 100,
    );
    return () => {
      all.stop();
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [burstKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alive) return null;

  return (
    <View pointerEvents="none" style={styles.layer}>
      {coins.map((c, i) => {
        const tx = c.progress.interpolate({
          inputRange: [0, 1], outputRange: [0, Math.cos(c.angle) * c.dist],
        });
        // Slight upward bias so the swarm feels like it rises.
        const ty = c.progress.interpolate({
          inputRange: [0, 1], outputRange: [0, Math.sin(c.angle) * c.dist - 24],
        });
        const opacity = c.progress.interpolate({
          inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 0.9, 0],
        });
        return (
          <Animated.View
            key={i}
            style={[styles.coin, {
              opacity,
              transform: [{ translateX: tx }, { translateY: ty }, { scale: c.beat }],
            }]}
          >
            <Image source={{ uri: REAL_TOKEN_IMAGE }} style={styles.coinImg} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coin: {
    position: 'absolute',
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    // Gold halo behind the coin so it reads as gold even before the remote
    // token image has loaded.
    backgroundColor: 'rgba(212,175,55,0.35)',
    shadowColor: '#D4AF37',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  coinImg: { width: COIN_SIZE, height: COIN_SIZE, borderRadius: COIN_SIZE / 2 },
});
