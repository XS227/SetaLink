import React from 'react';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { Colors } from '../design/tokens';

/**
 * StarlinkMark — original orbit-network icon for the in-app "Starlink" exit
 * node feature, replacing the plain 🛰️ emoji used across StarlinkBanner/
 * StarlinkCard. Khabat shared a reference image for "the point of showing a
 * real logo instead of an emoji" — that reference turned out to be SpaceX's
 * actual trademarked Starlink logo, which this app has no rights to and
 * would misleadingly imply affiliation with SpaceX. This is original
 * artwork instead: three offset orbit rings + two node dots, cyan (this
 * app's own established "Starlink = cyan, not gold" color rule), evoking
 * "satellite network" without copying anyone's mark.
 */
interface Props {
  size?: number;
  color?: string;
}

export function StarlinkMark({ size = 28, color }: Props) {
  const c = color ?? Colors.cyan[300];
  const cx = 24, cy = 24;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Ellipse cx={cx} cy={cy} rx={20} ry={9} stroke={c} strokeWidth={2} fill="none" opacity={0.9} transform={`rotate(-18 ${cx} ${cy})`} />
      <Ellipse cx={cx} cy={cy} rx={20} ry={9} stroke={c} strokeWidth={2} fill="none" opacity={0.55} transform={`rotate(42 ${cx} ${cy})`} />
      <Ellipse cx={cx} cy={cy} rx={20} ry={9} stroke={c} strokeWidth={2} fill="none" opacity={0.3} transform={`rotate(102 ${cx} ${cy})`} />
      <Circle cx={cx} cy={cy} r={4.5} fill={c} />
      <Circle cx={cx + 19} cy={cy - 3} r={2.4} fill={c} />
      <Circle cx={cx - 15} cy={cy + 8} r={1.8} fill={c} opacity={0.85} />
    </Svg>
  );
}
