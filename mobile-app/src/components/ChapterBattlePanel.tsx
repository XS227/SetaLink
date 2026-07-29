/**
 * ChapterBattlePanel — the final "boss encounter" requirements gate +
 * chapter-completion trigger (Khabat, 2026-07-29: quiz "og videre prosess
 * på kapitelen skjer i realgram"). Mirrors chapter.js's own `paintBattle()`
 * exactly: desk + read-all-scenes + the chapter's own `battle.requirements`
 * (from chapterLoreService.ts) + one pill per published quiz tier, all
 * auto-injected the same way the web client does it — see that function
 * (~L359-413) for the reference this was built against.
 *
 * This panel only renders the requirements checklist and fires
 * `onComplete` once every requirement is met — the actual completion flow
 * (push `done: true`, reconcile the reward hero card via
 * heroCatalogService.ts's `reconcileChapterRewards()`, show the reward
 * popup) lives in RealGramChapterDetailScreen.tsx, which also owns the
 * `completing` prop this panel just reflects in its CTA state.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { localizedField } from '../utils/localizedField';
import { ChapterBattle, ChapterScene } from '../services/chapterLoreService';
import { ChapterProgressSnapshot } from '../services/chapterProgressStore';
import { OwnedHero } from '../services/heroCatalogService';

interface ReqRow {
  id: string;
  met: boolean;
  label: string;
  hint: string;
}

const QUIZ_TIER_REQ_LABEL_KEY = {
  easy: 'chapterdetail.reqQuizTierEasy',
  medium: 'chapterdetail.reqQuizTierMedium',
  hard: 'chapterdetail.reqQuizTierHard',
} as const;

interface Props {
  battle: ChapterBattle;
  progress: ChapterProgressSnapshot;
  scenes: ChapterScene[];
  hasDesk: boolean;
  quizTiersPublished: { easy: boolean; medium: boolean; hard: boolean };
  ownedHeroes: Map<string, OwnedHero>;
  farr: number;
  unlockedCharacterSlugs: Set<string>;
  completing: boolean;
  onComplete: () => void;
}

export function ChapterBattlePanel({
  battle, progress, scenes, hasDesk, quizTiersPublished, ownedHeroes, farr,
  unlockedCharacterSlugs, completing, onComplete,
}: Props) {
  const { t, lang } = useT();

  const rows: ReqRow[] = [];

  if (hasDesk) {
    rows.push({ id: '__desk', met: progress.desk_read, label: t('chapterdetail.reqDesk'), hint: t('chapterdetail.reqDeskHint') });
  }
  if (scenes.length > 0) {
    const readCount = scenes.filter((s) => progress.scenes.includes(s.id)).length;
    rows.push({
      id: '__scenes_all', met: readCount >= scenes.length,
      label: t('chapterdetail.reqScenesAll'), hint: t('chapterdetail.reqScenesAllHint'),
    });
  }

  for (const req of battle.requirements) {
    let met = false;
    switch (req.kind) {
      case 'level': {
        const owned = req.heroId ? ownedHeroes.get(req.heroId) : undefined;
        met = !!owned && owned.level >= (req.level ?? 1);
        break;
      }
      case 'character':
        met = unlockedCharacterSlugs.has(req.target);
        break;
      case 'item':
        // Only known live content: `grant_on: "quiz"` items are awarded
        // the moment the easy tier is done+passed — same trigger as the
        // sibling "quiz" requirement below, not separate item-tracking
        // infra this app doesn't have. No other grant_on value exists in
        // the live content as of this build.
        met = req.grantOn === 'quiz' && progress.quiz.easy.done && progress.quiz.easy.passed;
        break;
      case 'quiz':
        // Matches chapter.js's own reqMet: kind:"quiz" always checks the
        // easy tier regardless of `target` (a chapter slug, not a tier).
        met = progress.quiz.easy.done && progress.quiz.easy.passed;
        break;
      case 'farr':
        met = farr >= (req.level ?? 1);
        break;
      case 'owned_heroes':
        met = ownedHeroes.size >= (req.level ?? 1);
        break;
    }
    rows.push({
      id: req.id, met,
      label: localizedField(req.label, req.label_fa, req.label_ru, lang),
      hint: localizedField(req.hint, req.hint_fa, req.hint_ru, lang),
    });
  }

  (['easy', 'medium', 'hard'] as const).forEach((tier) => {
    if (!quizTiersPublished[tier]) return;
    const tp = progress.quiz[tier];
    rows.push({
      id: `__quiz_${tier}`, met: tp.done && tp.passed,
      label: t(QUIZ_TIER_REQ_LABEL_KEY[tier]),
      hint: '',
    });
  });

  const metCount = rows.filter((r) => r.met).length;
  const allMet = rows.length > 0 && metCount === rows.length;
  const bossName = localizedField(battle.bossName, battle.bossName_fa, undefined, lang);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.headRow}>
        {!!battle.bossImage && <Image source={{ uri: battle.bossImage }} style={styles.bossImage} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.bossName}>{bossName}</Text>
          <Text style={styles.intro}>{localizedField(battle.intro, battle.intro_fa, undefined, lang)}</Text>
        </View>
      </View>

      <View style={styles.reqList}>
        {rows.map((r) => (
          <View key={r.id} style={styles.reqRow}>
            <Text style={[styles.reqMark, r.met && styles.reqMarkMet]}>{r.met ? '✓' : '·'}</Text>
            <Text style={[styles.reqLabel, r.met && styles.reqLabelMet]}>{r.label}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.cta, (!allMet || completing) && styles.ctaDisabled]}
        activeOpacity={0.85}
        disabled={!allMet || completing || progress.done}
        onPress={onComplete}
      >
        {completing
          ? <ActivityIndicator size="small" color={Colors.bg.void} />
          : (
            <Text style={styles.ctaText}>
              {progress.done
                ? t('chapterdetail.battleComplete')
                : allMet
                  ? t('chapterdetail.battleChallenge').replace('{boss}', bossName)
                  : t('chapterdetail.battleLocked')}
            </Text>
          )}
      </TouchableOpacity>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing[3] },
  headRow: { flexDirection: 'row', gap: Spacing[3], alignItems: 'center' },
  bossImage: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.bg.elevated },
  bossName: { fontSize: 16, fontFamily: Typography.family.heading, color: Colors.text.primary },
  intro: { fontSize: 12, color: Colors.text.muted, fontFamily: Typography.family.body, marginTop: 2, lineHeight: 17 },

  reqList: { gap: Spacing[2] },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  reqMark: { fontSize: 14, color: Colors.text.muted, width: 16, textAlign: 'center' },
  reqMarkMet: { color: Colors.status.connected },
  reqLabel: { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, flex: 1 },
  reqLabelMet: { color: Colors.text.primary },

  cta: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.bg.void },
});
