import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';

/**
 * StarlinkBanner — the "locked reward" card (theme pkg `04-freedom.html`
 * §vip, `10-starlink-banner.html`). Only the variant Freedom actually needs
 * right now; the spec's hero/compact variants aren't built until a screen
 * needs them.
 *
 * "Cyan = Starlink/network" is the theme's own rule — this card is cyan/
 * violet, not gold, on purpose (gold stays reserved for currency/the coin).
 */

interface Props {
  unlocked: boolean;
  inviteCount: number;
  inviteTarget: number;
  onInvite: () => void;
}

export function StarlinkBanner({ unlocked, inviteCount, inviteTarget, onInvite }: Props) {
  const { t } = useT();
  const inviteLeft = Math.max(0, inviteTarget - inviteCount);
  const invitePct  = Math.min(1, inviteCount / inviteTarget);

  const orbit = useSharedValue(0);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      orbit.value = withRepeat(withTiming(1, { duration: 26000, easing: Easing.linear }), -1, false);
    }).catch(() => {});
    return () => { cancelled = true; cancelAnimation(orbit); };
  }, [orbit]);

  // Slow elliptical drift, not a literal orbit path — cheap and reads fine
  // at this size; matches the spec's "ambient, never fast" motion rule.
  const satStyle = useAnimatedStyle(() => {
    const a = orbit.value * Math.PI * 2;
    return {
      transform: [
        { translateX: Math.cos(a) * 26 },
        { translateY: Math.sin(a) * 12 },
      ],
    };
  });

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={unlocked ? 1 : 0.85}
      onPress={unlocked ? undefined : onInvite}
      disabled={unlocked}
    >
      <View style={styles.corner}><Text style={styles.cornerText}>VIP</Text></View>
      <Animated.Text style={[styles.sat, satStyle]}>🛰️</Animated.Text>

      <View style={styles.badge}>
        <Text style={styles.badgeIcon}>{unlocked ? '✓' : '🔒'}</Text>
        <Text style={styles.badgeText}>
          {unlocked ? t('home.starlinkUnlocked') : t('home.starlinkAccess')}
        </Text>
      </View>

      <Text style={styles.word}>STARLINK</Text>
      <Text style={styles.sub}>{t('starlink.description')}</Text>

      {!unlocked && (
        <View style={styles.track}>
          <View style={styles.trackWrap}>
            <View style={[styles.trackFill, { flex: invitePct }]} />
            <View style={{ flex: Math.max(0, 1 - invitePct) }} />
          </View>
          <Text style={styles.trackLabel}>
            {t('home.starlinkInviteHint').replace('{n}', String(inviteLeft))}
          </Text>
        </View>
      )}

      {!unlocked && (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>👥 {t('pr.inviteFriends')}</Text>
        </View>
      )}
    </TouchableOpacity>
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
  corner: {
    position: 'absolute', top: 14, right: -30, zIndex: 3,
    backgroundColor: Colors.gold[400], transform: [{ rotate: '40deg' }],
    paddingHorizontal: 36, paddingVertical: 3,
  },
  cornerText: { fontSize: 10, fontFamily: Typography.family.heading, color: '#241605', letterSpacing: 1 },
  sat: { position: 'absolute', top: 16, left: 20, fontSize: 18, opacity: 0.85 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(51,211,255,0.12)', borderWidth: 1, borderColor: 'rgba(51,211,255,0.4)',
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, marginTop: 4,
  },
  badgeIcon: { fontSize: 10 },
  badgeText: { fontSize: 10, fontFamily: Typography.family.label, color: Colors.cyan[300], letterSpacing: 1.5, textTransform: 'uppercase' },

  word: { fontSize: 30, fontFamily: Typography.family.displayGoldBold, color: Colors.gold[100], letterSpacing: 1, marginTop: 10 },
  sub:  { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 6, maxWidth: 240, lineHeight: 17 },

  track:      { marginTop: 14 },
  trackWrap:  { height: 4, flexDirection: 'row', borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,182,39,0.14)' },
  trackFill:  { backgroundColor: Colors.gold[400], borderRadius: 2 },
  trackLabel: { fontSize: 10.5, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 7 },

  cta: {
    marginTop: 14, alignSelf: 'flex-start',
    backgroundColor: Colors.gold[400], borderRadius: Radius.lg,
    paddingHorizontal: 18, paddingVertical: 11,
  },
  ctaText: { fontSize: 13.5, fontFamily: Typography.family.heading, color: '#241605' },
});
