import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Path, Circle, Rect, G } from 'react-native-svg';
import { Colors } from '../design/tokens';

// Subtle dark-gold doodle tile behind a conversation (Gold After Dark spec:
// "subtle dark doodle wallpaper"). Static and decorative: no animation, and
// low enough contrast that bubbles stay the only thing that reads.
export default function DoodleWallpaper() {
  const c = Colors.gold[400];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="rgDoodle" width={132} height={132} patternUnits="userSpaceOnUse">
            <G stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.07}>
              {/* crown */}
              <Path d="M12 30 L16 16 L23 24 L28 12 L33 24 L40 16 L44 30 Z" />
              {/* chat bubble */}
              <Path d="M78 14 h30 a6 6 0 0 1 6 6 v14 a6 6 0 0 1 -6 6 h-18 l-8 7 v-7 h-4 a6 6 0 0 1 -6 -6 v-14 a6 6 0 0 1 6 -6 z" />
              {/* heart */}
              <Path d="M28 86 c-6 -8 -18 -2 -12 8 l12 12 l12 -12 c6 -10 -6 -16 -12 -8 z" />
              {/* star */}
              <Path d="M96 76 l4 9 l10 1 l-7 7 l2 10 l-9 -5 l-9 5 l2 -10 l-7 -7 l10 -1 z" />
              {/* music note */}
              <Path d="M62 58 v18 M62 58 l12 -3 v16" />
              <Circle cx={59} cy={77} r={3} />
              <Circle cx={71} cy={72} r={3} />
              {/* sparkle */}
              <Path d="M118 118 v8 M114 122 h8" />
              <Path d="M8 120 v6 M5 123 h6" />
            </G>
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#rgDoodle)" />
      </Svg>
    </View>
  );
}
