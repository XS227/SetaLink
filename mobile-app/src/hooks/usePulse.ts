import { useEffect } from 'react';
import {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';

interface PulseOptions {
  minOpacity?: number;
  maxOpacity?: number;
  minScale?:   number;
  maxScale?:   number;
  duration?:   number;
  running?:    boolean;
}

export function usePulse(opts: PulseOptions = {}) {
  const {
    minOpacity = 0.3,
    maxOpacity = 1,
    minScale   = 1,
    maxScale   = 1,
    duration   = 600,
    running    = true,
  } = opts;

  const opacity = useSharedValue(maxOpacity);
  const scale   = useSharedValue(minScale);

  useEffect(() => {
    const easing = Easing.inOut(Easing.sin);

    if (!running) {
      opacity.value = withTiming(maxOpacity, { duration: 200 });
      scale.value   = withTiming(minScale,   { duration: 200 });
      return;
    }

    opacity.value = withRepeat(
      withSequence(
        withTiming(minOpacity, { duration, easing }),
        withTiming(maxOpacity, { duration, easing }),
      ),
      -1,
      false,
    );

    if (minScale !== maxScale) {
      scale.value = withRepeat(
        withSequence(
          withTiming(maxScale, { duration, easing }),
          withTiming(minScale, { duration, easing }),
        ),
        -1,
        false,
      );
    }
  }, [running]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: minScale !== maxScale ? [{ scale: scale.value }] : [],
  }));
}
