import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { PRIZES } from './DailyLuckWheel';

/**
 * MiniLuckWheel — small static wheel graphic for banner/entry-point use
 * (Khabat, 2026-07-30: "daily luck skal vise banner for lykkehjul" — the
 * Earn-screen entry point was a bare 🎰 slot-machine emoji, not a wheel at
 * all). Same segment colors as the real interactive DailyLuckWheel so the
 * banner reads as a preview of the actual screen, not a different graphic —
 * deliberately not the interactive component itself (that one's SIZE/spin
 * state/gesture are all built for the full-screen wheel, not a small
 * decorative banner icon).
 */
interface Props {
  size?: number;
}

export function MiniLuckWheel({ size = 40 }: Props) {
  const center = size / 2;
  const r = size / 2 - 1.5;
  const segDeg = 360 / PRIZES.length;

  const arc = (i: number) => {
    const startA = (i * segDeg - 90) * (Math.PI / 180);
    const endA = ((i + 1) * segDeg - 90) * (Math.PI / 180);
    const x1 = center + r * Math.cos(startA);
    const y1 = center + r * Math.sin(startA);
    const x2 = center + r * Math.cos(endA);
    const y2 = center + r * Math.sin(endA);
    return `M${center},${center} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`;
  };

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {PRIZES.map((p, i) => (
        <Path key={p.key} d={arc(i)} fill={p.color} />
      ))}
      <Circle cx={center} cy={center} r={size * 0.14} fill="#241605" />
    </Svg>
  );
}
