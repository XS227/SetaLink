import { useEffect } from 'react';
import {
  useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, Easing,
} from 'react-native-reanimated';

interface RotationOptions {
  duration?:  number;
  direction?: 'cw' | 'ccw';
  running?:   boolean;
}

export function useRotation({
  duration  = 8000,
  direction = 'cw',
  running   = true,
}: RotationOptions = {}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (!running) {
      rotation.value = withTiming(0, { duration: 300 });
      return;
    }
    rotation.value = withRepeat(
      withTiming(direction === 'cw' ? 1 : -1, { duration, easing: Easing.linear }),
      -1,
      false,
    );
  }, [running, direction, duration]);

  return useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 360}deg` }],
  }));
}
