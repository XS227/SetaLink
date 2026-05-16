import { useEffect } from 'react';
import {
  useSharedValue, useAnimatedStyle,
  withTiming, withSpring, withDelay, Easing,
} from 'react-native-reanimated';
import { Animation } from '../design/tokens';

interface EntranceOptions {
  delay?: number;
  fromY?: number;
  fromX?: number;
  type?: 'spring' | 'timing';
  duration?: number;
}

export function useEntrance(opts: EntranceOptions = {}) {
  const {
    delay = 0,
    fromY = 20,
    fromX = 0,
    type = 'spring',
    duration = Animation.duration.slow,
  } = opts;

  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(fromY);
  const translateX = useSharedValue(fromX);

  useEffect(() => {
    const springCfg = Animation.spring.gentle;
    const timingCfg = { duration, easing: Easing.out(Easing.cubic) };

    opacity.value = withDelay(
      delay,
      type === 'spring' ? withSpring(1, springCfg) : withTiming(1, timingCfg),
    );
    translateY.value = withDelay(
      delay,
      type === 'spring' ? withSpring(0, springCfg) : withTiming(0, timingCfg),
    );
    if (fromX !== 0) {
      translateX.value = withDelay(
        delay,
        type === 'spring' ? withSpring(0, springCfg) : withTiming(0, timingCfg),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { translateX: translateX.value }],
  }));
}
