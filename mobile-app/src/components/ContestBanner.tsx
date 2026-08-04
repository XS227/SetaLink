import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GoldButton } from './GoldButton';
import { useT } from '../i18n';

/**
 * ContestBanner — Freedom-tab (ServersScreen) motivation card for the
 * pre-release 100-invite / $100 USDT contest. Modeled directly on
 * StarlinkBanner's 'vip' variant (same card shape: corner ribbon, badge,
 * one status line, GoldButton CTA) since that's already the established
 * "locked-reward card living on this exact tab" pattern — but gold-only,
 * no orbit/satellite decoration, because gold = currency/reward and
 * cyan = Starlink/network are two different established color meanings
 * (design/tokens.ts convention) and this banner is about money, not the
 * network itself.
 */

interface Props {
  qualifies:       boolean;
  claimed:         boolean;
  inviteCount:     number;
  inviteTarget:    number;
  walletConnected: boolean;
  onInvite:        () => void;
}

export function ContestBanner({ qualifies, claimed, inviteCount, inviteTarget, walletConnected, onInvite }: Props) {
  const { t } = useT();
  const inviteLeft = Math.max(0, inviteTarget - inviteCount);
  const unlocked = qualifies || claimed;

  const statusText = claimed
    ? t('contest.bannerClaimed')
    : qualifies
      ? t('contest.bannerReadyToClaim')
      : !walletConnected && inviteLeft === 0
        ? t('contest.bannerWalletNeeded')
        : t('contest.bannerInviteHint').replace('{n}', String(inviteLeft));

  return (
    <View style={styles.card}>
      <View style={styles.corner}><Text style={styles.cornerText}>$100</Text></View>

      <View style={styles.headRow}>
        <Text style={styles.word}>{t('contest.bannerWordmark')}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeIcon}>{unlocked ? '✓' : '🔒'}</Text>
          <Text style={styles.badgeText}>
            {unlocked ? t('contest.bannerBadgeUnlocked') : t('contest.bannerBadgeLocked')}
          </Text>
        </View>
      </View>

      <Text style={styles.statusLine} numberOfLines={2}>{statusText}</Text>

      {!claimed && (
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
    borderColor: 'rgba(255,182,39,0.25)',
    gap: Spacing[1],
  },
  corner: {
    position: 'absolute', top: 14, right: -30, zIndex: 3,
    backgroundColor: Colors.gold[400], transform: [{ rotate: '40deg' }],
    paddingHorizontal: 30, paddingVertical: 3,
  },
  cornerText: { fontSize: 10, fontFamily: Typography.family.heading, color: '#241605', letterSpacing: 0.5 },

  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing[2] },
  word: { fontSize: 19, fontFamily: Typography.family.displayGoldBold, color: Colors.gold[100], letterSpacing: 1 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,182,39,0.12)', borderWidth: 1, borderColor: 'rgba(255,182,39,0.4)',
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgeIcon: { fontSize: 10 },
  badgeText: { fontSize: 10, fontFamily: Typography.family.label, color: Colors.gold[300], letterSpacing: 1.5, textTransform: 'uppercase' },

  statusLine: { fontSize: 12, fontFamily: Typography.family.body, color: Colors.text.secondary, marginTop: 2 },

  cta: {
    marginTop: Spacing[2], alignSelf: 'flex-start',
    paddingHorizontal: 18,
  },
  ctaText: { fontSize: 13.5, fontFamily: Typography.family.heading },
});
