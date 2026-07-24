import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Colors, Radius, Shadow } from '../design/tokens';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  glowColor?: string;
  noPadding?: boolean;
}

/**
 * "Carved stone" overlay (theme pkg §5): a faint top highlight + a deeper
 * bottom shadow baked INTO the card surface, on top of the drop shadow
 * below. RN has no inset box-shadow, so this is two thin gradient bands
 * layered over the card instead — Colors.gradient.carvedTop/carvedBottom,
 * defined in tokens.ts since Phase 0 but never actually used until now.
 */
function CarvedOverlay({ width, height, radius }: { width: number; height: number; radius: number }) {
  if (!width || !height) return null;
  return (
    <Svg
      width={width} height={height}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id="carvedTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.06} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="carvedBottom" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={0.35} />
        </LinearGradient>
      </Defs>
      {/* Each Rect gets its own corner radius (rather than clipping the whole
          card with overflow:hidden) — GlassCard is used in 15+ places app-
          wide, several with absolutely-positioned badges that legitimately
          overflow the card bounds; clipping at the container level would
          silently cut those off everywhere at once. */}
      <Rect x={0} y={0} width={width} height={Math.min(height, height * 0.5)} rx={radius} fill="url(#carvedTop)" />
      <Rect x={0} y={height * 0.55} width={width} height={height * 0.45} rx={radius} fill="url(#carvedBottom)" />
    </Svg>
  );
}

export function GlassCard({ children, style, glowColor, noPadding }: Props) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.card,
        glowColor && {
          borderColor: glowColor + '40',
          shadowColor: glowColor,
          shadowOpacity: 0.2,
          shadowRadius: 20,
          elevation: 8,
        },
        noPadding && { padding: 0 },
        style,
      ]}
    >
      <CarvedOverlay width={size.width} height={size.height} radius={Radius.xl} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 16,
    ...Shadow.card,
  },
});
