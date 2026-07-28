/**
 * NextInviteGoalCard — the escalating "invite quest" teaser.
 *
 * Server-side, `qe_milestones()` (lib/quota_economy.php) already has a
 * ladder of invite-count goals (3 -> 5 -> 8 -> 13 -> 21 -> 34 -> 55, each
 * with its own one-time GB reward + badge) that already grants
 * automatically via `qe_evaluate_milestones()` — it just never had a
 * client-side "here's your next goal" card. This is that card: reads
 * `MilestoneProgress` straight off `authStore` (already fetched at
 * bootstrap/sync, no new network call), and once one goal is reached the
 * next one is already sitting there waiting in the same data, so a fresh
 * goal appears the moment the previous one is claimed server-side.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { MilestoneProgress } from '../services/entitlementService';

const ONE_GB = 1073741824;
const gb = (n: number) => (n / ONE_GB).toFixed(n >= ONE_GB ? 0 : 2);

interface Props {
  milestones: MilestoneProgress | null;
  bare?: boolean;
}

export function NextInviteGoalCard({ milestones, bare }: Props) {
  const { t } = useT();
  if (!milestones) return null;

  const Wrapper = bare ? View : GlassCard;
  const wrapperProps = bare ? { style: styles.bareCard } : { style: styles.card, glowColor: Colors.gold[400] };

  if (milestones.next_milestone === null) {
    // Every rung of the ladder already claimed — top of the ladder.
    return (
      <Wrapper {...(wrapperProps as any)}>
        <Text style={styles.title}>{t('invGoal.title')}</Text>
        <Text style={styles.maxed}>{t('invGoal.allDone')}</Text>
      </Wrapper>
    );
  }

  const pct = Math.max(0, Math.min(1, milestones.progress));

  return (
    <Wrapper {...(wrapperProps as any)}>
      <Text style={styles.title}>{t('invGoal.title')}</Text>
      <Text style={styles.goal}>
        {t('invGoal.next')
          .replace('{n}', String(milestones.next_milestone))}
      </Text>
      <Text style={styles.reward}>
        {t('invGoal.reward').replace('{gb}', gb(milestones.next_reward_bytes))}
      </Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        {t('invGoal.progress')
          .replace('{have}', String(milestones.invite_count))
          .replace('{need}', String(milestones.next_milestone))}
      </Text>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card:           { marginBottom: Spacing[4], padding: Spacing[4], gap: Spacing[2] },
  bareCard:       { gap: Spacing[2] },
  title:          { fontSize: Typography.size.xs, color: Colors.text.muted,
                    fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 1 },
  goal:           { fontSize: Typography.size.lg, color: Colors.text.primary, fontFamily: Typography.family.heading },
  reward:         { fontSize: Typography.size.sm, color: Colors.gold[400], fontFamily: Typography.family.mono },
  maxed:          { fontSize: Typography.size.sm, color: Colors.text.secondary, lineHeight: 18 },
  progressTrack:  { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden', marginTop: Spacing[1] },
  progressFill:   { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },
  progressLabel:  { fontSize: Typography.size.xs, color: Colors.text.secondary },
});
