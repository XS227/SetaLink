/**
 * UsageHistoryChart — daily VPN data usage, last 14 days.
 *
 * Companion to ReferralEarningsDonut on the Clan tab: that one shows what
 * comes IN from invitees, this one shows what the user themself has used,
 * as a simple day-by-day bar chart. Same hand-rolled react-native-svg
 * approach as the donut (no chart library dependency).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Colors, Typography, Spacing } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { getUsageHistory, UsageDay } from '../services/usageHistoryService';

const ONE_GB = 1073741824;
const gb = (n: number) => (n / ONE_GB).toFixed(n >= ONE_GB ? 1 : 2);

const HEIGHT     = 90;
const BAR_GAP    = 4;
const MIN_BAR_H  = 2; // a zero-usage day still shows a sliver, not nothing

interface Props {
  deviceId: string;
  /** Same convention as ReferralEarningsDonut's `bare` — render as a plain
   *  View instead of its own GlassCard when nested in a shared wrapper. */
  bare?: boolean;
}

export function UsageHistoryChart({ deviceId, bare }: Props) {
  const { t } = useT();
  const [days, setDays] = useState<UsageDay[] | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    getUsageHistory(deviceId, 14).then((h) => setDays(h.days)).catch(() => {});
  }, [deviceId]);

  if (!days) return null;

  const total = days.reduce((sum, d) => sum + d.bytes, 0);
  const max   = Math.max(...days.map((d) => d.bytes), 1);
  const todayBytes = days[days.length - 1]?.bytes ?? 0;

  const Wrapper = bare ? View : GlassCard;
  const wrapperProps = bare ? { style: styles.bareCard } : { style: styles.card, glowColor: Colors.emerald[400] };

  return (
    <Wrapper {...(wrapperProps as any)}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('usage.title')}</Text>
        <Text style={styles.today}>{gb(todayBytes)} {t('usage.gb')}</Text>
      </View>
      <Text style={styles.sub}>{t('usage.sub').replace('{gb}', gb(total))}</Text>

      {total === 0 ? (
        <Text style={styles.empty}>{t('usage.empty')}</Text>
      ) : (
        <View style={styles.chartRow}>
          {days.map((d, idx) => {
            const h = Math.max(MIN_BAR_H, (d.bytes / max) * HEIGHT);
            const isToday = idx === days.length - 1;
            return (
              <View key={d.day} style={styles.barCol}>
                <Svg width="100%" height={HEIGHT} viewBox={`0 0 20 ${HEIGHT}`} preserveAspectRatio="none">
                  <Rect
                    x={2} y={HEIGHT - h} width={16} height={h} rx={3}
                    fill={isToday ? Colors.gold[400] : 'rgba(0, 232, 122, 0.55)'}
                  />
                </Svg>
              </View>
            );
          })}
        </View>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card:      { padding: Spacing[4], marginBottom: Spacing[4] },
  bareCard:  { gap: 0 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:     { color: Colors.text.primary, fontSize: 15, fontFamily: Typography.family.heading },
  today:     { color: Colors.gold[400], fontSize: 14, fontFamily: Typography.family.mono },
  sub:       { color: Colors.text.secondary, fontSize: 12, marginTop: 2, marginBottom: Spacing[3], lineHeight: 17 },
  chartRow:  { flexDirection: 'row', alignItems: 'flex-end', height: HEIGHT, gap: BAR_GAP },
  barCol:    { flex: 1, height: HEIGHT },
  empty:     { color: Colors.text.muted, fontSize: 12, lineHeight: 17 },
});
