import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldButton } from './GoldButton';
import { StarlinkMark } from './StarlinkMark';
import { useT } from '../i18n';

/**
 * StarlinkBanner — cyan/violet, not gold, on purpose ("Cyan = Starlink/
 * network" is the theme's own rule; gold stays reserved for currency/the
 * coin). Two variants, matching the theme pkg exactly:
 *   'vip'  — the locked-reward card (04-freedom.html §vip). Gold wordmark
 *            (framed as a reward you unlock), invite-progress track, a real
 *            interactive "Invite Friends" GoldButton CTA.
 *   'hero' — the bigger Home-top banner (01-home.html §hero,
 *            10-starlink-banner.html). Cyan wordmark (framed as the
 *            network itself, not a reward), stars + orbiting satellite
 *            backdrop. Decorative CTA text only — the whole card is a
 *            single TouchableOpacity at the call site (HomeScreen), same
 *            interaction the plain banner it replaces already had.
 */

interface Props {
  variant?: 'vip' | 'hero';
  unlocked: boolean;
  inviteCount: number;
  inviteTarget: number;
  onInvite: () => void;
}

function useSlowOrbit(durationMs: number) {
  const orbit = useSharedValue(0);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      orbit.value = withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false);
    }).catch(() => {});
    return () => { cancelled = true; cancelAnimation(orbit); };
  }, [orbit, durationMs]);
  return orbit;
}

function Star({ left, top, delay }: { left: number; top: number; delay: number }) {
  const twinkle = useSharedValue(0);
  useEffect(() => {
    twinkle.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, true,
    ));
  }, [twinkle, delay]);
  const style = useAnimatedStyle(() => ({ opacity: 0.15 + twinkle.value * 0.7 }));
  return <Animated.View style={[styles.star, { left: `${left}%`, top: `${top}%` }, style]} />;
}

export function StarlinkBanner({ variant = 'vip', unlocked, inviteCount, inviteTarget, onInvite }: Props) {
  const { t } = useT();
  const inviteLeft = Math.max(0, inviteTarget - inviteCount);
  const isHero = variant === 'hero';

  const orbit = useSlowOrbit(isHero ? 22000 : 26000);
  const satStyle = useAnimatedStyle(() => {
    const a = orbit.value * Math.PI * 2;
    const r = isHero ? 44 : 26;
    return { transform: [{ translateX: Math.cos(a) * r }, { translateY: Math.sin(a) * (r * 0.46) }] };
  });

  const stars = useMemo(
    () => (isHero ? Array.from({ length: 5 }, () => ({
      left: Math.random() * 90, top: Math.random() * 55, delay: Math.random() * 2000,
    })) : []),
    [isHero],
  );

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {}); }, []);

  return (
    <View style={[styles.card, isHero && styles.cardHero]}>
      {isHero ? (
        <>
          {!reduceMotion && stars.map((s, i) => <Star key={i} {...s} />)}
          <Animated.View style={[styles.satHero, satStyle]}><StarlinkMark size={22} /></Animated.View>
        </>
      ) : (
        <>
          <View style={styles.corner}><Text style={styles.cornerText}>VIP</Text></View>
          <Animated.View style={[styles.sat, satStyle]}><StarlinkMark size={20} /></Animated.View>
        </>
      )}

      <View style={styles.headRow}>
        <Text style={[styles.word, isHero && styles.wordHero]}>STARLINK</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeIcon}>{unlocked ? '✓' : '🔒'}</Text>
          <Text style={styles.badgeText}>
            {unlocked ? t('home.starlinkUnlocked') : t('home.starlinkAccess')}
          </Text>
        </View>
      </View>

      {/* Khabat, 2026-07-30: "starlink banner kan være mindre i høyden.
          trenger ikke mye text der enn enten: 1. for å få tilgang må du ha
          x antall invites/clan medlemer. 2. nå har du tilgang" — collapsed
          the wordmark description + dot-progress track down to this one
          status line, in both states. */}
      <Text style={styles.statusLine} numberOfLines={1}>
        {unlocked ? t('starlink.connectCta') : t('home.starlinkInviteHint').replace('{n}', String(inviteLeft))}
      </Text>

      {!unlocked && !isHero && (
        <GoldButton style={styles.cta} textStyle={styles.ctaText} onPress={onInvite} accessibilityLabel={t('pr.inviteFriends')}>
          {`👥 ${t('pr.inviteFriends')}`}
        </GoldButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: Radius['2xl'],
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    backgroundColor: Colors.bg.surface,
    borderWidth: 1,
    borderColor: 'rgba(51,211,255,0.22)',
    gap: Spacing[1],
  },
  cardHero: {
    backgroundColor: '#0A1220',
    shadowColor: Colors.cyan[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 4,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[2] },
  corner: {
    position: 'absolute', top: 14, right: -30, zIndex: 3,
    backgroundColor: Colors.gold[400], transform: [{ rotate: '40deg' }],
    paddingHorizontal: 36, paddingVertical: 3,
  },
  cornerText: { fontSize: 10, fontFamily: Typography.family.heading, color: '#241605', letterSpacing: 1 },
  // Khabat, 2026-07-30: "det sathelit ikonet som går rundt går skjult bak
  // kantene noen ganger" — real bug, not a one-off: the anchor sat closer
  // to its card edge than the orbit's own radius (vip: left:20 vs r:26 —
  // every swing past translateX:-20 pushed the emoji to a negative left
  // position, clipped by the card's `overflow:hidden`; hero: right:30 vs
  // r:44, same problem on the right edge, which is why it only "sometimes"
  // clipped — only the half of each orbit swinging edge-ward). Moved both
  // anchors further from their edge than the orbit radius (with margin),
  // and inward toward the CTA's side of the card per "dra den mer mot cta
  // knappen" — cta/heroCta both render self-aligned to the left, so both
  // anchors shifted left/down accordingly, not just away from the edge.
  sat: { position: 'absolute', bottom: 10, right: 54, opacity: 0.7 },
  satHero: { position: 'absolute', bottom: 8, right: 54, opacity: 0.75 },
  star: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(51,211,255,0.12)', borderWidth: 1, borderColor: 'rgba(51,211,255,0.4)',
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeIcon: { fontSize: 10 },
  badgeText: { fontSize: 10, fontFamily: Typography.family.label, color: Colors.cyan[300], letterSpacing: 1.5, textTransform: 'uppercase' },

  // Gold wordmark on the vip card (framed as a reward you unlock); cyan on
  // the hero (framed as the network itself) — matches the two mockups
  // exactly, not the same treatment reused twice.
  word: { fontSize: 19, fontFamily: Typography.family.displayGoldBold, color: Colors.gold[100], letterSpacing: 1 },
  wordHero: { color: Colors.cyan[300], fontSize: 20 },
  statusLine: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.secondary, marginTop: 2 },

  cta: {
    marginTop: Spacing[2], alignSelf: 'flex-start',
    paddingHorizontal: 18,
  },
  ctaText: { fontSize: 13.5, fontFamily: Typography.family.heading },
});
