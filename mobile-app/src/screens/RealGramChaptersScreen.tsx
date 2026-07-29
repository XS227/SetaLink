/**
 * RealGramChaptersScreen — native "Journey" list, reached from the Profile
 * tab's "Continue your journey" banner (Khabat, 2026-07-27 build test:
 * Profile's old Chapters card dumped all ~50 chapter slugs as a flat plain-
 * text list — "alt for lang liste... bare tekst"; should "se like fin som
 * den gjør i shahnameh chapter", but as RealGram's own page, explicitly
 * NOT the embedded Shahnameh page itself — "ikke siden som er i shahnameh...
 * egen realgram side").
 *
 * Same reframing RealGramClanScreen already did for guild.html (2026-07-22):
 * a native screen that mirrors the source page's information (progress
 * card + ordered chapter cards with title/summary/status/reward, same
 * shape as season2/learn.html's `.journey-progress` + `.chapter-map`,
 * confirmed by reading that page live) rather than embedding it. Chapter
 * copy (title/summary/reward) comes from chapterCatalogService — the same
 * public `data/chapters.json` learn.js itself reads, static story content.
 * Per-user done/locked state comes from contract §9's chapters.list
 * (already fetched for Profile). Tapping a chapter still opens the real
 * Shahnameh WebView (ShahnamehEmbed, via onOpenChapter) — actually reading/
 * quizzing a chapter is real interactive gameplay content, not something
 * to reimplement natively; only this list/overview was the complaint.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from '../components/GlassCard';
import { EmberField } from '../components/EmberField';
import { useT } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { getProfileSummary } from '../services/realGramProfileService';
import { getChapterCatalog, ChapterCatalogEntry } from '../services/chapterCatalogService';
import { localizedField } from '../utils/localizedField';

type ChapterStatus = 'done' | 'active' | 'locked';

interface Row extends ChapterCatalogEntry {
  status: ChapterStatus;
}

interface Props {
  onBack: () => void;
  onOpenChapter: (slug: string) => void;
}

export function RealGramChaptersScreen({ onBack, onOpenChapter }: Props) {
  const insets   = useSafeAreaInsets();
  const { t, isRTL } = useT();
  const deviceId = useAuthStore((s) => s.user?.deviceId ?? '');

  const [rows, setRows]       = useState<Row[] | null>(null);
  const [completed, setCompleted] = useState(0);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [catalog, profile] = await Promise.all([
          getChapterCatalog(),
          deviceId ? getProfileSummary(deviceId).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (catalog.length === 0) {
          setError(t('chapters.loadError'));
          return;
        }
        const doneSlugs = new Set((profile?.chapters.list ?? []).filter((c) => c.done).map((c) => c.slug));
        let unlocked = true;
        const merged: Row[] = catalog.map((c) => {
          let status: ChapterStatus;
          if (doneSlugs.has(c.slug))      { status = 'done'; }
          else if (unlocked)              { status = 'active'; unlocked = false; }
          else                             { status = 'locked'; }
          return { ...c, status };
        });
        setRows(merged);
        setCompleted(doneSlugs.size);
      } catch {
        if (!cancelled) setError(t('chapters.loadError'));
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId, t]);

  const pct = rows && rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;

  const header = useMemo(() => (
    <View>
      <Text style={styles.pageTitle}>{t('chapters.journeyTitle')}</Text>
      <Text style={styles.pageSub}>{t('chapters.journeySubtitle')}</Text>
      <GlassCard style={styles.progressCard} glowColor={Colors.gold[400]}>
        <View style={styles.progressRow}>
          <View>
            <Text style={styles.progressLabel}>{t('rghome.chronicleProgress')}</Text>
            <Text style={styles.progressValue}>
              {t('chapters.progressComplete').replace('{completed}', String(completed)).replace('{total}', String(rows?.length ?? 0))}
            </Text>
          </View>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
        </View>
      </GlassCard>
    </View>
  ), [completed, rows, pct, t]);

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
      <TouchableOpacity onPress={onBack} style={styles.floatingBack} hitSlop={12} activeOpacity={0.75}>
        <Text style={styles.backIcon}>{isRTL ? '›' : '‹'}</Text>
      </TouchableOpacity>
      {!rows ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.gold[400]} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.slug}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          renderItem={({ item }) => <ChapterCard row={item} onOpenChapter={onOpenChapter} />}
        />
      )}
    </View>
  );
}

function ChapterCard({ row, onOpenChapter }: { row: Row; onOpenChapter: (slug: string) => void }) {
  const { t, lang } = useT();
  const title   = localizedField(row.title, row.title_fa, row.title_ru, lang);
  const summary = localizedField(row.summary, row.summary_fa, row.summary_ru, lang);
  const disabled = row.status === 'locked';
  const chipStyle  = row.status === 'done' ? styles.chipDone : row.status === 'active' ? styles.chipActive : styles.chipLocked;
  const chipLabel  = row.status === 'done' ? t('chapters.statusDone') : row.status === 'active' ? t('chapters.statusActive') : t('chapters.statusLocked');
  const nodeStyle  = row.status === 'done' ? styles.nodeDone : row.status === 'active' ? styles.nodeActive : styles.nodeLocked;

  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => onOpenChapter(row.slug)}
      activeOpacity={0.85}
      accessibilityLabel={`${title} — ${chipLabel}`}
    >
      <GlassCard style={[styles.chapterCard, disabled && styles.chapterCardLocked]}>
        <View style={styles.chapterRow}>
          <View style={[styles.node, nodeStyle]}>
            <Text style={styles.nodeText}>{row.status === 'done' ? '✓' : row.order}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.chapterTitle, disabled && styles.textMuted]} numberOfLines={1}>{title}</Text>
            {!!summary && (
              <Text style={styles.chapterSummary} numberOfLines={2}>{summary}</Text>
            )}
            <View style={styles.metaRow}>
              <View style={[styles.chip, chipStyle]}>
                <Text style={styles.chipText}>{chipLabel}</Text>
              </View>
              {(row.reward_xp > 0 || row.reward_real > 0) && (
                <Text style={styles.rewardText} numberOfLines={1}>
                  ⭐ {t('chapters.rewardXp').replace('{xp}', String(row.reward_xp))}
                  {row.reward_real > 0 ? ` · 💎 ${t('chapters.rewardReal').replace('{real}', String(row.reward_real))}` : ''}
                </Text>
              )}
            </View>
          </View>
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: Colors.bg.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[4] },
  content:  { paddingHorizontal: Spacing[4], paddingTop: Spacing[12], gap: Spacing[3] },

  floatingBack: {
    position: 'absolute', top: Spacing[3], left: Spacing[4], zIndex: 10,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  backIcon: { fontSize: 22, color: Colors.text.primary, marginTop: -2 },

  pageTitle: { fontSize: 22, fontFamily: Typography.family.heading, color: Colors.text.primary },
  pageSub:   { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, marginBottom: Spacing[4] },

  progressCard: { gap: Spacing[3], marginBottom: Spacing[4] },
  progressRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  progressValue: { fontSize: 14, fontWeight: '700', color: Colors.text.primary, marginTop: 4, fontFamily: Typography.family.body },
  progressPct:   { fontSize: 20, fontFamily: Typography.family.heading, color: Colors.gold[400] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.bg.elevated, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3, backgroundColor: Colors.gold[400] },

  chapterCard:       { gap: 0 },
  chapterCardLocked: { opacity: 0.55 },
  chapterRow:        { flexDirection: 'row', gap: Spacing[3] },

  node:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  nodeDone:   { backgroundColor: Colors.gold[400], borderColor: Colors.gold[400] },
  nodeActive: { borderColor: Colors.gold[400] },
  nodeLocked: {},
  nodeText:   { fontSize: 13, fontWeight: '700', color: Colors.text.primary },

  chapterTitle:   { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary },
  chapterSummary: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 4, lineHeight: 17 },
  textMuted:      { color: Colors.text.muted },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[2], flexWrap: 'wrap' },
  chip:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: Colors.bg.elevated },
  chipDone:    { backgroundColor: 'rgba(93, 214, 150, 0.16)' },
  chipActive:  { backgroundColor: 'rgba(244, 197, 107, 0.18)' },
  chipLocked:  {},
  chipText:    { fontSize: 10, fontFamily: Typography.family.label, color: Colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  rewardText:  { fontSize: 11, color: Colors.gold[400], fontFamily: Typography.family.mono },

  errorText: { fontSize: 13, color: '#FF6B6B', textAlign: 'center', fontFamily: Typography.family.body, paddingHorizontal: Spacing[6] },
  backBtnFallback: { backgroundColor: Colors.gold[400], borderRadius: Radius.xl, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6] },
  backBtnFallbackText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
