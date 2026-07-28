/**
 * RealGramSocialScreen — native Social page (`docs/realgram/TASK_SPLIT.md`
 * A→B(125) roadmap: Social). Tournament + leaderboard + activity feed, all
 * from confirmed-public `/api/season2/social/*` and `/events` endpoints —
 * genuinely global data, not gated behind the telegram_id identity bridge
 * A→B(125) is still blocked on for everything else on this roadmap.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
import {
  getLeaderboard, getActivityFeed, getTournament,
  LeaderboardRow, ActivityEvent, TournamentInfo,
} from '../services/socialService';

interface Props {
  onBack: () => void;
}

// Relative "just now / Xm ago" formatting (timeAgo below) deliberately
// stays English everywhere in the app — see RealGramProfileScreen.tsx's
// identical copy, which notes this mirrors a shared, tested utility
// (utils/formatters.ts's formatRelativeTime) that isn't i18n-aware; making
// ONE local copy translatable without fixing the shared one would just be
// inconsistent. formatCountdown is local to this screen only, so it's
// translated below (t passed in, since this runs outside a component).
function formatCountdown(seconds: number, t: (key: string) => string): string {
  if (seconds <= 0) return t('social.countdownEnded');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return t('social.countdownDaysHours').replace('{d}', String(d)).replace('{h}', String(h));
  if (h > 0) return t('social.countdownHoursMinutes').replace('{h}', String(h)).replace('{m}', String(m));
  return t('social.countdownMinutes').replace('{m}', String(m));
}

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function RealGramSocialScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [activity, setActivity]       = useState<ActivityEvent[]>([]);
  const [tournament, setTournament]   = useState<TournamentInfo | null>(null);
  const [error, setError]             = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLeaderboard(), getActivityFeed(), getTournament()])
      .then(([lb, act, tour]) => {
        if (cancelled) return;
        if (lb.length === 0) { setError(t('social.loadError')); return; }
        setLeaderboard(lb);
        setActivity(act);
        setTournament(tour);
      })
      .catch(() => { if (!cancelled) setError(t('social.loadError')); });
    return () => { cancelled = true; };
  }, [t]);

  if (error) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={onBack} style={styles.backBtnFallback} activeOpacity={0.8}>
          <Text style={styles.backBtnFallbackText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
      {!leaderboard ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={leaderboard}
          keyExtractor={(r, i) => r.telegram_id || String(i)}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <Text style={styles.pageTitle}>{t('social.title')}</Text>
              <Text style={styles.pageSub}>{t('social.subtitle')}</Text>
              {!!tournament && (
                <GlassCard style={styles.tournamentCard} glowColor={Colors.gold[400]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardLabel}>{t('social.tournament')}</Text>
                    <Text style={styles.countdown}>{formatCountdown(tournament.ends_in_seconds, t)}</Text>
                  </View>
                  {tournament.leaderboard.slice(0, 3).map((row, i) => (
                    <View key={i} style={styles.tourRow}>
                      <Text style={styles.tourRank}>#{i + 1}</Text>
                      <Text style={styles.tourName} numberOfLines={1}>{row.first_name}</Text>
                      <Text style={styles.tourBalance}>{row.real_balance.toLocaleString()} REAL</Text>
                    </View>
                  ))}
                </GlassCard>
              )}
              <Text style={styles.sectionTitle}>{t('social.leaderboard')}</Text>
            </View>
          }
          renderItem={({ item, index }) => <LeaderboardCard row={item} rank={index + 1} />}
          ListFooterComponent={
            activity.length > 0 ? (
              <View>
                <Text style={styles.sectionTitle}>{t('social.activity')}</Text>
                <GlassCard style={styles.activityCard}>
                  {activity.slice(0, 12).map((e, i) => (
                    <View key={i} style={styles.activityRow}>
                      <Text style={styles.activityIcon}>{e.icon || '·'}</Text>
                      <Text style={styles.activityText} numberOfLines={1}>
                        <Text style={styles.activityUser}>{e.user}</Text> {e.detail}
                      </Text>
                      <Text style={styles.activityTime}>{timeAgo(e.ts)}</Text>
                    </View>
                  ))}
                </GlassCard>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function LeaderboardCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const { t } = useT();
  return (
    <GlassCard style={[styles.rowCard, row.is_me && styles.rowCardMe]}>
      <View style={styles.rowContent}>
        <Text style={styles.rank}>#{rank}</Text>
        {row.profile_pic ? (
          <Image source={{ uri: row.profile_pic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarFallbackText}>{(row.first_name || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>{row.first_name || t('social.defaultWarriorName')}</Text>
          <Text style={styles.rowMeta}>{t('social.levelXp').replace('{level}', String(row.level)).replace('{xp}', row.xp.toLocaleString())}</Text>
        </View>
        <Text style={styles.rowBalance}>{row.real_balance.toLocaleString()}</Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[2] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[3] },

  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },

  tournamentCard: { gap: Spacing[2], marginBottom: Spacing[4] },
  countdown: { fontSize: 12, fontFamily: Typography.family.mono, color: Colors.gold[400] },
  tourRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[1] },
  tourRank:  { width: 24, fontSize: 12, fontFamily: Typography.family.mono, color: Colors.text.muted },
  tourName:  { flex: 1, fontSize: 13, color: Colors.text.primary, fontFamily: Typography.family.body },
  tourBalance: { fontSize: 12, color: Colors.gold[400], fontFamily: Typography.family.mono },

  sectionTitle: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[3], marginBottom: Spacing[2] },

  rowCard:   { padding: Spacing[3] },
  rowCardMe: { borderColor: Colors.gold[400] },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  rank:      { width: 28, fontSize: 13, fontFamily: Typography.family.mono, color: Colors.text.muted },
  avatar:    { width: 32, height: 32, borderRadius: 16 },
  avatarFallback: { backgroundColor: Colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.text.primary },
  rowName:   { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.primary },
  rowMeta:   { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2 },
  rowBalance:{ fontSize: 13, fontFamily: Typography.family.mono, color: Colors.gold[400] },

  activityCard: { gap: Spacing[2] },
  activityRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  activityIcon: { fontSize: 14, width: 20, textAlign: 'center' },
  activityText: { flex: 1, fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body },
  activityUser: { color: Colors.text.primary, fontFamily: Typography.family.heading },
  activityTime: { fontSize: 10, color: Colors.text.muted, fontFamily: Typography.family.mono },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
