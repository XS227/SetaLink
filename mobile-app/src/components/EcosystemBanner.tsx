/**
 * EcosystemBanner — rotating promo strip for the Realink/REAL ecosystem.
 *
 * Cycles between the Shahnameh game (earn REAL) and the 3real exchange (trade REAL),
 * both carrying the REAL token mark. Different screens pass a `seed` so they start on
 * different promos (spreads the placements), and each banner also auto-rotates so a
 * single screen still surfaces both over time. Tapping opens the promo's link.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet, Animated } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useT } from '../i18n';

// Official REAL (RealShahnameh) token image — same mark used on TON explorers.
export const REAL_TOKEN_IMAGE =
  'https://asset.ston.fi/img/EQDhq_DjQUMJqfXLP8K8J6SlOvon08XQQK0T49xon2e0xU8p/6715c533d1863b28ca41fe6540511a26a0804397101acc4915a2b0b996af8f41';

const SHAHNAMEH_URL = 'https://t.me/shahnameh_bot?start=warrior_5629291605';
const THREEREAL_URL = 'https://www.3real.no';

const ROTATE_MS = 7000;

type Props = {
  /** Offset so different screens start on different promos. */
  seed?: number;
  /** Pin to a single promo (no rotation). Used when banners are placed at
   *  fixed positions in a list. */
  pin?: 'shahnameh' | 'threereal';
  style?: object;
};

export function EcosystemBanner({ seed = 0, pin, style }: Props) {
  const { t } = useT();

  const promos = [
    {
      id: 'shahnameh',
      emoji: '⚔️',
      image: undefined as string | undefined,
      title: t('bn.shahTitle'),
      sub:   t('bn.shahSub'),
      url:   SHAHNAMEH_URL,
    },
    {
      id: 'threereal',
      emoji: undefined as string | undefined,
      image: REAL_TOKEN_IMAGE,
      title: t('bn.realTitle'),
      sub:   t('bn.realSub'),
      url:   THREEREAL_URL,
    },
  ];

  const pinnedIdx = pin ? promos.findIndex((p) => p.id === pin) : -1;
  const [idx, setIdx] = useState(
    pinnedIdx >= 0 ? pinnedIdx : ((seed % promos.length) + promos.length) % promos.length,
  );
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useEffect(() => {
    if (pinnedIdx >= 0) return; // pinned banners never rotate
    const id = setInterval(() => {
      setIdx((idxRef.current + 1) % promos.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [promos.length, pinnedIdx]);

  const promo = promos[idx] ?? promos[0]!;

  // Calm breathing glow — a gold tint layer slowly fading in and out behind
  // the content. Quiet by design: it should register at the edge of the eye,
  // never compete with the server rows around it.
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, []);

  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={() => Linking.openURL(promo.url).catch(() => {})}
      activeOpacity={0.85}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.glowLayer, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.1] }) }]}
      />
      {promo.image ? (
        <Image source={{ uri: promo.image }} style={styles.tokenImg} resizeMode="cover" />
      ) : (
        <Text style={styles.emoji}>{promo.emoji}</Text>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{promo.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{promo.sub}</Text>
      </View>
      <View style={styles.dots}>
        {promos.map((p, i) => (
          <View key={p.id} style={[styles.dot, i === idx && styles.dotActive]} />
        ))}
      </View>
    </TouchableOpacity>
  );
}

const GOLD = '#C9A42A';

// Same card geometry as ServerRow (the server-list rows), so promo/ad slots sit
// in the list as quiet equals rather than shouting banners.
const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    backgroundColor: Colors.bg.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(201,164,42,0.28)',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    overflow: 'hidden',
  },
  glowLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GOLD,
  },
  emoji:    { fontSize: 24 },
  tokenImg: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(201,164,42,0.15)' },
  body:     { flex: 1 },
  title:    { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: GOLD },
  sub:      { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },
  dots:     { flexDirection: 'row', gap: 4 },
  dot:      { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(201,164,42,0.25)' },
  dotActive:{ backgroundColor: GOLD },
});
