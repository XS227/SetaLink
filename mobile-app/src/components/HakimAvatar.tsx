import React from 'react';
import Svg, { Circle, Path, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Colors } from '../design/tokens';

/**
 * HakimAvatar — original flat-icon portrait for Hakim, Shahnameh's guide
 * character (Khabat, 2026-07-30: "shahnameh banner kan inkludere bilde av
 * Hakim... for shahnameh bruker du hakim ikonet som skal være ansiktet til
 * shahnameh"). No Hakim asset existed anywhere in the repo before this —
 * this is new artwork, not a placeholder: a warm bearded sage/scholar face
 * (turban, flowing beard, calm eyes) in the same gold-on-dark language as
 * the existing Shahnameh wordmark (brand/lockup-shahnameh.svg's currentColor
 * gold), so it reads as part of that brand family rather than a new one.
 */
interface Props {
  size?: number;
}

export function HakimAvatar({ size = 56 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 96 96">
      <Defs>
        <RadialGradient id="hakimBg" cx="35%" cy="30%" r="75%">
          <Stop offset="0%" stopColor="#3A2A0F" />
          <Stop offset="100%" stopColor="#1A1207" />
        </RadialGradient>
      </Defs>
      <Circle cx={48} cy={48} r={47} fill="url(#hakimBg)" stroke={Colors.gold[400]} strokeWidth={1.5} />

      {/* Turban */}
      <Path
        d="M22 40 Q24 18 48 16 Q72 18 74 40 Q74 44 70 44 L26 44 Q22 44 22 40 Z"
        fill={Colors.gold[600]}
      />
      <Path d="M30 30 Q48 22 66 30" stroke={Colors.gold[200]} strokeWidth={2} fill="none" strokeLinecap="round" />
      <Circle cx={48} cy={22} r={3.4} fill={Colors.gold[100]} />

      {/* Face */}
      <Path
        d="M32 42 Q32 66 48 70 Q64 66 64 42 Q64 32 48 32 Q32 32 32 42 Z"
        fill="#E8B978"
      />

      {/* Brows + calm eyes */}
      <Path d="M36 46 Q40 43 44 46" stroke="#3A2A0F" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Path d="M52 46 Q56 43 60 46" stroke="#3A2A0F" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Path d="M37 51 Q40 53 43 51" stroke="#241605" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Path d="M53 51 Q56 53 59 51" stroke="#241605" strokeWidth={2} fill="none" strokeLinecap="round" />

      {/* Nose */}
      <Path d="M48 50 L46 58 Q48 60 50 58" stroke="#B5824A" strokeWidth={1.6} fill="none" strokeLinecap="round" />

      {/* Warm smile */}
      <Path d="M42 63 Q48 67 54 63" stroke="#6B4423" strokeWidth={2} fill="none" strokeLinecap="round" />

      {/* Beard */}
      <Path
        d="M34 60 Q34 80 48 86 Q62 80 62 60 Q62 72 48 76 Q34 72 34 60 Z"
        fill={Colors.silver[100]}
        opacity={0.94}
      />
      <Path d="M40 66 Q48 72 56 66" stroke={Colors.silver[500]} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.6} />
    </Svg>
  );
}
