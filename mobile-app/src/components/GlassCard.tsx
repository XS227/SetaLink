import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Shadow } from '../design/tokens';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  glowColor?: string;
  noPadding?: boolean;
}

export function GlassCard({ children, style, glowColor, noPadding }: Props) {
  return (
    <View
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
