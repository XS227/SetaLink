/**
 * InvitedFriendsList — every friend you've invited, one row each.
 *
 * Companion to ReferralEarningsDonut (which only shows the top 6 in its
 * legend, sized for the donut's chart). This is the full list Khabat asked
 * for: each invitee plus what they've earned you so far (the ongoing %
 * ambassador cut), with a header caption stating the flat one-time reward
 * every invite pays out immediately — 5 GiB quota AND 500 REAL as of
 * 2026-07-28 (referral_reward_mode='both', lib/real_economy.php;
 * QE_REFERRAL_BYTES, lib/quota_economy.php). The REAL half only actually
 * lands once the invitee has a linked REAL account — falls back to
 * quota-only silently otherwise (re_referral_grant), so this caption
 * states the intended reward, not a per-invite guarantee.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { getReferralEarnings, ReferralEarnings } from '../services/referralEarningsService';

const ONE_GB = 1073741824;
const gb = (n: number) => (n / ONE_GB).toFixed(n >= ONE_GB ? 1 : 2);

interface Props {
  deviceId: string;
  bare?: boolean;
}

export function InvitedFriendsList({ deviceId, bare }: Props) {
  const { t } = useT();
  const [data, setData] = useState<ReferralEarnings | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    getReferralEarnings(deviceId).then(setData).catch(() => {});
  }, [deviceId]);

  if (!data) return null;

  const Wrapper = bare ? View : GlassCard;
  const wrapperProps = bare ? { style: styles.bareCard } : { style: styles.card };

  return (
    <Wrapper {...(wrapperProps as any)}>
      <Text style={styles.title}>{t('invList.title').replace('{n}', String(data.count))}</Text>
      <Text style={styles.sub}>{t('invList.perInviteFlat')}</Text>
      <Text style={styles.sub}>{t('invList.ongoingPct').replace('{pct}', String(data.pct))}</Text>

      {data.invitees.length === 0 ? (
        <Text style={styles.empty}>{t('invList.empty')}</Text>
      ) : (
        <View style={styles.list}>
          {data.invitees.map((inv, idx) => (
            <View key={idx} style={styles.row}>
              <Text style={styles.rowName} numberOfLines={1}>{inv.label}</Text>
              <Text style={styles.rowVal}>+{gb(inv.earned_bytes)} GB</Text>
            </View>
          ))}
        </View>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card:     { padding: Spacing[4], marginBottom: Spacing[4], gap: Spacing[1] },
  bareCard: { gap: Spacing[1] },
  title:    { color: Colors.text.primary, fontSize: 15, fontFamily: Typography.family.heading },
  sub:      { color: Colors.text.secondary, fontSize: 12, lineHeight: 17 },
  empty:    { color: Colors.text.muted, fontSize: 12, lineHeight: 17, marginTop: Spacing[2] },
  list:     { marginTop: Spacing[2], gap: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border.subtle },
  rowName:  { flex: 1, color: Colors.text.secondary, fontSize: 13 },
  rowVal:   { color: Colors.status.connected, fontSize: 13, fontFamily: Typography.family.mono },
});
