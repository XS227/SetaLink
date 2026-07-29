/**
 * Chapter progress sync — get/save against the same `ChapterProgress`
 * MongoDB collection + endpoints season2/sync.js already uses
 * (`/user/chapter-progress/get`, `/user/chapter-progress/save`). This is
 * the actual fix for Khabat's "sendt tilbake ekstern shahnameh" complaint
 * (2026-07-29): native reading progress used to live only in this app's
 * own MMKV storage, invisible to the WebView (which has its own, separate
 * sandboxed localStorage) — now both read/write the same server record.
 */

import { ChapterProgressSnapshot } from './chapterProgressStore';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const BASE_URL = `${SHAHNAMEH_ORIGIN}/api/season2`;

interface RawTier {
  idx?: number; correct?: string[]; wrong?: string[]; done?: boolean; locked?: boolean; passed?: boolean;
}

interface RawSnapshot {
  scenes?: string[]; codex?: string[];
  quiz?: { easy?: RawTier; medium?: RawTier; hard?: RawTier };
  fragments?: number; desk_read?: boolean; done?: boolean; rewards_done?: boolean;
}

function normalizeTier(raw: RawTier | undefined, isEasy: boolean) {
  return {
    idx: raw?.idx ?? 0,
    correct: raw?.correct ?? [],
    wrong: raw?.wrong ?? [],
    done: !!raw?.done,
    locked: raw?.locked ?? !isEasy,
    passed: !!raw?.passed,
  };
}

function normalizeSnapshot(raw: RawSnapshot | undefined): ChapterProgressSnapshot {
  return {
    scenes: raw?.scenes ?? [],
    codex: raw?.codex ?? [],
    quiz: {
      easy: normalizeTier(raw?.quiz?.easy, true),
      medium: normalizeTier(raw?.quiz?.medium, false),
      hard: normalizeTier(raw?.quiz?.hard, false),
    },
    fragments: raw?.fragments ?? 0,
    desk_read: !!raw?.desk_read,
    done: !!raw?.done,
    rewards_done: !!raw?.rewards_done,
  };
}

/** Fetches every chapter's server progress in one call (matches sync.js's
 *  own `initChapterProgress`, which pulls the whole map on boot rather than
 *  one chapter at a time). Returns null on any failure — callers should
 *  fall back to local-only state, never block reading on this. */
export async function fetchServerChapterProgress(telegramId: string): Promise<Record<string, ChapterProgressSnapshot> | null> {
  if (!telegramId) return null;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${BASE_URL}/user/chapter-progress/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1) return null;
    const out: Record<string, ChapterProgressSnapshot> = {};
    for (const slug of Object.keys(json.chapters ?? {})) {
      out[slug] = normalizeSnapshot(json.chapters[slug]);
    }
    return out;
  } catch {
    return null;
  }
}

/** Pushes one chapter's full merged snapshot. Fire-and-forget from the
 *  caller's perspective is fine (matches chapter.js's own `post()` helper,
 *  which never blocks the UI on this) — failures just mean the next
 *  fetchServerChapterProgress() re-merges from local state again. */
export async function pushChapterProgress(telegramId: string, slug: string, snapshot: ChapterProgressSnapshot): Promise<boolean> {
  if (!telegramId) return false;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${BASE_URL}/user/chapter-progress/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, chapters: { [slug]: snapshot } }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    return json?.status === 1;
  } catch {
    return false;
  }
}
