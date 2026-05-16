import React from 'react';
import Animated from 'react-native-reanimated';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Layout } from '../design/tokens';
import { useEntrance } from '../hooks/useEntrance';

interface Props {
  children:   React.ReactNode;
  style?:     ViewStyle;
  padded?:    boolean;       // adds screenPadding + statusBarHeight
  animated?:  boolean;       // fade-in entrance
  delay?:     number;        // entrance delay ms
  bgColor?:   string;
}

export function ScreenContainer({
  children,
  style,
  padded   = false,
  animated = false,
  delay    = 0,
  bgColor  = Colors.bg.base,
}: Props) {
  const entranceStyle = useEntrance({ delay, fromY: 0, type: 'timing' });

  const baseStyle = [
    styles.screen,
    { backgroundColor: bgColor },
    padded && styles.padded,
    style,
  ];

  if (!animated) {
    return <View style={baseStyle as ViewStyle[]}>{children}</View>;
  }

  return (
    <Animated.View style={[...baseStyle, entranceStyle]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  padded: {
    paddingTop:        Layout.statusBarHeight,
    paddingHorizontal: Layout.screenPadding,
  },
});
