/**
 * ReferralEarningsDonut — the ambassador's earnings, visualized.
 *
 * A donut where each slice is one person you invited, sized by how much you've
 * earned from their usage (a fixed % of their traffic, ongoing). The centre
 * shows your total earned; the legend lists each invitee. This is the "see how
 * much comes in from the people you brought" view.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Colors, Typography, Spacing, Radius } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { getReferralEarnings, ReferralEarnings } from '../services/referralEarningsService';

const ONE_GB = 1073741824;
const gb = (n: number) => (n / ONE_GB).toFixed(n >= ONE_GB ? 1 : 2);

// A warm palette for the slices — gold-family, so each invitee is distinct.
const SLICE = ['#D4AF37', '#F0D060', '#00E87A', '#45FFAA', '#C9982A', '#0077FF', '#B8860B', '#8BFFC9'];

const SIZE = 150;
const STROKE = 20;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

interface Props {
  deviceId: string;
  onInvite?: () => void;
  /** B-21: render as a plain View instead of its own GlassCard, so it can sit
   *  inside a shared "one referral section" wrapper without nested cards. */
  bare?: boolean;
  /** Hide the own "Invite friends" CTA — the wrapper renders one shared CTA. */
  hideInviteBtn?: boolean;
}

export function ReferralEarningsDonut({ deviceId, onInvite, bare, hideInviteBtn }: Props) {
  const { t } = useT();
  const [data, setData] = useState<ReferralEarnings | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    getReferralEarnings(deviceId).then(setData).catch(() => {});
  }, [deviceId]);

  if (!data) return null;

  const total = data.total_earned_bytes;
  const slices = data.invitees.filter((i) => i.earned_bytes > 0);

  // Build cumulative arc offsets for each slice.
  let acc = 0;
  const arcs = slices.map((inv, idx) => {
    const frac = total > 0 ? inv.earned_bytes / total : 0;
    const seg  = { color: SLICE[idx % SLICE.length], dash: frac * C, offset: -acc * C };
    acc += frac;
    return seg;
  });

  const Wrapper = bare ? View : GlassCard;
  const wrapperProps = bare ? { style: styles.bareCard } : { style: styles.card, glowColor: Colors.gold[400] };

  return (
    <Wrapper {...(wrapperProps as any)}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('earn.title')}</Text>
        <Text style={styles.pct}>{data.pct}%</Text>
      </View>
      <Text style={styles.sub}>{t('earn.sub').replace('{pct}', String(data.pct))}</Text>

      <View style={styles.body}>
        <View style={styles.donutWrap}>
          <Svg width={SIZE} height={SIZE}>
            <G rotation={-90} originX={SIZE / 2} originY={SIZE / 2}>
              {/* track */}
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} fill="none" />
              {arcs.map((a, i) => (
                <Circle
                  key={i}
                  cx={SIZE / 2} cy={SIZE / 2} r={R}
                  stroke={a.color} strokeWidth={STROKE} fill="none"
                  strokeDasharray={`${a.dash} ${C - a.dash}`}
                  strokeDashoffset={a.offset}
                  strokeLinecap="butt"
                />
              ))}
            </G>
          </Svg>
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.centerGb}>{gb(total)}</Text>
            <Text style={styles.centerUnit}>{t('earn.gbEarned')}</Text>
          </View>
        </View>

        <View style={styles.legend}>
          {slices.length === 0 ? (
            <Text style={styles.empty}>{t('earn.empty')}</Text>
          ) : slices.slice(0, 6).map((inv, idx) => (
            <View key={idx} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: SLICE[idx % SLICE.length] }]} />
              <Text style={styles.legendName} numberOfLines={1}>{inv.label}</Text>
              <Text style={styles.legendVal}>+{gb(inv.earned_bytes)} GB</Text>
            </View>
          ))}
        </View>
      </View>

      {!hideInviteBtn && (
        <TouchableOpacity style={styles.inviteBtn} onPress={onInvite} accessibilityLabel={t('earn.invite')}>
          <Text style={styles.inviteBtnText}>{t('earn.invite')}</Text>
        </TouchableOpacity>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card:       { padding: Spacing[4], marginBottom: Spacing[4] },
  bareCard:   { gap: 0 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:      { color: Colors.text.primary, fontSize: 15, fontFamily: Typography.family.heading },
  pct:        { color: Colors.gold[400], fontSize: 18, fontFamily: Typography.family.mono },
  sub:        { color: Colors.text.secondary, fontSize: 12, marginTop: 2, marginBottom: Spacing[3], lineHeight: 17 },
  body:       { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  donutWrap:  { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  center:     { position: 'absolute', alignItems: 'center' },
  centerGb:   { color: Colors.gold[300], fontSize: 26, fontFamily: Typography.family.mono },
  centerUnit: { color: Colors.text.secondary, fontSize: 10, marginTop: -2 },
  legend:     { flex: 1, gap: 5 },
  legendRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  legendName: { flex: 1, color: Colors.text.secondary, fontSize: 12 },
  legendVal:  { color: Colors.status.connected, fontSize: 12, fontFamily: Typography.family.mono },
  empty:      { color: Colors.text.muted, fontSize: 12, lineHeight: 17 },
  inviteBtn:  { marginTop: Spacing[3], alignItems: 'center', paddingVertical: 10, borderRadius: Radius.md, backgroundColor: Colors.gold[400] },
  inviteBtnText: { color: '#1A1405', fontSize: 14, fontFamily: Typography.family.heading },
});
