import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedStyle,
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

  const handleForge = useCallback(() => {
    onForge?.(Math.round(6 * combo));
  }, [combo, onForge]);

  const handleToggle = useCallback(() => {
    onToggleConnection?.();
  }, [onToggleConnection]);

  // Khabat, 2026-07-27: fast repeated tapping was triggering a disconnect on
  // its own, with no real 3s hold, even after an earlier fix that cleared a
  // stacked JS setTimeout on every press-in. Root cause of THAT fix falling
  // short -- Android's legacy touch responder can drop the onPressOut for
  // the *last* tap in a fast sequence, and with no further press-in behind
  // it, nothing was left to cancel its lone hold-timer; it just fired
  // onToggleConnection() ~3s later on its own. A JS timer paired with two
  // independently-fireable RN callbacks can't fully close that gap, because
  // both onPressIn/onPressOut ride the same bridge event stream that can
  // drop events under rapid taps. react-native-gesture-handler's Tap/
  // LongPress gestures track touch state on the native side instead, so a
  // release that never reaches JS still correctly ends the gesture -- this
  // replaces the hand-rolled timer with that native state machine.
  const longPress = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(50)
    .enabled(!disabled)
    .onBegin(() => {
      press.value = withTiming(0.95, { duration: 80 });
      ringOffset.value = withTiming(0, { duration: HOLD_MS, easing: Easing.linear });
    })
    .onStart(() => {
      runOnJS(handleToggle)();
    })
    .onFinalize(() => {
      press.value = withSpring(1, { damping: 12, stiffness: 300 });
      ringOffset.value = withTiming(circumference, { duration: 250 });
    });

  const tap = Gesture.Tap()
    .maxDuration(HOLD_MS - 30)
    .enabled(!disabled)
    .onStart(() => {
      runOnJS(handleForge)();
    });

  // Long-press gets first refusal on every touch; if it fails to reach
  // minDuration before release, the same touch is offered to tap -- the
  // standard RNGH pattern for one control with both a tap and a hold action.
  const gesture = Gesture.Exclusive(longPress, tap);

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
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[{ width: size, height: size }, stageStyle]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={connected ? 'Tap to forge Zar, hold 3 seconds to disconnect' : 'Tap to forge Zar, hold 3 seconds to connect'}
      >
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
    </GestureDetector>
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
