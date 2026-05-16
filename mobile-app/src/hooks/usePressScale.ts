import { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { Animation } from '../design/tokens';

interface PressScaleOptions {
  scale?: number;
}

export function usePressScale({ scale: targetScale = 0.93 }: PressScaleOptions = {}) {
  const scale = useSharedValue(1);

  const onPressIn  = () => { scale.value = withTiming(targetScale, { duration: Animation.duration.instant }); };
  const onPressOut = () => { scale.value = withSpring(1, Animation.spring.bouncy); };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return { animatedStyle, onPressIn, onPressOut };
}
