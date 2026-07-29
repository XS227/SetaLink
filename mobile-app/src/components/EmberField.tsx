import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
} from 'react-native-reanimated';
import { Colors } from '../design/tokens';

/**
 * EmberField — the rising-ember ambient background used throughout the
 * theme pkg's mockups (every `screens/0X-*.html` has one). Purely
 * atmospheric: absolute-fill, pointerEvents none, drop it behind a
 * screen's content. Respects prefers-reduced-motion (renders nothing).
 */

const { height: SCREEN_H } = Dimensions.get('window');

interface EmberProps { delay: number; left: number; duration: number; drift: number }

function Ember({ delay, left, duration, drift }: EmberProps) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [delay, duration, progress]);

  const style = useAnimatedStyle(() => {
    const y = -progress.value * (SCREEN_H * 0.9 + 40);
    const x = progress.value * drift;
    // Fade in quickly, hold, fade out — matches the web keyframes'
    // 0%(0) -> 10%(.6-.7) -> 90%(.25-.3) -> 100%(0) shape.
    const opacity =
      progress.value < 0.1  ? progress.value / 0.1 * 0.6 :
      progress.value < 0.9  ? 0.6 - (progress.value - 0.1) * 0.05 :
      (1 - progress.value) / 0.1 * 0.3;
    return { transform: [{ translateY: y }, { translateX: x }], opacity };
  });

  return (
    <Animated.View
      style={[
        styles.ember,
        { left: `${left}%`, backgroundColor: Colors.ember[400], shadowColor: Colors.ember[400] },
        style,
      ]}
    />
  );
}

interface Props { count?: number }

export function EmberField({ count = 8 }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  const embers = useMemo(
    () => Array.from({ length: count }, () => ({
      left: Math.random() * 100,
      duration: 7000 + Math.random() * 8000,
      delay: Math.random() * 10000,
      drift: Math.random() * 30 - 15,
    })),
    [count],
  );

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {embers.map((e, i) => <Ember key={i} {...e} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  ember: {
    position: 'absolute',
    bottom: -10,
    width: 2,
    height: 2,
    borderRadius: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
});
