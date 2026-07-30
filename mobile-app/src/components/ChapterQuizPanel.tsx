/**
 * ChapterQuizPanel — native 3-tier chapter quiz (Khabat, 2026-07-29: "quiz
 * ... skjer i realgram", the explicitly named still-WebView-only piece).
 * Mirrors chapter.js's own `paintQuiz()` UX: easy tier first, medium/hard
 * unlock once the previous tier is done+passed, tabs to switch between
 * unlocked tiers, a results screen with retry once a tier is done-but-
 * failed. Grading is server-side (chapterQuizService.ts's own header has
 * the full contract) — this component only ever shows immediate feedback
 * from the server's response, never decides "correct" itself.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { GlassCard } from './GlassCard';
import { useT } from '../i18n';
import { useToastStore } from '../stores/toastStore';
import { localizedField } from '../utils/localizedField';
import { getChapterQuiz, submitQuizAnswer, resetQuizTier, QuizQuestion, QuizTier } from '../services/chapterQuizService';
import { ChapterProgressSnapshot, applyQuizAnswer } from '../services/chapterProgressStore';

const TIERS: QuizTier[] = ['easy', 'medium', 'hard'];
const TIER_ICON: Record<QuizTier, string> = { easy: '🏆', medium: '⚔', hard: '👑' };
const TIER_LABEL_KEY: Record<QuizTier, 'chapterdetail.quizTierEasy' | 'chapterdetail.quizTierMedium' | 'chapterdetail.quizTierHard'> = {
  easy: 'chapterdetail.quizTierEasy', medium: 'chapterdetail.quizTierMedium', hard: 'chapterdetail.quizTierHard',
};

interface Props {
  slug: string;
  telegramId: string;
  progress: ChapterProgressSnapshot;
  onProgressChange: (next: ChapterProgressSnapshot) => void;
}

export function ChapterQuizPanel({ slug, telegramId, progress, onProgressChange }: Props) {
  const { t, lang } = useT();
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [activeTier, setActiveTier] = useState<QuizTier>('easy');
  const [pendingAnswer, setPendingAnswer] = useState<{ picked: number; result: { correct: boolean } } | null>(null);
  // Set the instant a user taps an answer, before the server round-trip —
  // Khabat, 2026-07-30: "knappen registrerer litt seint" (the button feels
  // slow to register). The tap itself was never actually slow; there was
  // just no visual acknowledgement between the tap and pendingAnswer (which
  // waits on the network) landing, so an impatient second tap could catch
  // the Next button once it appeared. This shows a neutral "selected" state
  // immediately — no correct/wrong color, that's still server-decided only,
  // matching this file's own header on why grading never happens client-side.
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    getChapterQuiz(slug).then((qs) => {
      setQuestions(qs);
      const firstIncomplete = TIERS.find((tier) => !progress.quiz[tier].done) ?? 'hard';
      setActiveTier(firstIncomplete);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (!questions) {
    return (
      <GlassCard style={styles.card}>
        <ActivityIndicator size="small" color={Colors.gold[400]} />
      </GlassCard>
    );
  }
  if (questions.length === 0) return null;

  const tierQuestions = (tier: QuizTier) => questions.filter((q) => q.tier === tier);
  const tierProgress = progress.quiz[activeTier];
  const activeQuestions = tierQuestions(activeTier);
  const currentQuestion = activeQuestions[tierProgress.idx] ?? null;

  const handleSelectTier = (tier: QuizTier) => {
    if (progress.quiz[tier].locked) return;
    setActiveTier(tier);
    setPendingAnswer(null);
    setPickedIndex(null);
  };

  const handleAnswer = async (index: number) => {
    if (!currentQuestion || submitting) return;
    setPickedIndex(index); // instant visual ack — see the state's own comment
    setSubmitting(true);
    const result = await submitQuizAnswer(telegramId, slug, currentQuestion.id, index);
    setSubmitting(false);
    if (!result) { setPickedIndex(null); return; } // network hiccup — let the user retry the tap
    setPendingAnswer({ picked: index, result: { correct: result.correct } });
    onProgressChange(applyQuizAnswer(slug, activeTier, currentQuestion.id, result.correct, result.done, result.passed, result.idx));
  };

  const handleNext = () => {
    setPendingAnswer(null);
    setPickedIndex(null);
  };

  const handleRetry = async () => {
    if (resetting) return;
    setResetting(true);
    const ok = await resetQuizTier(telegramId, slug, activeTier);
    setResetting(false);
    if (!ok) {
      // Khabat, 2026-07-30: "på noen kapitler ... funker det ikke" — retry
      // was failing silently here (network error or a non-1 server status),
      // which from the user's side looks identical to "the button does
      // nothing," indistinguishable from a real freeze. Surfacing it doesn't
      // fix whatever's rejecting the reset server-side, but at least makes
      // the failure visible instead of silent.
      useToastStore.getState().show(t('chapterdetail.quizRetryFailed'), 'error');
      return;
    }
    const reset = { idx: 0, correct: [], wrong: [], done: false, locked: tierProgress.locked, passed: false };
    onProgressChange({ ...progress, quiz: { ...progress.quiz, [activeTier]: reset } });
  };

  const nCorrect = tierProgress.correct.filter((id) => activeQuestions.some((q) => q.id === id)).length;
  const total = activeQuestions.length;

  return (
    <GlassCard style={styles.card}>
      <Text style={styles.title}>{t('chapterdetail.quizTitle')}</Text>

      <View style={styles.tabsRow}>
        {TIERS.map((tier) => {
          if (tierQuestions(tier).length === 0) return null;
          const tp = progress.quiz[tier];
          const active = tier === activeTier;
          return (
            <TouchableOpacity
              key={tier}
              onPress={() => handleSelectTier(tier)}
              disabled={tp.locked}
              activeOpacity={0.8}
              style={[styles.tab, active && styles.tabActive, tp.locked && styles.tabLocked]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tp.locked ? '🔒' : tp.done ? '✓' : TIER_ICON[tier]} {t(TIER_LABEL_KEY[tier])}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tierProgress.done ? (
        <View style={styles.resultsWrap}>
          <Text style={styles.resultsScore}>{nCorrect} / {total}</Text>
          <Text style={[styles.resultsLabel, { color: tierProgress.passed ? Colors.status.connected : '#FF6B6B' }]}>
            {t(tierProgress.passed ? 'chapterdetail.quizPassed' : 'chapterdetail.quizFailed')}
          </Text>
          {!tierProgress.passed && (
            <TouchableOpacity style={styles.retryBtn} activeOpacity={0.85} disabled={resetting} onPress={handleRetry}>
              {resetting
                ? <ActivityIndicator size="small" color={Colors.bg.void} />
                : <Text style={styles.retryBtnText}>{t('chapterdetail.quizRetry')}</Text>}
            </TouchableOpacity>
          )}
        </View>
      ) : currentQuestion ? (
        <View style={styles.questionWrap}>
          <Text style={styles.progressLine}>{tierProgress.idx + 1} / {total}</Text>
          <Text style={styles.questionText}>
            {localizedField(currentQuestion.question, currentQuestion.question_fa, currentQuestion.question_ru, lang)}
          </Text>
          {currentQuestion.answers.map((answer, i) => {
            const localizedAnswers = lang === 'fa' && currentQuestion.answers_fa ? currentQuestion.answers_fa
              : lang === 'ru' && currentQuestion.answers_ru ? currentQuestion.answers_ru
              : currentQuestion.answers;
            const answered = pendingAnswer !== null;
            const isPicked = pendingAnswer?.picked === i;
            const isServerCorrect = answered && pendingAnswer!.result.correct && isPicked;
            const isServerWrong = answered && !pendingAnswer!.result.correct && isPicked;
            // Neutral "you tapped this" state while the grade is still in
            // flight — only applies before the server result lands (once it
            // has, isServerCorrect/isServerWrong take over the same button).
            const isPendingPick = !answered && pickedIndex === i;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.answerBtn,
                  isPendingPick && styles.answerBtnPending,
                  isServerCorrect && styles.answerBtnCorrect,
                  isServerWrong && styles.answerBtnWrong,
                ]}
                activeOpacity={0.85}
                disabled={submitting || answered}
                onPress={() => handleAnswer(i)}
              >
                <Text style={styles.answerBtnText}>{localizedAnswers[i] ?? answer}</Text>
              </TouchableOpacity>
            );
          })}
          {submitting && <ActivityIndicator size="small" color={Colors.gold[400]} style={{ marginTop: Spacing[3] }} />}
          {pendingAnswer !== null && (
            <>
              <Text style={styles.explanationText}>
                {localizedField(currentQuestion.explanation, currentQuestion.explanation_fa, currentQuestion.explanation_ru, lang)}
              </Text>
              <TouchableOpacity style={styles.nextBtn} activeOpacity={0.85} onPress={handleNext}>
                <Text style={styles.nextBtnText}>{t('chapterdetail.quizNext')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <Text style={styles.emptyText}>{t('chapterdetail.quizNoQuestions')}</Text>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing[3] },
  title: { fontSize: 14, fontFamily: Typography.family.heading, color: Colors.text.primary },

  tabsRow: { flexDirection: 'row', gap: Spacing[2] },
  tab: { paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], borderRadius: Radius.full, backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.border.default },
  tabActive: { backgroundColor: 'rgba(212,175,55,0.16)', borderColor: Colors.gold[400] },
  tabLocked: { opacity: 0.45 },
  tabText: { fontSize: 12, fontFamily: Typography.family.label, color: Colors.text.secondary },
  tabTextActive: { color: Colors.gold[400] },

  progressLine: { fontSize: 11, color: Colors.text.muted, fontFamily: Typography.family.mono },
  questionWrap: { gap: Spacing[2] },
  questionText: { fontSize: 15, fontFamily: Typography.family.heading, color: Colors.text.primary, marginBottom: Spacing[1], lineHeight: 21 },

  answerBtn: { backgroundColor: Colors.bg.elevated, borderRadius: Radius.lg, paddingVertical: Spacing[3], paddingHorizontal: Spacing[4], borderWidth: 1, borderColor: Colors.border.default },
  answerBtnPending: { borderColor: Colors.gold[400], backgroundColor: 'rgba(212,175,55,0.10)' },
  answerBtnCorrect: { borderColor: Colors.status.connected, backgroundColor: 'rgba(93,214,150,0.12)' },
  answerBtnWrong: { borderColor: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.12)' },
  answerBtnText: { fontSize: 13, fontFamily: Typography.family.body, color: Colors.text.primary },

  explanationText: { fontSize: 12, color: Colors.text.secondary, fontFamily: Typography.family.body, marginTop: Spacing[2], lineHeight: 18, fontStyle: 'italic' },
  nextBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], alignItems: 'center', marginTop: Spacing[2] },
  nextBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  resultsWrap: { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[3] },
  resultsScore: { fontSize: 28, fontFamily: Typography.family.heading, color: Colors.text.primary },
  resultsLabel: { fontSize: 13, fontFamily: Typography.family.heading, textTransform: 'uppercase', letterSpacing: 0.5 },
  retryBtn: { backgroundColor: Colors.gold[400], borderRadius: Radius.lg, paddingVertical: Spacing[3], paddingHorizontal: Spacing[6], marginTop: Spacing[2] },
  retryBtnText: { fontSize: 13, fontFamily: Typography.family.heading, color: Colors.bg.void },

  emptyText: { fontSize: 13, color: Colors.text.muted, fontFamily: Typography.family.body },
});
