import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, ViewStyle, StyleProp, TextStyle } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius } from '../design/tokens';

/**
 * GoldButton — the theme pkg's primary CTA (`.rg-btn--gold .rg-btn--shine`):
 * a gold gradient fill (Colors.gradient.goldButton, tokens.ts since Phase 0
 * but unused until now) plus a periodic diagonal light sweep. Drop-in
 * replacement for the flat `backgroundColor: Colors.gold[400]` buttons this
 * rebrand shipped across Home/Freedom/Wallet/Chats — same visual weight as
 * the original mockups instead of a flat fill.
 */

interface Props {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
}

export function GoldButton({ onPress, disabled, style, textStyle, children, accessibilityLabel }: Props) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const shine = useSharedValue(-0.6);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    shine.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withDelay(1100, withTiming(-0.6, { duration: 0 })),
      ),
      -1, false,
    );
    return () => cancelAnimation(shine);
  }, [reduceMotion, shine]);

  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shine.value * size.width }],
  }));

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[styles.wrap, disabled && styles.disabled, style]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFillObject}>
        <Defs>
          <LinearGradient id="gb" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor={Colors.gold[100]} />
            <Stop offset="100%" stopColor={Colors.gold[400]} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size.width} height={size.height} rx={Radius.lg} fill="url(#gb)" />
      </Svg>
      {!reduceMotion && size.width > 0 && (
        <Animated.View pointerEvents="none" style={[styles.shine, { width: size.width * 0.4 }, shineStyle]} />
      )}
      {typeof children === 'string' ? <Text style={[styles.text, textStyle]}>{children}</Text> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  disabled: { opacity: 0.45 },
  shine: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(255,255,255,0.35)',
    transform: [{ skewX: '-20deg' }],
  },
  text: { fontSize: 14, fontWeight: '700', color: '#241605' },
});
