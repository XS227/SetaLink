import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Colors, Typography, Radius, Spacing, Animation } from '../design/tokens';

interface Props {
  quality:  number;   // 0–100
  label?:   string;
}

export function NetworkQualityBar({ quality, label }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const fillWidth = useSharedValue(0);

  // Recalculate fill when quality or container width changes
  useEffect(() => {
    if (trackWidth <= 0) return;
    fillWidth.value = withSpring(
      (quality / 100) * trackWidth,
      Animation.spring.gentle,
    );
  }, [quality, trackWidth]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    // Animate immediately if we already have a quality value
    fillWidth.value = withSpring((quality / 100) * w, Animation.spring.gentle);
  };

  const fillStyle = useAnimatedStyle(() => ({
    width: fillWidth.value,
  }));

  const color =
    quality >= 75 ? Colors.emerald[400] :
    quality >= 45 ? '#FFB800'           :
    Colors.status.disconnected;

  const qualityLabel =
    quality >= 75 ? 'Excellent' :
    quality >= 45 ? 'Good'      :
    quality >= 20 ? 'Fair'      : 'Poor';

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.heading}>{label ?? 'Network Quality'}</Text>
        <View style={styles.rightRow}>
          <Text style={[styles.qualityLabel, { color }]}>{qualityLabel}</Text>
          <Text style={[styles.percent, { color }]}>{quality}%</Text>
        </View>
      </View>

      <View style={styles.track} onLayout={onLayout}>
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: color, shadowColor: color },
            fillStyle,
          ]}
        />
        {[25, 50, 75].map(tick => (
          <View
            key={tick}
            style={[styles.tick, { left: `${tick}%` as any }]}
          />
        ))}
      </View>

      {/* Signal bars — static, derived from quality prop */}
      <View style={styles.bars}>
        {Array.from({ length: 12 }).map((_, i) => {
          const threshold = ((i + 1) / 12) * 100;
          const active    = quality >= threshold;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height:          4 + i * 1.5,
                  backgroundColor: active ? color : Colors.bg.elevated,
                  opacity:         active ? 1    : 0.4,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:      { gap: Spacing[2] },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading:      { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.muted, textTransform: 'uppercase', letterSpacing: 1 },
  rightRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qualityLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, letterSpacing: 0.5 },
  percent:      { fontSize: Typography.size.sm, fontFamily: Typography.family.mono },
  track:        { height: 4, borderRadius: Radius.full, backgroundColor: Colors.bg.elevated, overflow: 'visible', position: 'relative' },
  fill:         { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: Radius.full, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4 },
  tick:         { position: 'absolute', width: 1, height: 8, top: -2, backgroundColor: Colors.bg.base },
  bars:         { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 22 },
  bar:          { flex: 1, borderRadius: 2 },
});
