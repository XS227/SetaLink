import React, { useEffect } from 'react';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, withDelay,
  interpolate, Easing,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { Colors } from '../design/tokens';

interface Props {
  size:           number;
  color?:         string;
  borderWidth?:   number;
  pulsing?:       boolean;
  delay?:         number;
  initialOpacity?: number;  // opacity at rest (scale = 1)
  maxScale?:      number;
}

export function AnimatedRing({
  size,
  color         = Colors.emerald[400],
  borderWidth   = 1.5,
  pulsing       = false,
  delay         = 0,
  initialOpacity = 0.12,
  maxScale      = 1.6,
}: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!pulsing) return;
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(maxScale, { duration: 1800, easing: Easing.out(Easing.sin) }),
          withTiming(1,        { duration: 1800, easing: Easing.out(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
  }, [pulsing, delay, maxScale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(scale.value, [1, maxScale], [initialOpacity, 0]),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width:        size,
          height:       size,
          borderRadius: size / 2,
          borderColor:  color,
          borderWidth,
        },
        animStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
});
