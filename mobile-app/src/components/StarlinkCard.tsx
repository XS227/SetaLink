import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { useStarlinkStore } from '../stores/starlinkStore';
import { StarlinkMark } from './StarlinkMark';
import { useT } from '../i18n';

/**
 * 🛰️ STARLINK ACCESS — the Home hero card (b97 addendum #2).
 *
 * Starlink is sold as an EXPERIENCE, not a server: the card exists for every
 * user in every state and never disappears —
 *   locked      → invite progress toward unlock + Premium path
 *   unlocked    → "Connect via Starlink"
 *   maintenance → the card stays, only the connect action is unavailable
 * A one-shot glow animation plays the moment unlock flips true (justUnlocked).
 * Renders nothing only when the server reports no Starlink node at all.
 */

interface Props {
  onOpen:    () => void;   // dedicated Starlink page
  onInvite:  () => void;   // referral surface
  onConnect: () => void;   // select node + connect
}

export function StarlinkCard({ onOpen, onInvite, onConnect }: Props) {
  const { t, isRTL } = useT();
  const status        = useStarlinkStore((s) => s.status);
  const justUnlocked  = useStarlinkStore((s) => s.justUnlocked);
  const consumeUnlock = useStarlinkStore((s) => s.consumeUnlockMoment);

  // Unlock moment: three golden pulses, then settle. Consumed once.
  const unlockGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!justUnlocked) return;
    Animated.sequence([
      Animated.loop(
        Animated.sequence([
          Animated.timing(unlockGlow, { toValue: 1, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: false }),
          Animated.timing(unlockGlow, { toValue: 0.25, duration: 550, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        ]),
        { iterations: 3 },
      ),
      Animated.timing(unlockGlow, { toValue: 0, duration: 400, useNativeDriver: false }),
    ]).start(() => consumeUnlock());
  }, [justUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // Idle satellite drift — subtle, always on, cheap (single transform).
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!status?.node) return null;   // feature not launched server-side — nothing to promise

  const { unlock, node } = status;
  const unlocked    = unlock.unlocked;
  const available   = node.available;
  const invitesLeft = Math.max(0, unlock.invitesRequired - unlock.invitesVerified);
  const progress    = Math.min(1, unlock.invitesVerified / Math.max(1, unlock.invitesRequired));

  const borderColor = unlockGlow.interpolate({
    inputRange:  [0, 1],
    outputRange: ['rgba(51,211,255,0.35)', 'rgba(127,227,255,0.95)'],
  });

  return (
    <Animated.View style={[styles.card, { borderColor }]}>
      <TouchableOpacity activeOpacity={0.85} onPress={onOpen}>
        {/* Title row */}
        <View style={[styles.titleRow, isRTL && styles.rtlRow]}>
          <Animated.View
            style={[styles.satellite, { transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
          >
            <StarlinkMark size={24} />
          </Animated.View>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, isRTL && styles.rtlText]}>{t('sl.title')}</Text>
            <Text style={[styles.poweredBy, isRTL && styles.rtlText]}>{t('sl.poweredBy')}</Text>
          </View>
          {unlocked && available && (
            <View style={styles.readyBadge}>
              <Text style={styles.readyBadgeText}>{t('sl.ready')}</Text>
            </View>
          )}
        </View>

        <Text style={[styles.tagline, isRTL && styles.rtlText]}>{t('sl.tagline')}</Text>

        {/* State-specific body */}
        {!unlocked && (
          <>
            <Text style={[styles.unlockHint, isRTL && styles.rtlText]}>
              {t('sl.unlockHint').replace('{n}', String(unlock.invitesRequired))}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` as unknown as number }]} />
            </View>
            <View style={[styles.progressRow, isRTL && styles.rtlRow]}>
              <Text style={styles.progressText}>
                🔥 {t('sl.friendsToGo').replace('{n}', String(invitesLeft))}
              </Text>
              <Text style={styles.progressCount}>
                {unlock.invitesVerified} / {unlock.invitesRequired}
              </Text>
            </View>
            <TouchableOpacity style={styles.cta} onPress={onInvite} activeOpacity={0.85}>
              <Text style={styles.ctaText}>{t('sl.inviteCta')}</Text>
            </TouchableOpacity>
          </>
        )}

        {unlocked && available && (
          <TouchableOpacity style={[styles.cta, styles.ctaConnect]} onPress={onConnect} activeOpacity={0.85}>
            <Text style={[styles.ctaText, styles.ctaConnectText]}>{t('sl.connectCta')}</Text>
          </TouchableOpacity>
        )}

        {unlocked && !available && (
          // Never hide the product: maintenance keeps the card, only the
          // connect action goes away (statusNote: auto_returns_when_healthy).
          <View style={styles.maintenanceBox}>
            <Text style={[styles.maintenanceText, isRTL && styles.rtlText]}>{t('sl.maintenance')}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const STARLINK_CYAN = Colors.cyan[400];

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(6,10,20,0.92)',
    borderRadius:    Radius.xl,
    borderWidth:     1,
    padding:         Spacing[4],
    gap:             Spacing[2],
    shadowColor:     STARLINK_CYAN,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.35,
    shadowRadius:    14,
    elevation:       6,
  },
  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  rtlRow:     { flexDirection: 'row-reverse' },
  rtlText:    { textAlign: 'right', writingDirection: 'rtl' },
  satellite:  {},
  titleBlock: { flex: 1 },
  title:      { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.cyan[300], letterSpacing: 2 },
  poweredBy:  { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary, letterSpacing: 1, textTransform: 'uppercase', marginTop: 1 },
  readyBadge: { backgroundColor: 'rgba(51,211,255,0.15)', borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(51,211,255,0.5)', paddingHorizontal: Spacing[3], paddingVertical: 3 },
  readyBadgeText: { fontSize: 9, fontFamily: Typography.family.label, color: Colors.cyan[300], letterSpacing: 1, textTransform: 'uppercase' },
  tagline:    { fontSize: Typography.size.sm, fontFamily: Typography.family.body, color: Colors.text.secondary, marginTop: Spacing[1] },
  unlockHint: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(51,211,255,0.15)', overflow: 'hidden', marginTop: Spacing[1] },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: STARLINK_CYAN },
  progressRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressText:  { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.cyan[300] },
  progressCount: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: Colors.text.secondary },
  cta: {
    marginTop:       Spacing[2],
    borderRadius:    Radius.lg,
    paddingVertical: Spacing[3],
    alignItems:      'center',
    backgroundColor: 'rgba(51,211,255,0.16)',
    borderWidth:     1,
    borderColor:     'rgba(51,211,255,0.55)',
  },
  ctaConnect:     { backgroundColor: STARLINK_CYAN, borderColor: STARLINK_CYAN },
  ctaText:        { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.text.primary, letterSpacing: 0.5 },
  ctaConnectText: { color: Colors.text.inverse },
  maintenanceBox:  { marginTop: Spacing[2], borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,184,0,0.3)', backgroundColor: 'rgba(255,184,0,0.07)', padding: Spacing[3] },
  maintenanceText: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: '#FFB800', lineHeight: 17 },
});
