import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Colors, Typography, Spacing, Radius, Layout } from '../design/tokens';
import { useToastStore, ToastType } from '../stores/toastStore';

const TYPE_COLOR: Record<ToastType, string> = {
  success: Colors.emerald[400],
  error:   Colors.status.disconnected,
  info:    Colors.blue[400],
};

const TYPE_BG: Record<ToastType, string> = {
  success: 'rgba(0,232,122,0.12)',
  error:   'rgba(255,68,68,0.12)',
  info:    'rgba(51,153,255,0.12)',
};

const TYPE_BORDER: Record<ToastType, string> = {
  success: 'rgba(0,232,122,0.30)',
  error:   'rgba(255,68,68,0.30)',
  info:    'rgba(51,153,255,0.30)',
};

const TYPE_ICON: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
};

export function Toast() {
  const { current, dismiss } = useToastStore();
  const translateY  = useRef(new Animated.Value(-80)).current;
  const opacity     = useRef(new Animated.Value(0)).current;
  const prevId      = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (current && current.id !== prevId.current) {
      prevId.current = current.id;
      setVisible(true);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0, damping: 18, stiffness: 280, useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1, duration: 180, useNativeDriver: true,
        }),
      ]).start();
    } else if (!current) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -80, duration: 220, useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0, duration: 180, useNativeDriver: true,
        }),
      ]).start(() => setVisible(false));
    }
  }, [current?.id]);

  if (!visible) return null;

  const type    = current?.type ?? 'info';
  const message = current?.message ?? '';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: TYPE_BG[type],
          borderColor:     TYPE_BORDER[type],
        },
      ]}
      pointerEvents="box-none"
    >
      <Text style={[styles.icon, { color: TYPE_COLOR[type] }]}>{TYPE_ICON[type]}</Text>
      <Text style={styles.message} numberOfLines={2}>{message}</Text>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Text style={styles.close}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position:       'absolute',
    top:            Layout.statusBarHeight + (Platform.OS === 'android' ? 8 : 12),
    left:           Layout.screenPadding,
    right:          Layout.screenPadding,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            Spacing[3],
    borderRadius:   Radius.xl,
    borderWidth:    1,
    paddingHorizontal: Spacing[4],
    paddingVertical:   Spacing[3],
    zIndex:         9999,
    elevation:      20,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.3,
    shadowRadius:   12,
  },
  icon: {
    fontSize:   Typography.size.base,
    fontFamily: Typography.family.heading,
    flexShrink: 0,
  },
  message: {
    flex:       1,
    fontSize:   Typography.size.sm,
    fontFamily: Typography.family.body,
    color:      Colors.text.primary,
    lineHeight: 20,
  },
  close: {
    fontSize:   Typography.size.sm,
    color:      Colors.text.muted,
    flexShrink: 0,
  },
});
