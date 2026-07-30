import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { HakimAvatar } from './HakimAvatar';
import { useT } from '../i18n';

/**
 * ShahnamehHakimBanner — replaces the plain EcosystemBanner "Play Shahnameh"
 * promo on Home with Hakim (Shahnameh's guide character) inviting the user
 * in, speech-bubble style (Khabat, 2026-07-30: "en motiverende, varm,
 * invitation av Hakim ai... kom lær vinn og tjen din frihet kriger. sånt.
 * kan være at setninger som vises etter hverandre sånn som hakim snakker i
 * en bubble"). Only swapped on Home — EcosystemBanner itself is untouched
 * (still used unpinned/rotating on PremiumScreen and other screens).
 */
const LINE_KEYS = ['hakim.line1', 'hakim.line2', 'hakim.line3', 'hakim.line4', 'hakim.line5'] as const;
const LINE_MS = 3800;

interface Props {
  onOpenGame: () => void;
  style?: object;
}

export function ShahnamehHakimBanner({ onOpenGame, style }: Props) {
  const { t } = useT();
  const [lineIdx, setLineIdx] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => {
        setLineIdx((i) => (i + 1) % LINE_KEYS.length);
        Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      });
    }, LINE_MS);
    return () => clearInterval(id);
  }, [fade]);

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onOpenGame} style={[styles.card, style]}>
      <HakimAvatar size={56} />
      <View style={styles.bubbleWrap}>
        <View style={styles.bubble}>
          <View style={styles.bubbleTail} />
          <Animated.Text style={[styles.bubbleText, { opacity: fade }]} numberOfLines={2}>
            {t(LINE_KEYS[lineIdx])}
          </Animated.Text>
        </View>
        <Text style={styles.cta}>⚔ {t('hakim.cta')} ›</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    backgroundColor: '#171008',
    borderRadius: Radius['2xl'],
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    padding: Spacing[3],
  },
  bubbleWrap: { flex: 1, gap: 6 },
  bubble: {
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    position: 'relative',
  },
  bubbleTail: {
    position: 'absolute',
    left: -6, top: 14,
    width: 10, height: 10,
    backgroundColor: 'rgba(212,175,55,0.1)',
    borderLeftWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
    transform: [{ rotate: '45deg' }],
  },
  bubbleText: { fontSize: 12.5, fontFamily: Typography.family.body, color: Colors.text.primary, lineHeight: 17 },
  cta: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.gold[400], alignSelf: 'flex-start' },
});
