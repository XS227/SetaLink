/**
 * Per-chapter progress — local cache + merge logic. Mirrors season2/sync.js's
 * own contract exactly (`_mergeChapter`/`_mergeTier`, `chapterSnapshot`):
 * "server is source of truth, localStorage cache," union sets / OR done
 * flags / max counters, so no device can ever lose progress relative to
 * another.
 *
 * 2026-07-29 (Khabat: "når jeg er ferdig med en kapitel historie og skal
 * videre så blir jeg sendt tilbake ekstern shahnameh"): this used to only
 * track scene-read ids, purely local, never synced — the real root cause
 * of the disjointed feeling. The WebView (chapter.html) and this native
 * screen were reading/writing completely separate storage (native MMKV vs.
 * the WebView's own sandboxed localStorage) with no bridge between them.
 * Expanded to the full snapshot shape and wired to
 * chapterProgressSyncService.ts's get/save calls against the same
 * `ChapterProgress` MongoDB collection chapter.js already syncs to — native
 * and WebView progress now genuinely share one source of truth.
 */

import { storage, syncGet } from '../storage/storage';

export interface QuizTierProgress {
  idx: number;
  correct: string[];
  wrong: string[];
  done: boolean;
  locked: boolean;
  passed: boolean;
}

export interface ChapterProgressSnapshot {
  scenes: string[];
  codex: string[];
  quiz: { easy: QuizTierProgress; medium: QuizTierProgress; hard: QuizTierProgress };
  fragments: number;
  desk_read: boolean;
  done: boolean;
  rewards_done: boolean;
}

function emptyTier(locked: boolean): QuizTierProgress {
  return { idx: 0, correct: [], wrong: [], done: false, locked, passed: false };
}

export function emptySnapshot(): ChapterProgressSnapshot {
  return {
    scenes: [], codex: [],
    quiz: { easy: emptyTier(false), medium: emptyTier(true), hard: emptyTier(true) },
    fragments: 0, desk_read: false, done: false, rewards_done: false,
  };
}

function key(slug: string): string {
  return `real_chapter_progress_v2_${slug}`;
}

export function getLocalSnapshot(slug: string): ChapterProgressSnapshot {
  const raw = syncGet(key(slug));
  if (!raw) return emptySnapshot();
  try {
    const parsed = JSON.parse(raw);
    // v1 storage was a bare scene-id array — migrate forward instead of
    // discarding real local progress just because the shape changed.
    if (Array.isArray(parsed)) return { ...emptySnapshot(), scenes: parsed };
    const base = emptySnapshot();
    return {
      ...base,
      ...parsed,
      quiz: {
        easy:   { ...base.quiz.easy,   ...(parsed.quiz?.easy   ?? {}) },
        medium: { ...base.quiz.medium, ...(parsed.quiz?.medium ?? {}) },
        hard:   { ...base.quiz.hard,   ...(parsed.quiz?.hard   ?? {}) },
      },
    };
  } catch {
    return emptySnapshot();
  }
}

export function saveLocalSnapshot(slug: string, snapshot: ChapterProgressSnapshot): void {
  storage.setItem(key(slug), JSON.stringify(snapshot));
}

function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

function mergeTier(a: QuizTierProgress, b: QuizTierProgress, isEasy: boolean): QuizTierProgress {
  const unlocked = a.locked === false || b.locked === false || isEasy;
  return {
    idx: Math.max(a.idx ?? 0, b.idx ?? 0),
    correct: union(a.correct, b.correct),
    wrong: union(a.wrong, b.wrong),
    done: !!a.done || !!b.done,
    locked: !unlocked,
    passed: !!a.passed || !!b.passed,
  };
}

/** Same merge contract as sync.js's `_mergeChapter` — union sets, OR
 *  booleans, max counters. Order of arguments doesn't matter (commutative). */
export function mergeSnapshot(a: ChapterProgressSnapshot, b: ChapterProgressSnapshot): ChapterProgressSnapshot {
  return {
    scenes: union(a.scenes, b.scenes),
    codex: union(a.codex, b.codex),
    quiz: {
      easy: mergeTier(a.quiz.easy, b.quiz.easy, true),
      medium: mergeTier(a.quiz.medium, b.quiz.medium, false),
      hard: mergeTier(a.quiz.hard, b.quiz.hard, false),
    },
    fragments: Math.max(a.fragments ?? 0, b.fragments ?? 0),
    desk_read: !!a.desk_read || !!b.desk_read,
    done: !!a.done || !!b.done,
    rewards_done: !!a.rewards_done || !!b.rewards_done,
  };
}

export function markSceneRead(slug: string, sceneId: string): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  if (snap.scenes.includes(sceneId)) return snap;
  const next = { ...snap, scenes: [...snap.scenes, sceneId] };
  saveLocalSnapshot(slug, next);
  return next;
}

export function markDeskRead(slug: string): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  if (snap.desk_read) return snap;
  const next = { ...snap, desk_read: true };
  saveLocalSnapshot(slug, next);
  return next;
}

export function markChapterDone(slug: string): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  const next = { ...snap, done: true };
  saveLocalSnapshot(slug, next);
  return next;
}

export function markRewardsDone(slug: string): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  const next = { ...snap, rewards_done: true };
  saveLocalSnapshot(slug, next);
  return next;
}

/** Khabat, 2026-07-30: "umulig å restarte quiz når man har svart feil" —
 *  ChapterQuizPanel.tsx's handleRetry() used to build its reset tier
 *  object inline and only push it through onProgressChange (React state +
 *  a server save), never through saveLocalSnapshot() the way every other
 *  mutation here does. The stale done:true/passed:false tier stayed in
 *  the on-device cache, so the very next screen mount's
 *  mergeSnapshot(local, server) — union/OR semantics, `done: a.done ||
 *  b.done` — pulled the old "failed" state right back in no matter what
 *  the server (or the just-reset React state) said, since a merge can
 *  only ever add progress, never clear it. A reset has to actually
 *  persist locally to survive its own next merge. Named to match this
 *  file's own submitQuizAnswer()/applyQuizAnswer() split (chapterQuizService.ts's
 *  server call vs. this file's local persistence) — chapterQuizService.ts's
 *  `resetQuizTier` is the server half, this is the local half. */
export function applyQuizReset(slug: string, tier: 'easy' | 'medium' | 'hard'): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  const tp = snap.quiz[tier];
  const reset: QuizTierProgress = { idx: 0, correct: [], wrong: [], done: false, locked: tp.locked, passed: false };
  const next = { ...snap, quiz: { ...snap.quiz, [tier]: reset } };
  saveLocalSnapshot(slug, next);
  return next;
}

export function applyQuizAnswer(
  slug: string, tier: 'easy' | 'medium' | 'hard',
  questionId: string, correct: boolean, done: boolean, passed: boolean, idx: number,
): ChapterProgressSnapshot {
  const snap = getLocalSnapshot(slug);
  const tp = snap.quiz[tier];
  const already = tp.correct.includes(questionId) || tp.wrong.includes(questionId);
  const updatedTier: QuizTierProgress = already ? tp : {
    ...tp,
    correct: correct ? [...tp.correct, questionId] : tp.correct,
    wrong: !correct ? [...tp.wrong, questionId] : tp.wrong,
    idx,
    done,
    passed,
  };
  // Built as separate locals rather than a single object-literal spread —
  // a computed `[tier]: updatedTier` key next to literal `medium`/`hard`
  // keys silently collided (later literal key wins in JS), discarding the
  // just-computed update whenever `tier` was 'medium' or 'hard'. Caught
  // this reading it back, not by testing (no way to run this app on this
  // box) — worth a real device check on retrying a medium/hard question.
  let easy = snap.quiz.easy, medium = snap.quiz.medium, hard = snap.quiz.hard;
  if (tier === 'easy') easy = updatedTier;
  if (tier === 'medium') medium = updatedTier;
  if (tier === 'hard') hard = updatedTier;
  // Propagate tier unlocks the same way sync.js/chapter.js do.
  if (tier === 'easy' && done && passed) medium = { ...medium, locked: false };
  if (tier === 'medium' && done && passed) hard = { ...hard, locked: false };

  const next: ChapterProgressSnapshot = { ...snap, quiz: { easy, medium, hard } };
  saveLocalSnapshot(slug, next);
  return next;
}

/** Scene 1 is always open; scene N+1 unlocks once scene N has been read. */
export function isSceneUnlocked(order: number, snapshot: ChapterProgressSnapshot, scenes: { id: string; order: number }[]): boolean {
  if (order <= 1) return true;
  const prev = scenes.find((s) => s.order === order - 1);
  return !!prev && snapshot.scenes.includes(prev.id);
}

/** Back-compat for any caller still asking for a bare scene-id set. */
export function getReadSceneIds(slug: string): Set<string> {
  return new Set(getLocalSnapshot(slug).scenes);
}
