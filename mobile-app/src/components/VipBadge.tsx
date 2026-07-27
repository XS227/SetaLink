import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Radius, Shadow } from '../design/tokens';
import { useT } from '../i18n';

interface Props {
  /** Compact (badge only, e.g. inline next to a name) vs the default pill
   *  with a label — compact drops the "VIP" text and keeps just the mark. */
  compact?: boolean;
}

/**
 * Gold VIP status mark (2026-07-20) — the "vip" referral milestone
 * (pr.msVip, 21 invites, see ProfileScreen.tsx's FALLBACK_MILESTONES)
 * previously had no visible identity beyond a checked-off row in the
 * milestone ladder. This gives reaching it an actual, persistent mark
 * shown anywhere the user's own identity renders.
 *
 * Deliberately gold, not emerald — per the design system, emerald green
 * is reserved for VPN connection state, not a general accent. Gold is
 * "premium, referral, rewards" (design/tokens.ts).
 */
export function VipBadge({ compact }: Props) {
  const { t } = useT();
  if (compact) {
    return (
      <View style={styles.mark}>
        <Text style={styles.markIcon}>♛</Text>
      </View>
    );
  }
  return (
    <View style={styles.pill}>
      <Text style={styles.pillIcon}>♛</Text>
      <Text style={styles.pillText}>{t('pr.vipBadge')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    ...Shadow.gold,
  },
  pillIcon: { fontSize: 10, color: Colors.gold[400] },
  pillText: {
    fontSize: Typography.size.xs, fontFamily: Typography.family.label,
    color: Colors.gold[400], textTransform: 'uppercase', letterSpacing: 1,
  },
  mark: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(212,175,55,0.18)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  markIcon: { fontSize: 10, color: Colors.gold[400] },
});
