import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle,
  useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Colors, Typography } from '../design/tokens';

/**
 * RealCoin — RealGram's signature tap/hold coin (theme pkg `real-coin.js`,
 * ported from the web `<real-coin>` custom element to React Native).
 *
 * The one rule: GOLD = owned / connected / just tapped / just converted.
 * SILVER = locked / disconnected / not yet earned. Tap forges Zar; holding
 * for 3s toggles the VPN connection, with a red ring filling over the hold.
 */

const HOLD_MS = 3000;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  connected: boolean;
  size?: number;
  /** Multiplies the per-tap Zar gain shown to callers via onForge. */
  combo?: number;
  disabled?: boolean;
  onForge?: (gain: number) => void;
  onToggleConnection?: () => void;
}

export function RealCoin({
  connected, size = 140, combo = 1, disabled = false, onForge, onToggleConnection,
}: Props) {
  const r = size / 2 - 9;
  const circumference = 2 * Math.PI * r;

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const press       = useSharedValue(1);      // press-scale
  const breathe     = useSharedValue(0);       // 0..1 breathing cycle
  const goldOpacity = useSharedValue(connected ? 1 : 0);
  const ringOffset  = useSharedValue(circumference); // full offset = empty ring

  useEffect(() => {
    goldOpacity.value = withTiming(connected ? 1 : 0, { duration: 400 });
  }, [connected, goldOpacity]);

  useEffect(() => {
    if (reduceMotion) { breathe.value = 0.7; return; }
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, true,
    );
    return () => cancelAnimation(breathe);
  }, [reduceMotion, breathe]);

  const holdStartRef = useRef(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    ringOffset.value = withTiming(circumference, { duration: 250 });
  }, [ringOffset, circumference]);

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    press.value = withTiming(0.95, { duration: 80 });
    holdStartRef.current = Date.now();
    heldRef.current = false;
    ringOffset.value = withTiming(0, { duration: HOLD_MS, easing: Easing.linear });
    holdTimerRef.current = setTimeout(() => {
      heldRef.current = true;
      clearHold();
      onToggleConnection?.();
    }, HOLD_MS);
  }, [disabled, press, ringOffset, clearHold, onToggleConnection]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    press.value = withSpring(1, { damping: 12, stiffness: 300 });
    const held = holdStartRef.current ? Date.now() - holdStartRef.current : 0;
    clearHold();
    if (!heldRef.current && held < HOLD_MS - 30) {
      onForge?.(Math.round(6 * combo));
    }
  }, [disabled, press, clearHold, combo, onForge]);

  useEffect(() => () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); }, []);

  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: (0.4 + breathe.value * 0.4) * (0.5 + goldOpacity.value * 0.5),
    transform: [{ scale: 1 + breathe.value * 0.08 }],
  }));
  const goldCircleProps = useAnimatedProps(() => ({ opacity: goldOpacity.value }));
  const silverCircleProps = useAnimatedProps(() => ({ opacity: 1 - goldOpacity.value }));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ringOffset.value }));

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={connected ? 'Tap to forge Zar, hold 3 seconds to disconnect' : 'Tap to forge Zar, hold 3 seconds to connect'}
    >
      <Animated.View style={[{ width: size, height: size }, stageStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            { backgroundColor: connected ? Colors.gold[400] : Colors.silver[300] },
            glowStyle,
          ]}
        />
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFillObject}>
          <Defs>
            <RadialGradient id="rcGold" cx="35%" cy="30%" r="75%">
              <Stop offset="0%"  stopColor={Colors.gold[100]} />
              <Stop offset="55%" stopColor={Colors.gold[400]} />
              <Stop offset="100%" stopColor={Colors.gold[700]} />
            </RadialGradient>
            <RadialGradient id="rcSilver" cx="35%" cy="30%" r="75%">
              <Stop offset="0%"  stopColor={Colors.silver[100]} />
              <Stop offset="55%" stopColor={Colors.silver[300]} />
              <Stop offset="100%" stopColor="#4B525D" />
            </RadialGradient>
          </Defs>
          <AnimatedCircle
            cx={size / 2} cy={size / 2} r={size / 2 - 3}
            fill="url(#rcSilver)" animatedProps={silverCircleProps}
          />
          <AnimatedCircle
            cx={size / 2} cy={size / 2} r={size / 2 - 3}
            fill="url(#rcGold)" animatedProps={goldCircleProps}
          />
          {/* Hold-to-disconnect ring — starts fully offset (invisible),
              fills clockwise over HOLD_MS as strokeDashoffset -> 0. */}
          <AnimatedCircle
            cx={size / 2} cy={size / 2} r={r}
            stroke={Colors.red[400]} strokeWidth={4} strokeLinecap="round"
            fill="none" strokeDasharray={circumference}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            animatedProps={ringProps}
          />
        </Svg>
        <Animated.Text
          style={[
            styles.glyph,
            // Khabat, 2026-07-23: glyph read as too small in the tap circle — doubled from 0.32.
            { fontSize: Math.round(size * 0.64), color: connected ? '#241605' : '#20242B' },
          ]}
        >
          {'﷼'}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: '-14%', left: '-14%', right: '-14%', bottom: '-14%',
    borderRadius: 9999,
  },
  glyph: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: Typography.family.persian,
    fontWeight: '700',
  },
});
