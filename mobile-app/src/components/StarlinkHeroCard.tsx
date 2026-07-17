/**
 * StarlinkHeroCard — Home's Starlink unlock/progress card (b97 product
 * correction + hotfix addendum, Khabat 2026-07-17). Replaces the old
 * Shahnameh promo slot. Sells Starlink as an experience, not a server:
 * distinct gold/satellite identity, never hidden even while the node is
 * down ("keep the card visible — never hide the product").
 *
 * Driven entirely by GET /v1/starlink/unlock-status (starlinkStore) — no
 * client-side guessing of unlock state, so this always matches what the
 * server actually enforces.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../design/tokens';
import { useT } from '../i18n';
import type { StarlinkUnlockStatus } from '../services/api/starlink.api';

const GOLD = Colors.gold[400];

interface Props {
  status: StarlinkUnlockStatus | null;
  isConnectedViaStarlink: boolean;
  onConnect: () => void;
  onInvite:  () => void;
  onUpgrade: () => void;
}

export function StarlinkHeroCard({ status, isConnectedViaStarlink, onConnect, onInvite, onUpgrade }: Props) {
  const { t } = useT();

  // No status fetched yet, or the server has no Starlink node configured at
  // all (node === null, per the API contract) — nothing to promote.
  if (!status || status.node === null) return null;

  const { unlock, node } = status;
  const progress = Math.min(1, unlock.invitesVerified / Math.max(1, unlock.invitesRequired));

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>🛰️</Text>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{t('sl.access')}</Text>
          <Text style={styles.tagline}>{t('sl.tagline')}</Text>
        </View>
      </View>

      {unlock.unlocked ? (
        node.available ? (
          <TouchableOpacity style={styles.actionBtn} onPress={onConnect} activeOpacity={0.85}>
            <Text style={styles.actionBtnText}>
              {isConnectedViaStarlink ? t('sl.connectedVia') : t('sl.connectVia')}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.unavailable}>{t('sl.unavailable')}</Text>
        )
      ) : (
        <>
          <View style={styles.unlockPathRow}>
            <Text style={styles.unlockPath}>⭐ {t('sl.premium')}</Text>
            <Text style={styles.unlockOr}>— {t('sl.or')} —</Text>
            <Text style={styles.unlockPath}>
              🔥 {t('sl.unlockByInvite').replace('{n}', String(unlock.invitesRequired))}
            </Text>
          </View>
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>
              {unlock.invitesVerified} / {unlock.invitesRequired}
            </Text>
          </View>
          <TouchableOpacity style={styles.actionBtn} onPress={onInvite} activeOpacity={0.85}>
            <Text style={styles.actionBtnText}>{t('sl.inviteFriends')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: 'rgba(212,175,55,0.06)',
    padding: Spacing[4],
    gap: Spacing[3],
    ...Shadow.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  icon: { fontSize: 28 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: Typography.size.base, fontFamily: Typography.family.heading, color: GOLD, letterSpacing: 0.4 },
  tagline: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, marginTop: 2 },

  unlockPathRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing[2] },
  unlockPath: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: Colors.text.secondary },
  unlockOr:   { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border.default,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: GOLD },
  progressLabel: { fontSize: Typography.size.xs, fontFamily: Typography.family.mono, color: GOLD },

  actionBtn: {
    borderRadius: Radius.md,
    backgroundColor: GOLD,
    paddingVertical: Spacing[2] + 2,
    alignItems: 'center',
  },
  actionBtnText: { fontSize: Typography.size.xs, fontFamily: Typography.family.label, color: '#1A1400', letterSpacing: 0.3 },

  unavailable: { fontSize: Typography.size.xs, fontFamily: Typography.family.body, color: Colors.text.muted, fontStyle: 'italic' },
});
