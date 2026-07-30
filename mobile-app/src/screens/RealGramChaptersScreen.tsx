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
 * (already fetched for Profile). Tapping a chapter opens the real native
 * reading/quiz screen (RealGramChapterDetailScreen, via onOpenChapter).
 *
 * 2026-07-30 (Khabat: with ~50 chapters in ascending order, opening this
 * list always dropped you at chapter 1 — "blir jeg ikke sendt durekte der
 * som siste åpnet kapitel er"): auto-scrolls to the active chapter on open
 * instead of always starting at the top. Kept the chronological (oldest-
 * first) order rather than flipping it — chapters build on each other
 * story-wise, so reversing the list would make "chapter 1" the confusing
 * one to find instead; auto-scroll solves the actual complaint (getting
 * buried at the bottom of a long list) without losing that structure.
 * Also gave the completed-chapter card its own "certificate" treatment
 * (gold ribbon + earned-reward pill) per "kapitel oversikten skal være
 * din sertifikat når du har fullført kapitlet" — a finished chapter should
 * visibly read as an award, not just a plain done/locked/active chip.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
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
  const isFocused = useIsFocused();

  const [rows, setRows]       = useState<Row[] | null>(null);
  const [completed, setCompleted] = useState(0);
  const [error, setError]     = useState('');
  const listRef = useRef<FlatList<Row>>(null);

  // Khabat, 2026-07-30: finishing a chapter's quiz/battle and going back here
  // didn't show the next chapter as unlocked — "ble jeg ikke sendt til neste
  // kapitel når jeg trykker på knappen" (tapping it did nothing, because it
  // still read as locked). Root cause: React Navigation's native stack keeps
  // this screen mounted underneath ChapterDetail rather than remounting it,
  // so the plain mount-only effect this used to be never re-ran on the way
  // back — `rows` stayed exactly as stale as it was before the chapter was
  // completed. `isFocused` in the deps re-fetches every time this screen
  // comes back into view, same pattern RealGramProfileScreen already uses.
  useEffect(() => {
    if (!isFocused) return;
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
  }, [deviceId, t, isFocused]);

  // Land the list on the active chapter instead of always chapter 1 — see
  // this file's own header for why. A short delay lets FlatList finish its
  // first layout pass so scrollToIndex has real measurements to work with;
  // onScrollToIndexFailed below covers the case where it still races ahead
  // of that (variable card heights mean no getItemLayout to short-circuit it).
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const idx = rows.findIndex((r) => r.status === 'active');
    if (idx <= 0) return; // already at/near the top, nothing to do
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.25 });
    }, 300);
    return () => clearTimeout(timer);
  }, [rows]);

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
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.slug}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing[6] }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          renderItem={({ item }) => <ChapterCard row={item} onOpenChapter={onOpenChapter} />}
          onScrollToIndexFailed={(info) => {
            // Cards have variable height (optional summary/reward lines), so
            // there's no getItemLayout to make scrollToIndex instant — fall
            // back to an approximate offset, then retry the precise index
            // once that scroll has given FlatList more items to measure.
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.25 }), 150);
          }}
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
  const done     = row.status === 'done';
  const chipStyle  = done ? styles.chipDone : row.status === 'active' ? styles.chipActive : styles.chipLocked;
  const chipLabel  = done ? t('chapters.statusDone') : row.status === 'active' ? t('chapters.statusActive') : t('chapters.statusLocked');
  const nodeStyle  = done ? styles.nodeDone : row.status === 'active' ? styles.nodeActive : styles.nodeLocked;
  const hasReward  = row.reward_xp > 0 || row.reward_real > 0;
  const rewardLine = `⭐ ${t('chapters.rewardXp').replace('{xp}', String(row.reward_xp))}`
    + (row.reward_real > 0 ? ` · 💎 ${t('chapters.rewardReal').replace('{real}', String(row.reward_real))}` : '');

  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => onOpenChapter(row.slug)}
      activeOpacity={0.85}
      accessibilityLabel={`${title} — ${chipLabel}`}
    >
      <GlassCard
        style={[styles.chapterCard, disabled && styles.chapterCardLocked, done && styles.chapterCardDone]}
        glowColor={done ? Colors.gold[400] : undefined}
      >
        {/* Khabat, 2026-07-30: "kapitel oversikten skal være din sertifikat
            når du har fullført kapitlet" — a done chapter gets a wax-seal-
            style ribbon + its own bold earned-reward pill instead of the
            plain small reward line active/locked chapters show. */}
        {done && (
          <View style={styles.certificateRibbon}>
            <Text style={styles.certificateRibbonText}>🏅</Text>
          </View>
        )}
        <View style={styles.chapterRow}>
          <View style={[styles.node, nodeStyle]}>
            <Text style={styles.nodeText}>{done ? '✓' : row.order}</Text>
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
              {!done && hasReward && (
                <Text style={styles.rewardText} numberOfLines={1}>{rewardLine}</Text>
              )}
            </View>
            {done && hasReward && (
              <View style={styles.earnedPill}>
                <Text style={styles.earnedPillText} numberOfLines={1}>🏆 {rewardLine}</Text>
              </View>
            )}
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
  chapterCardDone:   { borderColor: 'rgba(212,175,55,0.45)' },
  chapterRow:        { flexDirection: 'row', gap: Spacing[3] },

  certificateRibbon: {
    position: 'absolute', top: -8, right: -6, zIndex: 5,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.gold[400], alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.bg.void,
  },
  certificateRibbonText: { fontSize: 14 },

  earnedPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    marginTop: Spacing[2], paddingHorizontal: Spacing[3], paddingVertical: 4,
    borderRadius: Radius.full, backgroundColor: 'rgba(212,175,55,0.16)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)',
  },
  earnedPillText: { fontSize: 11, fontFamily: Typography.family.label, color: Colors.gold[400], letterSpacing: 0.2 },

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
