/**
 * Chapter quiz — native 3-tier (easy/medium/hard) multiple-choice, per
 * chapter. Khabat, 2026-07-29: "quiz og videre prosess på kapitelen skjer
 * i realgram" — the one piece explicitly named as still WebView-only.
 *
 * Questions come from `season2/data/quizzes/{slug}.json` (one small file
 * per chapter, confirmed live — NOT `data/quizzes.json`, the 3MB
 * all-chapters monolith chapter.js itself avoids fetching whole for the
 * same reason). Grading is server-side (`lib/quizCatalog.js` via
 * `/user/quiz/answer`) — this service never trusts a client-computed
 * "correct" value as the real answer, only as immediate UI feedback ahead
 * of the server's response.
 */

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const BASE_URL = `${SHAHNAMEH_ORIGIN}/api/season2`;

export type QuizTier = 'easy' | 'medium' | 'hard';

export interface QuizQuestion {
  id: string;
  chapterSlug: string;
  tier: QuizTier;
  part: number;
  question: string;
  question_fa?: string;
  question_ru?: string;
  answers: string[];
  answers_fa?: string[];
  answers_ru?: string[];
  correctAnswer: number; // UI-feedback only — server re-validates independently
  explanation: string;
  explanation_fa?: string;
  explanation_ru?: string;
  rewardXp: number;
  rewardReal: number;
}

interface RawQuestion {
  id: string; chapter_slug: string; quiz_part: number; difficulty: string;
  question: string; question_fa?: string; question_ru?: string;
  answers: string[]; answers_fa?: string[]; answers_ru?: string[];
  correct_answer: number;
  explanation: string; explanation_fa?: string; explanation_ru?: string;
  reward?: { xp?: number; real?: number };
}

function normalize(raw: RawQuestion): QuizQuestion {
  return {
    id: raw.id,
    chapterSlug: raw.chapter_slug,
    tier: (raw.difficulty?.toLowerCase() as QuizTier) || 'easy',
    part: raw.quiz_part ?? 1,
    question: raw.question,
    question_fa: raw.question_fa,
    question_ru: raw.question_ru,
    answers: raw.answers ?? [],
    answers_fa: raw.answers_fa,
    answers_ru: raw.answers_ru,
    correctAnswer: raw.correct_answer,
    explanation: raw.explanation ?? '',
    explanation_fa: raw.explanation_fa,
    explanation_ru: raw.explanation_ru,
    rewardXp: raw.reward?.xp ?? 0,
    rewardReal: raw.reward?.real ?? 0,
  };
}

const _cache = new Map<string, QuizQuestion[]>();

export async function getChapterQuiz(slug: string): Promise<QuizQuestion[]> {
  const cached = _cache.get(slug);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/season2/data/quizzes/${slug}.json`, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return [];
    const json = await res.json() as { quizzes?: RawQuestion[] };
    const questions = (json.quizzes ?? [])
      .map(normalize)
      .sort((a, b) => a.part - b.part);
    _cache.set(slug, questions);
    return questions;
  } catch {
    return [];
  }
}

export interface QuizAnswerResult {
  correct: boolean;
  done: boolean;
  passed: boolean;
  idx: number;
  total: number;
}

/** Server grades the answer — `entry.correct_answer` on the backend, not
 *  whatever this client believes. `question.correctAnswer` is only used to
 *  show an instant "✓/✗" before this resolves. */
export async function submitQuizAnswer(
  telegramId: string, slug: string, questionId: string, pickedIndex: number,
): Promise<QuizAnswerResult | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${BASE_URL}/user/quiz/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, slug, question_id: questionId, picked_index: pickedIndex }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1) return null;
    return { correct: !!json.correct, done: !!json.done, passed: !!json.passed, idx: json.idx ?? 0, total: json.total ?? 0 };
  } catch {
    return null;
  }
}

/** Only allowed server-side when the tier is done-but-not-passed. */
export async function resetQuizTier(telegramId: string, slug: string, tier: QuizTier): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${BASE_URL}/user/quiz/reset-tier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, slug, tier }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    return json?.status === 1;
  } catch {
    return false;
  }
}
