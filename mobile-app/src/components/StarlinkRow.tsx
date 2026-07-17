import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import type { ServerRecord } from '../stores/serverStore';
import { useT } from '../i18n';

/**
 * Starlink server-list row (b97 hero addendum): "Starlink must never look
 * like another VPN server." Gold, glowing, satellite-branded, with
 * server-steerable badges (meta.badges — NEW/LIMITED today, changeable
 * without an app rebuild). Unavailable = visible but disabled with the
 * auto-returns copy, never hidden.
 */

interface Props {
  server:   ServerRecord & { selected?: boolean };
  onSelect: (server: ServerRecord) => void;
  onOpen:   () => void;   // dedicated Starlink page
}

export function StarlinkRow({ server, onSelect, onOpen }: Props) {
  const { t, isRTL } = useT();
  const available = server.available !== false;

  // Slow breathing glow — makes the row feel alive without being loud.
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const borderColor = glow.interpolate({
    inputRange:  [0, 1],
    outputRange: ['rgba(212,175,55,0.3)', 'rgba(240,208,96,0.75)'],
  });

  return (
    <Animated.View style={[styles.wrap, { borderColor }, server.selected && styles.wrapSelected, !available && styles.wrapDisabled]}>
      <TouchableOpacity
        style={[styles.row, isRTL && styles.rtlRow]}
        onPress={() => (available ? onSelect(server) : onOpen())}
        onLongPress={onOpen}
        activeOpacity={0.8}
      >
        <Text style={styles.satellite}>🛰️</Text>
        <View style={styles.nameBlock}>
          <View style={[styles.nameRow, isRTL && styles.rtlRow]}>
            <Text style={styles.name}>{t('sl.rowTitle')}</Text>
            {(server.badges ?? []).map((b) => (
              <View key={b} style={styles.badge}>
                <Text style={styles.badgeText}>{b}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.sub, isRTL && styles.rtlText]}>
            {server.country} · {t('sl.rowSub')}
          </Text>
          {!available && (
            <Text style={[styles.unavailable, isRTL && styles.rtlText]}>{t('sl.rowUnavailable')}</Text>
          )}
        </View>
        {available && server.ping > 0 && (
          <Text style={styles.ping}>{server.ping}ms</Text>
        )}
        {server.selected && <View style={styles.selectedDot} />}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius:    Radius.lg,
    borderWidth:     1,
    backgroundColor: 'rgba(20,16,4,0.9)',
    marginBottom:    Spacing[2],
    shadowColor:     Colors.gold[400],
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.3,
    shadowRadius:    10,
    elevation:       5,
  },
  wrapSelected: { backgroundColor: 'rgba(212,175,55,0.1)' },
  wrapDisabled: { opacity: 0.75 },
  row:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], gap: Spacing[3] },
  rtlRow:   { flexDirection: 'row-reverse' },
  rtlText:  { textAlign: 'right', writingDirection: 'rtl' },
  satellite:{ fontSize: 26 },
  nameBlock:{ flex: 1, minWidth: 0 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  name:     { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: Colors.gold[300], letterSpacing: 1.5 },
  badge:    { backgroundColor: 'rgba(212,175,55,0.15)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(212,175,55,0.5)', paddingHorizontal: 6, paddingVertical: 1 },
  badgeText:{ fontSize: 8, fontFamily: Typography.family.label, color: Colors.gold[300], letterSpacing: 0.6, textTransform: 'uppercase' },
  sub:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.secondary, marginTop: 2 },
  unavailable: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', marginTop: 3 },
  ping:     { fontSize: Typography.size.sm, fontFamily: Typography.family.mono, color: Colors.gold[300] },
  selectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.gold[400] },
});
