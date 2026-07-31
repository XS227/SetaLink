/**
 * RealGramEarnScreen — native Earn page (`docs/realgram/TASK_SPLIT.md`
 * A→B(125) roadmap: Earn). Daily check-in, social/partner tasks, referral
 * milestones — all real, all wired to the actual `/api/season2/earn/*` and
 * `/social/claim-milestone` endpoints (B->A(132)'s telegram_id bridge).
 *
 * Progress state reuses contract §9 (realGramProfileService.ts) — the
 * Profile screen already fetches completed_tasks/milestones_claimed/
 * verified_referral_count/checkin_streak, no second call needed. Task/
 * milestone/reward definitions are read straight off season2/earn.js's own
 * hardcoded lists (SOCIAL_TASKS/PARTNERS/MILESTONES/CHECKIN_REWARDS) — the
 * same source of truth `/api/season2/earn/*` expects, unlike Heroes.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { getSsoToken } from '../services/ssoService';
import { getProfileSummary } from '../services/realGramProfileService';
import {
  SOCIAL_TASKS, PARTNER_TASKS, MILESTONES, CHECKIN_REWARDS,
  claimCheckin, completeTask, claimMilestone, EarnTask,
} from '../services/earnService';

interface Props {
  onBack: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Khabat, 2026-07-31: "daily luck trenger ikke å stå på earn når vi har
// det på toppen av appen" — HomeScreen.tsx's own MiniLuckWheel header icon
// (navigates straight to 'dailyluck') is the real, already-shipped entry
// point; this screen's own banner (added 2026-07-30) was a second,
// redundant one. Removed here rather than duplicated in two places.
export function RealGramEarnScreen({ onBack }: Props) {
  const insets   = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');
  const showToast = useToastStore((s) => s.show);

  const [telegramId, setTelegramId] = useState('');
  const [streak, setStreak]         = useState(0);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  const [claimedMilestones, setClaimedMilestones] = useState<Set<number>>(new Set());
  const [referralCount, setReferralCount] = useState(0);
  const [busyKey, setBusyKey]       = useState<string | null>(null);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    try {
      const [sso, profile] = await Promise.all([
        deviceId ? getSsoToken(deviceId, true) : Promise.resolve(null),
        deviceId ? getProfileSummary(deviceId) : Promise.reject(new Error('no device id')),
      ]);
      setTelegramId(sso?.telegram_id ?? '');
      setStreak(profile.streaks.daily_streak ?? 0);
      setCheckedInToday(profile.streaks.last_checkin_date === todayStr());
      setCompletedTasks(new Set(profile.achievements.completed_tasks));
      setClaimedMilestones(new Set(profile.achievements.milestones_claimed));
      setReferralCount(profile.achievements.verified_referral_count ?? 0);
    } catch {
      setError(t('earn.loadError'));
    } finally {
      setLoading(false);
    }
  }, [deviceId, t]);

  useEffect(() => { load(); }, [load]);

  const requireTelegramId = useCallback((): boolean => {
    if (telegramId) return true;
    showToast(t('earn.identifyError'), 'error');
    return false;
  }, [telegramId, showToast, t]);

  const handleCheckin = useCallback(async () => {
    if (!requireTelegramId() || checkedInToday) return;
    setBusyKey('checkin');
    const result = await claimCheckin(telegramId);
    setBusyKey(null);
    if (result.ok) {
      setStreak(result.streak);
      setCheckedInToday(true);
      showToast(t('earn.claimedReward').replace('{amount}', String(result.reward_real)), 'success');
    } else if (result.error === 'already_claimed') {
      setCheckedInToday(true);
      showToast(t('earn.alreadyClaimedToday'), 'info');
    } else {
      showToast(t('earn.claimGeneric'), 'error');
    }
  }, [telegramId, checkedInToday, requireTelegramId, showToast, t]);

  const handleTask = useCallback(async (task: EarnTask) => {
    Linking.openURL(task.url).catch(() => {});
    if (!requireTelegramId()) return;
    setBusyKey(task.id);
    const result = await completeTask(telegramId, task.id);
    setBusyKey(null);
    if (result.ok || result.error === 'already_completed') {
      setCompletedTasks((prev) => new Set(prev).add(task.id));
      showToast(result.ok ? t('earn.claimedReward').replace('{amount}', String(task.reward_real)) : t('earn.alreadyClaimedCheckWallet'), 'success');
    } else {
      showToast(t('earn.verifyGeneric'), 'error');
    }
  }, [telegramId, requireTelegramId, showToast, t]);

  const handleMilestone = useCallback(async (m: typeof MILESTONES[number]) => {
    if (!requireTelegramId()) return;
    setBusyKey(`ms-${m.threshold}`);
    const result = await claimMilestone(telegramId, m.threshold);
    setBusyKey(null);
    if (result.ok) {
      setClaimedMilestones((prev) => new Set(prev).add(m.threshold));
      showToast(t('earn.claimedReward').replace('{amount}', String(m.real)), 'success');
    } else if (result.error === 'already_claimed') {
      setClaimedMilestones((prev) => new Set(prev).add(m.threshold));
      showToast(t('earn.alreadyClaimed'), 'info');
    } else if (result.error === 'not_reached') {
      showToast(t('earn.notReachedYet'), 'info');
    } else {
      showToast(t('earn.claimGeneric'), 'error');
    }
  }, [telegramId, requireTelegramId, showToast, t]);

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

  const nextCheckinIdx = Math.min(checkedInToday ? streak : streak + 1, 7) - 1;
  const nextReward = CHECKIN_REWARDS[Math.max(0, nextCheckinIdx)] ?? CHECKIN_REWARDS[6];

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
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>{t('earn.title')}</Text>
          <Text style={styles.pageSub}>{t('earn.subtitle')}</Text>

          {/* Check-in */}
          <GlassCard style={styles.card} glowColor={Colors.gold[400]}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardLabel}>{t('earn.dailyCheckin')}</Text>
              <Text style={styles.streakText}>{t('earn.dayStreak').replace('{n}', String(streak))}</Text>
            </View>
            <View style={styles.checkinStrip}>
              {CHECKIN_REWARDS.map((r, i) => {
                const dayNum = i + 1;
                const done = streak >= dayNum;
                return (
                  <View key={i} style={[styles.checkinDay, done && styles.checkinDayDone]}>
                    <Text style={styles.checkinDayIcon}>{done ? '✓' : dayNum}</Text>
                    <Text style={styles.checkinDayReward}>{r.real}</Text>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity
              onPress={handleCheckin}
              disabled={checkedInToday || busyKey === 'checkin'}
              style={[styles.claimBtn, checkedInToday && styles.claimBtnDisabled]}
              activeOpacity={0.85}
            >
              {busyKey === 'checkin'
                ? <ActivityIndicator size="small" color={Colors.bg.void} />
                : <Text style={styles.claimBtnText}>
                    {checkedInToday ? t('earn.claimedToday') : t('earn.claimAmount').replace('{amount}', String(nextReward.real))}
                  </Text>}
            </TouchableOpacity>
          </GlassCard>

          {/* Social tasks */}
          <Text style={styles.sectionTitle}>{t('earn.socialTasks')}</Text>
          {SOCIAL_TASKS.map((task) => (
            <TaskRow key={task.id} task={task} done={completedTasks.has(task.id)} busy={busyKey === task.id} onPress={() => handleTask(task)} />
          ))}

          {/* Partners */}
          <Text style={styles.sectionTitle}>{t('earn.partners')}</Text>
          {PARTNER_TASKS.map((task) => (
            <TaskRow key={task.id} task={task} done={completedTasks.has(task.id)} busy={busyKey === task.id} onPress={() => handleTask(task)} />
          ))}

          {/* Milestones */}
          <Text style={styles.sectionTitle}>{t('earn.referralMilestones')}</Text>
          <Text style={styles.milestoneSub}>{t('earn.verifiedInvitesSoFar').replace('{count}', String(referralCount))}</Text>
          {MILESTONES.map((m) => {
            const claimed = claimedMilestones.has(m.threshold);
            const reached = referralCount >= m.threshold;
            return (
              <GlassCard key={m.threshold} style={styles.taskCard}>
                <View style={styles.taskRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskLabel}>{m.label}</Text>
                    <Text style={styles.taskReward}>
                      +{m.real.toLocaleString()} REAL{m.gems ? ` +${m.gems} 💎` : ''}{m.farr ? ` +${m.farr} ✨` : ''}
                    </Text>
                  </View>
                  {claimed ? (
                    <Text style={styles.doneCheck}>✓</Text>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleMilestone(m)}
                      disabled={!reached || busyKey === `ms-${m.threshold}`}
                      style={[styles.taskBtn, !reached && styles.taskBtnDisabled]}
                      activeOpacity={0.85}
                    >
                      {busyKey === `ms-${m.threshold}`
                        ? <ActivityIndicator size="small" color={Colors.bg.void} />
                        : <Text style={styles.taskBtnText}>{reached ? t('earn.claim') : `${referralCount}/${m.threshold}`}</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              </GlassCard>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function TaskRow({
  task, done, busy, onPress,
}: { task: EarnTask; done: boolean; busy: boolean; onPress: () => void }) {
  const { t } = useT();
  return (
    <GlassCard style={styles.taskCard}>
      <View style={styles.taskRow}>
        <Text style={styles.taskIcon}>{task.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.taskLabel} numberOfLines={1}>{task.label}</Text>
          <Text style={styles.taskReward}>+{task.reward_real.toLocaleString()} REAL{task.reward_gems ? ` +${task.reward_gems} 💎` : ''}</Text>
        </View>
        {done ? (
          <Text style={styles.doneCheck}>✓</Text>
        ) : (
          <TouchableOpacity onPress={onPress} disabled={busy} style={styles.taskBtn} activeOpacity={0.85}>
            {busy
              ? <ActivityIndicator size="small" color={Colors.bg.void} />
              : <Text style={styles.taskBtnText}>{t('earn.open')}</Text>}
          </TouchableOpacity>
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },

  floatingBack: {
    position: 'absolute', left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[2] },

  card: { gap: Spacing[2] },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  streakText: { fontSize: 12, fontFamily: Typography.family.mono, color: Colors.gold[400] },

  checkinStrip: { flexDirection: 'row', gap: Spacing[1], marginTop: Spacing[1] },
  checkinDay:   { flex: 1, alignItems: 'center', backgroundColor: Colors.bg.elevated, borderRadius: Radius.md, paddingVertical: Spacing[2] },
  checkinDayDone: { backgroundColor: 'rgba(244, 197, 107, 0.18)' },
  checkinDayIcon: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.text.primary },
  checkinDayReward: { fontSize: 9, color: Colors.text.muted, fontFamily: Typography.family.mono, marginTop: 2 },

  claimBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[1] },
  claimBtnDisabled: { opacity: 0.5 },
  claimBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  sectionTitle: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary, marginTop: Spacing[3], marginBottom: Spacing[1] },
  milestoneSub: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginBottom: Spacing[1] },

  taskCard: { gap: 0 },
  taskRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  taskIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  taskLabel: { fontSize: 14, fontFamily: Typography.family.body, color: Colors.text.primary },
  taskReward: { fontSize: 11, color: Colors.gold[400], fontFamily: Typography.family.mono, marginTop: 2 },
  taskBtn:  { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[2], paddingHorizontal: Spacing[3] },
  taskBtnDisabled: { backgroundColor: Colors.bg.elevated },
  taskBtnText: { fontSize: 12, fontFamily: Typography.family.heading, color: Colors.bg.void },
  doneCheck: { fontSize: 16, color: Colors.gold[400] },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
