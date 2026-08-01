/**
 * OrbitField — small particles orbiting a center point in a faked-3D ring
 * (flat 2D positions + depth-driven scale/opacity/z-order from `Math.sin`
 * of the orbit angle, squashed into an ellipse via `tilt`). Originally
 * built for HomeScreen's RealCoin ("den sølve ﷼ blir til sola og alle
 * planetene skal gå i bane rundt sola i 3D", Khabat 2026-07-29/30) —
 * extracted here 2026-08-01 so CallScreen's ringing-state visualization
 * (Khabat: "sola, universet... persisk kultur inspirert visualisering")
 * can reuse the exact same technique instead of re-deriving it. No new
 * dependency either place — plain Reanimated transforms.
 */

import React, { useEffect } from 'react';
import ReanimatedView, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing as REasing,
} from 'react-native-reanimated';

export interface OrbitBodyProps {
  duration: number;
  radius: number;
  /** Vertical squash of the orbit circle into an ellipse — the "viewed at
   *  an angle" cue that reads as a tilted 3D ring instead of a flat 2D loop. */
  tilt: number;
  size: number;
  color: string;
  reverse?: boolean;
  /** Starting angle offset (radians) so bodies don't all launch aligned. */
  phase?: number;
  /** A body orbiting close enough to pass in front of the center needs
   *  real z-order switching, not just a dimmer/smaller far side, or it
   *  would just look like it's always sitting on top of or under it. */
  isMoon?: boolean;
}

export function OrbitDot({ duration, radius, tilt, size, color, reverse, phase = 0, isMoon }: OrbitBodyProps) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration, easing: REasing.linear }), -1, false);
  }, [t, duration]);
  const style = useAnimatedStyle(() => {
    const a = (reverse ? -1 : 1) * t.value * Math.PI * 2 + phase;
    const depth = Math.sin(a); // -1 (far side) .. 1 (near side)
    const scale = 0.55 + (depth + 1) / 2 * 0.7; // 0.55 far .. 1.25 near
    return {
      transform: [
        { translateX: Math.cos(a) * radius },
        { translateY: depth * radius * tilt },
        { scale },
      ],
      opacity: 0.35 + (depth + 1) / 2 * 0.65,
      zIndex: isMoon ? (depth > 0 ? 20 : -1) : Math.round(depth * 10),
    };
  });
  return (
    <ReanimatedView.View
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/** Convenience wrapper — renders one OrbitDot per body. Center the parent
 *  stage View (alignItems/justifyContent: 'center') around whatever sits
 *  in the middle; each dot positions itself from that origin. */
export function OrbitField({ bodies }: { bodies: OrbitBodyProps[] }) {
  return (
    <>
      {bodies.map((d, i) => <OrbitDot key={i} {...d} />)}
    </>
  );
}
