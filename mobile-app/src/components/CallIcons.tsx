import React from 'react';
import Svg, { Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

/**
 * CallIcons — line-style SVG icon set for CallScreen.tsx.
 *
 * Khabat, 2026-07-31: the emoji glyphs (🎤 🔇 📹 🔊 ✕ ✓) the call buttons
 * used before this read as dated next to the rest of the gold-theme UI, and
 * render inconsistently across Android OEM emoji sets. Same stroke-based
 * style throughout so mic/video/speaker/camera-flip feel like one family;
 * accept/end use a filled phone glyph instead (readable at small size on a
 * solid circle, where a thin stroke glyph washes out).
 */

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const strokeProps = (color: string, strokeWidth: number) => ({
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export function IconMic({ size = 22, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" {...p} />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" {...p} />
      <Line x1={12} y1={19} x2={12} y2={23} {...p} />
      <Line x1={8} y1={23} x2={16} y2={23} {...p} />
    </Svg>
  );
}

export function IconMicOff({ size = 22, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" {...p} />
      <Path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" {...p} />
      <Line x1={12} y1={19} x2={12} y2={23} {...p} />
      <Line x1={8} y1={23} x2={16} y2={23} {...p} />
      <Line x1={1} y1={1} x2={23} y2={23} {...p} />
    </Svg>
  );
}

export function IconVideo({ size = 22, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M23 7l-7 5 7 5V7z" {...p} />
      <Rect x={1} y={5} width={15} height={14} rx={2} ry={2} {...p} />
    </Svg>
  );
}

export function IconVideoOff({ size = 22, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" {...p} />
      <Line x1={1} y1={1} x2={23} y2={23} {...p} />
    </Svg>
  );
}

export function IconSpeaker({ size = 20, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="11,5 6,9 2,9 2,15 6,15 11,19" {...p} />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" {...p} />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" {...p} />
    </Svg>
  );
}

export function IconCameraFlip({ size = 20, color = '#FFFFFF', strokeWidth = 2 }: IconProps) {
  const p = strokeProps(color, strokeWidth);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline points="23,4 23,10 17,10" {...p} />
      <Polyline points="1,20 1,14 7,14" {...p} />
      <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" {...p} />
    </Svg>
  );
}

/** Filled phone handset — accept (as-is) or hang up/decline (rotated 135° by the caller). */
export function IconPhone({ size = 26, color = '#0B0F14' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
        fill={color}
      />
    </Svg>
  );
}
