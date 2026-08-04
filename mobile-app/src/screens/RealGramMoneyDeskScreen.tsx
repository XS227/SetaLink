/**
 * RealGramMoneyDeskScreen — pre-release 100-invite / $100 USDT contest
 * (Khabat, 2026-08-04). Reached from a summary card on RealGramClanScreen,
 * same "tappable summary -> own screen" pattern already used there for the
 * Shahnameh clan card.
 *
 * Payout is manual-review, never automatic (see lib/contest.php on the
 * backend) — claiming here only creates a 'pending' row an admin approves
 * and pays by hand. The "income" section below reuses the app's existing
 * GB-based referral-earnings number (ReferralEarningsDonut/InvitedFriendsList,
 * already live-wired), relabeled — there is no real per-user $ revenue
 * tracked anywhere in this backend to show instead (confirmed during
 * planning), and showing a fabricated dollar figure would be dishonest.
 */

import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { TonConnectCard } from '../components/TonConnectCard';
import { ReferralEarningsDonut } from '../components/ReferralEarningsDonut';
import { InvitedFriendsList } from '../components/InvitedFriendsList';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useContestStore } from '../stores/contestStore';
import { useToastStore } from '../stores/toastStore';

// Starlink's own gate (V1_STARLINK_INVITES_REQUIRED, public/v1.php) unlocks
// at 11 — informational only here, the gate already applies automatically
// well before someone reaches the contest's 100.
const STARLINK_INVITE_TARGET = 11;

interface Props {
  onBack:   () => void;
  onInvite: () => void;
}

export function RealGramMoneyDeskScreen({ onBack, onInvite }: Props) {
  const { t, isRTL } = useT();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const token    = useAuthStore((s) => s.token);

  const status     = useContestStore((s) => s.status);
  const isClaiming = useContestStore((s) => s.isClaiming);

  useEffect(() => {
    if (!token) return;
    useContestStore.getState().refresh(token).catch(() => {});
  }, [token]);

  const invitesVerified = status?.invitesVerified ?? 0;
  const invitesRequired = status?.invitesRequired ?? 100;
  const progress = Math.min(1, invitesVerified / Math.max(1, invitesRequired));
  const walletConnected = status?.walletConnected ?? false;
  const qualifies = status?.qualifies ?? false;
  const claimStatus = status?.claimStatus ?? null;
  const starlinkUnlocked = invitesVerified >= STARLINK_INVITE_TARGET;

  const handleClaim = async () => {
    if (!token) return;
    try {
      await useContestStore.getState().claim(token);
      showToast(t('contest.claimSuccess'), 'success');
    } catch {
      showToast(t('contest.claimError'), 'error');
    }
  };

  const claimBtnLabel = claimStatus === 'paid'
    ? t('contest.claimStatusPaid')
    : claimStatus === 'approved'
      ? t('contest.claimStatusApproved')
      : claimStatus === 'pending'
        ? t('contest.claimStatusPending')
        : claimStatus === 'rejected'
          ? t('contest.claimStatusRejected')
          : isClaiming
            ? t('contest.claiming')
            : t('contest.claimCta');
  const claimDisabled = !!claimStatus || !qualifies || isClaiming;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <EmberField count={6} />
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBack, { top: insets.top + Spacing[3] }]}
        hitSlop={12}
        activeOpacity={0.75}
      >
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>{t('contest.title')}</Text>
        <Text style={styles.pageSub}>{t('contest.subtitle')}</Text>

        {/* Progress — same progress-track visual language as
            CommunityRankCard, on a 0..100 scale instead of rank tiers. */}
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <View style={styles.progressHeadRow}>
            <Text style={styles.cardLabel}>{t('contest.progressLabel')}</Text>
            <Text style={styles.progressCount}>{invitesVerified}/{invitesRequired}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.progressSub}>
            {qualifies ? t('contest.progressQualified') : t('contest.progressHint')}
          </Text>
          {starlinkUnlocked && (
            <Text style={styles.starlinkLine}>🛰️ {t('contest.starlinkUnlocked')}</Text>
          )}
        </GlassCard>

        {/* Wallet — required before a claim can be created. */}
        <TonConnectCard
          onConnected={(wallet) => {
            if (!token) return;
            useContestStore.getState()
              .connectWallet(token, wallet.address, wallet.chain)
              .catch(() => {});
          }}
        />

        {/* Income — existing GB-based referral-earnings number, relabeled.
            See this file's own header for why there's no real $ figure to
            show instead. */}
        <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
          <Text style={styles.cardLabel}>{t('contest.incomeLabel')}</Text>
          <ReferralEarningsDonut deviceId={deviceId} bare hideInviteBtn />
          <InvitedFriendsList deviceId={deviceId} bare />
        </GlassCard>

        <TouchableOpacity
          style={[styles.claimBtn, claimDisabled && styles.claimBtnDisabled]}
          activeOpacity={0.85}
          disabled={claimDisabled}
          onPress={handleClaim}
          accessibilityRole="button"
          accessibilityState={{ disabled: claimDisabled }}
        >
          <Text style={styles.claimBtnText}>{claimBtnLabel}</Text>
        </TouchableOpacity>
        {!qualifies && !claimStatus && (
          <Text style={styles.claimHint}>
            {!walletConnected ? t('contest.claimHintWallet') : t('contest.claimHintInvites')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: Colors.bg.void },
  content: { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[2] },

  card: { width: '100%', gap: Spacing[2], padding: Spacing[4] },
  cardLabel: { fontSize: 12, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  progressHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressCount: { fontSize: 16, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 4, backgroundColor: Colors.gold[400] },
  progressSub:   { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.secondary },
  starlinkLine:  { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.cyan[300], marginTop: Spacing[1] },

  claimBtn: {
    backgroundColor: Colors.gold[400], borderRadius: Radius.full,
    paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[2],
  },
  claimBtnDisabled: { backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  claimBtnText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void, textTransform: 'uppercase', letterSpacing: 0.5 },
  claimHint: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.muted, textAlign: 'center' },
});
