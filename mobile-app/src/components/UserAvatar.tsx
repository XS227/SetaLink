import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Typography } from '../design/tokens';
import { defaultPortrait, type PersonaKey } from '../utils/defaultAvatar';

interface Props {
  /** Stable id (device id) that picks which portrait of the persona pool. */
  seedId:   string;
  persona?: PersonaKey;
  /** Emoji avatar; only shown when `useEmoji` is set or there is no persona. */
  emoji?:   string;
  color?:   string;
  /** The user explicitly picked an emoji avatar instead of the default portrait. */
  useEmoji?: boolean;
  /** Real uploaded profile photo — always wins when present. */
  photoUrl?: string;
  /** Fallback letter when there is neither persona nor emoji. */
  label?:   string;
  size?:    number;
  ring?:    boolean;
  style?:   StyleProp<ViewStyle>;
}

/**
 * One avatar for every surface. Order: real photo, then an explicitly picked
 * emoji, then the gender-matched 3D portrait (King/Queen), then emoji/initial.
 */
export default function UserAvatar({
  seedId, persona, emoji, color, useEmoji, photoUrl, label, size = 44, ring = true, style,
}: Props) {
  const portrait = photoUrl ? { uri: photoUrl } : useEmoji ? null : defaultPortrait(persona, seedId);
  const radius = size / 2;
  const ringColor = color || Colors.gold[400];
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius },
        ring && { borderWidth: Math.max(1.5, size / 28), borderColor: portrait ? Colors.gold[400] : ringColor },
        !portrait && { backgroundColor: (color || Colors.bg.elevated) + (color ? '2E' : '') },
        style,
      ]}
    >
      {portrait ? (
        <Image source={portrait} style={{ width: '100%', height: '100%', borderRadius: radius }} resizeMode="cover" />
      ) : emoji ? (
        <Text style={{ fontSize: size * 0.48 }}>{emoji}</Text>
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{(label || '?').slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base:    { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: Colors.bg.base },
  initial: { fontFamily: Typography.family.heading, color: Colors.gold[400] },
});
