/**
 * FerdowsisScroll — knowledge draw, server-authoritative
 * (shahnameh-backend POST /season2/user/scroll-spin + /scroll-answer).
 * Per docs/NEW_GAMES_SPEC.md Game 1 (Khabat, 2026-08-02: wants more
 * games like the luck wheel/slot machine that also teach real Shahnameh
 * content). Draw a scroll → a real question from the 800-question quiz
 * bank unrolls → answer it → correct pays the full reward, wrong still
 * pays a small consolation (the near-miss mechanic the same day's
 * market research flagged as the biggest lever on session length,
 * applied to something that's actually teaching instead of pure chance).
 *
 * Visual note: the spec's original pitch described a spinning wheel of
 * question segments, same shape as DailyLuckWheel.tsx. Built as a
 * simpler scroll-unroll reveal instead for this pass — the mechanic
 * (draw → answer → near-miss reward) is what the spec actually needs;
 * a second full custom SVG wheel is a nice-to-have, not the core ask.
 * PRIZES-style segment wheel can replace this reveal later without
 * touching the server contract at all.
 *
 * Same non-negotiable discipline as every other chance game in this
 * app: the server holds the question+correct answer behind a short-
 * lived spin_token until /scroll-answer grades it — this component
 * never sees or checks the correct answer itself.
 */

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../design/tokens';
import { useT } from '../i18n';
import { spinScrollWheel, answerScroll } from '../services/earnService';
import { getSsoToken } from '../services/ssoService';
import { useToastStore } from '../stores/toastStore';

type Phase = 'idle' | 'question' | 'revealed' | 'already_spun';

interface Props {
  deviceId: string;
}

export function FerdowsisScroll({ deviceId }: Props) {
  const { t } = useT();
  const showToast = useToastStore((s) => s.show);
  const [phase, setPhase] = useState<Phase>('idle');
  const [drawing, setDrawing] = useState(false);
  const [question, setQuestion] = useState<{ text: string; answers: string[] } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [result, setResult] = useState<{
    correct: boolean; correctAnswer: number; explanation: string; amountCurrency: string; amount: number;
  } | null>(null);
  const telegramIdRef = useRef<string | null>(null);
  const spinTokenRef = useRef<string | null>(null);

  const resolveTelegramId = useCallback(async (): Promise<string | null> => {
    if (telegramIdRef.current) return telegramIdRef.current;
    if (!deviceId) return null;
    try {
      const r = await getSsoToken(deviceId, true);
      telegramIdRef.current = r.telegram_id || null;
    } catch {
      telegramIdRef.current = null;
    }
    return telegramIdRef.current;
  }, [deviceId]);

  const handleDraw = useCallback(async () => {
    if (drawing) return;
    setDrawing(true);
    const telegramId = await resolveTelegramId();
    if (!telegramId) {
      setDrawing(false);
      showToast(t('scroll.error'), 'error');
      return;
    }
    const res = await spinScrollWheel(telegramId);
    setDrawing(false);
    if (!res.ok) {
      if (res.error === 'already_spun') setPhase('already_spun');
      else showToast(t('scroll.error'), 'error');
      return;
    }
    spinTokenRef.current = res.spinToken;
    setQuestion({ text: res.question, answers: res.answers });
    setSelectedIndex(null);
    setResult(null);
    setPhase('question');
  }, [drawing, resolveTelegramId, showToast, t]);

  const handleAnswer = useCallback(async (index: number) => {
    if (selectedIndex !== null) return; // already answered this draw
    const telegramId = telegramIdRef.current;
    const spinToken = spinTokenRef.current;
    if (!telegramId || !spinToken) return;
    setSelectedIndex(index);
    const res = await answerScroll(telegramId, spinToken, index);
    if (!res.ok) {
      showToast(t('scroll.error'), 'error');
      setPhase('idle');
      return;
    }
    setResult({
      correct: res.correct, correctAnswer: res.correctAnswer,
      explanation: res.explanation, amountCurrency: res.amountCurrency, amount: res.amount,
    });
    setPhase('revealed');
  }, [selectedIndex, showToast, t]);

  return (
    <View style={styles.wrap}>
      {phase === 'idle' && (
        <TouchableOpacity
          style={[styles.drawBtn, drawing && styles.drawBtnDisabled]}
          activeOpacity={0.85}
          disabled={drawing}
          onPress={handleDraw}
          accessibilityRole="button"
        >
          <Text style={styles.drawIcon}>📜</Text>
          <Text style={styles.drawBtnText}>{drawing ? t('scroll.drawing') : t('scroll.draw')}</Text>
        </TouchableOpacity>
      )}

      {phase === 'already_spun' && (
        <View style={styles.comeBackWrap}>
          <Text style={styles.drawIcon}>📜</Text>
          <Text style={styles.comeBackText}>{t('scroll.comeBackTomorrow')}</Text>
        </View>
      )}

      {(phase === 'question' || phase === 'revealed') && question && (
        <View style={styles.scrollCard}>
          <Text style={styles.questionText}>{question.text}</Text>
          <View style={styles.answersWrap}>
            {question.answers.map((answer, i) => {
              const isSelected = selectedIndex === i;
              const isCorrect = result && i === result.correctAnswer;
              const showState = result != null;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.answerBtn,
                    isSelected && !showState && styles.answerBtnSelected,
                    showState && isCorrect && styles.answerBtnCorrect,
                    showState && isSelected && !isCorrect && styles.answerBtnWrong,
                  ]}
                  activeOpacity={0.85}
                  disabled={selectedIndex !== null}
                  onPress={() => handleAnswer(i)}
                  accessibilityRole="button"
                >
                  <Text style={styles.answerText}>{answer}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {result && (
            <View style={styles.resultWrap}>
              <Text style={result.correct ? styles.resultTextCorrect : styles.resultTextWrong}>
                {result.correct ? t('scroll.correct') : t('scroll.wrong')}
              </Text>
              <Text style={styles.explanationText}>{result.explanation}</Text>
              <Text style={styles.rewardText}>+{result.amount} {t(`scroll.currency${result.amountCurrency}` as 'scroll.currencyzar')}</Text>
              <TouchableOpacity
                style={styles.doneBtn}
                activeOpacity={0.85}
                onPress={() => setPhase('already_spun')}
                accessibilityRole="button"
              >
                <Text style={styles.doneBtnText}>{t('scroll.done')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing[4], width: '100%' },

  drawBtn: {
    alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[6], paddingHorizontal: Spacing[8],
    borderRadius: Radius.lg, backgroundColor: Colors.bg.elevated,
    borderWidth: 1, borderColor: Colors.gold[400] + '55',
  },
  drawBtnDisabled: { opacity: 0.6 },
  drawIcon: { fontSize: 40 },
  drawBtnText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.gold[400] },

  comeBackWrap: { alignItems: 'center', gap: Spacing[2], paddingVertical: Spacing[6] },
  comeBackText: { fontSize: Typography.size.sm, color: Colors.text.muted, fontFamily: Typography.family.body },

  scrollCard: {
    width: '100%', padding: Spacing[4], borderRadius: Radius.lg,
    backgroundColor: Colors.bg.elevated, borderWidth: 1, borderColor: Colors.gold[400] + '33', gap: Spacing[3],
  },
  questionText: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.text.primary },

  answersWrap: { gap: Spacing[2] },
  answerBtn: {
    paddingVertical: Spacing[3], paddingHorizontal: Spacing[4], borderRadius: Radius.md,
    backgroundColor: Colors.bg.void, borderWidth: 1, borderColor: Colors.border.default,
  },
  answerBtnSelected: { borderColor: Colors.gold[400] },
  answerBtnCorrect: { borderColor: Colors.status.connected, backgroundColor: Colors.status.connected + '22' },
  answerBtnWrong: { borderColor: Colors.red[400], backgroundColor: Colors.red[400] + '22' },
  answerText: { fontSize: Typography.size.sm, color: Colors.text.primary, fontFamily: Typography.family.body },

  resultWrap: { gap: Spacing[2], alignItems: 'center', paddingTop: Spacing[2] },
  resultTextCorrect: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.status.connected },
  resultTextWrong: { fontSize: Typography.size.md, fontFamily: Typography.family.heading, color: Colors.red[400] },
  explanationText: { fontSize: Typography.size.xs, color: Colors.text.muted, fontFamily: Typography.family.body, textAlign: 'center' },
  rewardText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: Colors.gold[400] },

  doneBtn: {
    marginTop: Spacing[2], paddingVertical: Spacing[2], paddingHorizontal: Spacing[6],
    borderRadius: Radius.full, backgroundColor: Colors.gold[400],
  },
  doneBtnText: { fontSize: Typography.size.sm, fontFamily: Typography.family.heading, color: '#0B0F14' },
});
