/**
 * CommunityRankCard — the member's standing in the Realink community.
 *
 * Rank climbs with TrustAI-verified invites (activeInviteCount): every member
 * starts as a Warrior, becomes a Pahlavan at 3 and King at 10 — Shahnameh
 * flavor to match the ecosystem. The clan is the middle segment of the user id
 * (SL-227-XXXXXXXX → clan 227), so clanmates share a visible identity with
 * zero backend. TrustAI's role is surfaced as verified-invite count.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';

export const RANK_THRESHOLDS = { hero: 3, king: 10 } as const;

export type RankKey = 'warrior' | 'hero' | 'king';

export interface CommunityRank {
  key: RankKey;
  icon: string;
  /** Verified invites still needed for the next rank; null at the top. */
  next: { key: RankKey; icon: string; needed: number; at: number } | null;
  /** 0..1 progress from the current rank's floor to the next threshold. */
  progress: number;
}

export function getCommunityRank(verifiedInvites: number): CommunityRank {
  const n = Math.max(0, verifiedInvites);
  if (n >= RANK_THRESHOLDS.king) {
    return { key: 'king', icon: '👑', next: null, progress: 1 };
  }
  if (n >= RANK_THRESHOLDS.hero) {
    return {
      key: 'hero', icon: '🛡️',
      next: { key: 'king', icon: '👑', needed: RANK_THRESHOLDS.king - n, at: RANK_THRESHOLDS.king },
      progress: (n - RANK_THRESHOLDS.hero) / (RANK_THRESHOLDS.king - RANK_THRESHOLDS.hero),
    };
  }
  return {
    key: 'warrior', icon: '⚔️',
    next: { key: 'hero', icon: '🛡️', needed: RANK_THRESHOLDS.hero - n, at: RANK_THRESHOLDS.hero },
    progress: n / RANK_THRESHOLDS.hero,
  };
}

/** SL-227-XXXXXXXX → "227"; '' when the id has no clan segment yet. */
export function getClanId(userId: string): string {
  const parts = (userId || '').split('-');
  return parts.length >= 3 ? parts[1]! : '';
}

interface Props {
  userId: string;
  inviteCount: number;
  activeInviteCount: number;
  onInvite: () => void;
}

export function CommunityRankCard({ userId, inviteCount, activeInviteCount, onInvite }: Props) {
  const { t } = useT();
  const rank = getCommunityRank(activeInviteCount);
  const clan = getClanId(userId);
  const rankName = (k: RankKey) => t(`pr.rank_${k}`);

  return (
    <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
      <View style={styles.headerRow}>
        <Text style={styles.cardLabel}>{t('pr.communityTitle')}</Text>
        {!!clan && (
          <View style={styles.clanChip}>
            <Text style={styles.clanChipText}>{t('pr.clanLabel')} {clan}</Text>
          </View>
        )}
      </View>

      <View style={styles.rankRow}>
        <Text style={styles.rankIcon}>{rank.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rankName}>{rankName(rank.key)}</Text>
          <Text style={styles.rankSub}>
            {rank.next
              ? t('pr.rankNext')
                  .replace('{n}', String(rank.next.needed))
                  .replace('{rank}', rankName(rank.next.key))
              : t('pr.rankMax')}
          </Text>
        </View>
      </View>

      {rank.next && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(rank.progress * 100)}%` }]} />
        </View>
      )}

      <View style={styles.trustRow}>
        <Text style={styles.trustIcon}>✓</Text>
        <Text style={styles.trustText}>
          {t('pr.trustaiVerified')
            .replace('{a}', String(Math.max(0, activeInviteCount)))
            .replace('{b}', String(Math.max(activeInviteCount, inviteCount)))}
        </Text>
      </View>

      <TouchableOpacity style={styles.inviteBtn} activeOpacity={0.85} onPress={onInvite}>
        <Text style={styles.inviteBtnText}>{t('pr.inviteFriends')}</Text>
      </TouchableOpacity>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card:      { marginBottom: Spacing[4], padding: Spacing[4], gap: Spacing[3] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { fontSize: Typography.size.xs, color: Colors.text.muted,
               fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 1 },
  clanChip:  { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.gold[400] + '55',
               backgroundColor: Colors.gold[400] + '14', paddingHorizontal: 10, paddingVertical: 3 },
  clanChipText: { fontSize: Typography.size.xs, color: Colors.gold[400], fontFamily: Typography.family.heading },
  rankRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  rankIcon:  { fontSize: 34 },
  rankName:  { fontSize: Typography.size.lg, color: Colors.text.primary, fontFamily: Typography.family.heading },
  rankSub:   { fontSize: Typography.size.xs, color: Colors.text.secondary, marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },
  trustRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustIcon: { fontSize: 12, color: Colors.emerald[400], fontFamily: Typography.family.heading },
  trustText: { flex: 1, fontSize: Typography.size.xs, color: Colors.text.secondary },
  inviteBtn: { borderRadius: Radius.lg, paddingVertical: 10, alignItems: 'center',
               backgroundColor: Colors.gold[400] + '22', borderWidth: 1, borderColor: Colors.gold[400] + '66' },
  inviteBtnText: { fontSize: Typography.size.sm, color: Colors.gold[400], fontFamily: Typography.family.heading },
});
