import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldButton } from './GoldButton';
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
    () => (isHero ? Array.from({ length: 8 }, () => ({
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
          <Animated.Text style={[styles.satHero, satStyle]}>🛰️</Animated.Text>
        </>
      ) : (
        <>
          <View style={styles.corner}><Text style={styles.cornerText}>VIP</Text></View>
          <Animated.Text style={[styles.sat, satStyle]}>🛰️</Animated.Text>
        </>
      )}

      <View style={styles.badge}>
        <Text style={styles.badgeIcon}>{unlocked ? '✓' : '🔒'}</Text>
        <Text style={styles.badgeText}>
          {unlocked ? t('home.starlinkUnlocked') : t('home.starlinkAccess')}
        </Text>
      </View>

      <Text style={[styles.word, isHero && styles.wordHero]}>STARLINK</Text>
      <Text style={styles.sub}>{t('starlink.description')}</Text>

      {!unlocked && (
        <View style={styles.track}>
          <InviteSlots count={inviteCount} target={inviteTarget} />
          <Text style={styles.trackLabel}>
            {t('home.starlinkInviteHint').replace('{n}', String(inviteLeft))}
          </Text>
        </View>
      )}

      {!unlocked && !isHero && (
        <GoldButton style={styles.cta} textStyle={styles.ctaText} onPress={onInvite}>
          {`👥 ${t('pr.inviteFriends')}`}
        </GoldButton>
      )}
      {isHero && (
        // Decorative only — the whole card is one TouchableOpacity at the
        // call site (HomeScreen), same interaction the plain banner it
        // replaces already had. Not a separate Pressable (avoids nesting
        // a button inside HomeScreen's own card-tap handler).
        <View style={styles.heroCta}>
          <Text style={styles.heroCtaText}>
            🛰️ {unlocked ? t('starlink.connectCta') : t('pr.inviteFriends')}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * The mockup's discrete "slot" metaphor (`04-freedom.html` §.invite-slot/
 * .invite-line) — numbered circles joined by connector lines, not a plain
 * bar — so "1 of 3 friends invited" reads as distinct steps. A connector
 * lights up once the slot to its left is filled; there's no partial-invite
 * concept (you either invited someone or not), so each segment is a binary
 * on/off, not a fractional fill.
 */
function InviteSlots({ count, target }: { count: number; target: number }) {
  const slots = Array.from({ length: target }, (_, i) => i < count);
  return (
    <View style={styles.slotRow}>
      {slots.map((filled, i) => (
        <React.Fragment key={i}>
          <View style={[styles.slot, filled && styles.slotFilled]}>
            <Text style={[styles.slotText, filled && styles.slotTextFilled]}>
              {filled ? '✓' : i + 1}
            </Text>
          </View>
          {i < slots.length - 1 && (
            <View style={styles.slotLine}>
              {filled && <View style={styles.slotLineFill} />}
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: Radius['2xl'],
    padding: Spacing[4],
    minHeight: 180,
    backgroundColor: Colors.bg.surface,
    borderWidth: 1,
    borderColor: 'rgba(51,211,255,0.22)',
    gap: Spacing[1],
  },
  cardHero: {
    backgroundColor: '#0A1220',
    minHeight: 168,
    shadowColor: Colors.cyan[400],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 4,
  },
  corner: {
    position: 'absolute', top: 14, right: -30, zIndex: 3,
    backgroundColor: Colors.gold[400], transform: [{ rotate: '40deg' }],
    paddingHorizontal: 36, paddingVertical: 3,
  },
  cornerText: { fontSize: 10, fontFamily: Typography.family.heading, color: '#241605', letterSpacing: 1 },
  sat: { position: 'absolute', top: 16, left: 20, fontSize: 18, opacity: 0.85 },
  satHero: { position: 'absolute', top: 18, right: 30, fontSize: 20, opacity: 0.9 },
  star: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(51,211,255,0.12)', borderWidth: 1, borderColor: 'rgba(51,211,255,0.4)',
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, marginTop: 4,
  },
  badgeIcon: { fontSize: 10 },
  badgeText: { fontSize: 10, fontFamily: Typography.family.label, color: Colors.cyan[300], letterSpacing: 1.5, textTransform: 'uppercase' },

  // Gold wordmark on the vip card (framed as a reward you unlock); cyan on
  // the hero (framed as the network itself) — matches the two mockups
  // exactly, not the same treatment reused twice.
  word: { fontSize: 30, fontFamily: Typography.family.displayGoldBold, color: Colors.gold[100], letterSpacing: 1, marginTop: 10 },
  wordHero: { color: Colors.cyan[300], fontSize: 32 },
  sub:  { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 6, maxWidth: 240, lineHeight: 17 },

  track:      { marginTop: 14 },
  slotRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)',
  },
  slotFilled: { borderStyle: 'solid', borderColor: Colors.gold[400], backgroundColor: Colors.gold[300] },
  slotText: { fontSize: 14, fontFamily: Typography.family.mono, color: Colors.text.muted },
  slotTextFilled: { color: '#241605', fontFamily: Typography.family.heading },
  slotLine: { flex: 1, height: 2, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  slotLineFill: { height: '100%', width: '100%', backgroundColor: Colors.gold[400] },
  trackLabel: { fontSize: 10.5, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 7 },

  cta: {
    marginTop: 14, alignSelf: 'flex-start',
    paddingHorizontal: 18,
  },
  ctaText: { fontSize: 13.5, fontFamily: Typography.family.heading },

  heroCta: {
    marginTop: 13, alignSelf: 'flex-start',
    backgroundColor: 'rgba(51,211,255,0.16)', borderWidth: 1, borderColor: 'rgba(127,227,255,0.5)',
    borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 10,
  },
  heroCtaText: { fontSize: 12.5, fontFamily: Typography.family.heading, color: Colors.cyan[300] },
});
