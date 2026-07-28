/**
 * Chapter lore/scene content — per-chapter reading material for the native
 * chapter detail screen (`docs/realgram/TASK_SPLIT.md` A→B(124)).
 *
 * `season2/data/lore/{slug}.json` is public and non-identity-gated (same
 * trust level ShahnamehEmbed already extends to this domain, confirmed
 * live per (124)'s own investigation — keyumars.json, 200 OK, 52KB).
 * Carries the "Read the Chronicle" scene list + timeline + codex/battle
 * data chapter.html renders. Multi-locale (en/fa/ru) — this build only
 * surfaces English, same scope as the rest of the native port so far
 * (RealGramChaptersScreen etc. don't localize either); the _fa/_ru fields
 * are left in the raw shape for a later i18n pass rather than dropped.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CACHE_TTL_MS = 6 * 3600 * 1_000; // static story content — safe to cache for hours

export interface ChapterScene {
  id: string;
  order: number;
  title: string;
  body: string;
  atmosphere: string;
  image: string;      // absolutized against SHAHNAMEH_ORIGIN
  video_url: string;  // absolutized against SHAHNAMEH_ORIGIN, '' if none
  reward: string;
}

export interface ChapterLore {
  slug: string;
  lore_summary: string;
  scenes: ChapterScene[];
}

interface RawScene {
  id: string; order: number; title_en: string; body_en: string;
  atmosphere?: string; image?: string; video_url?: string; reward?: string;
}

interface RawLore {
  chapter_slug: string;
  lore_summary?: { en?: string };
  scenes?: RawScene[];
}

function absolutize(path?: string): string {
  if (!path) return '';
  return path.startsWith('http') ? path : `${SHAHNAMEH_ORIGIN}${path}`;
}

function normalize(raw: RawLore): ChapterLore {
  return {
    slug: raw.chapter_slug,
    lore_summary: raw.lore_summary?.en ?? '',
    scenes: (raw.scenes ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id:         s.id,
        order:      s.order,
        title:      s.title_en ?? '',
        body:       s.body_en ?? '',
        atmosphere: s.atmosphere ?? '',
        image:      absolutize(s.image),
        video_url:  absolutize(s.video_url),
        reward:     s.reward ?? '',
      })),
  };
}

const _inFlight = new Map<string, Promise<ChapterLore | null>>();

export async function getChapterLore(slug: string): Promise<ChapterLore | null> {
  const cacheKey = `chapter_lore_v1_${slug}`;
  const ttlKey   = `chapter_lore_ttl_v1_${slug}`;
  const cached   = syncGet(cacheKey);
  const ttlStr   = syncGet(ttlKey);
  const expiry   = ttlStr ? parseInt(ttlStr, 10) : 0;

  if (cached && Date.now() < expiry) {
    try { return JSON.parse(cached) as ChapterLore; } catch {}
  }

  const existing = _inFlight.get(slug);
  if (existing) return existing;

  const promise = _fetch(slug, cacheKey, ttlKey, cached)
    .finally(() => { _inFlight.delete(slug); });
  _inFlight.set(slug, promise);
  return promise;
}

async function _fetch(
  slug: string, cacheKey: string, ttlKey: string, staleCache: string | null,
): Promise<ChapterLore | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/season2/data/lore/${slug}.json`, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`lore fetch ${res.status}`);
    const raw = await res.json() as RawLore;
    const lore = normalize(raw);
    storage.setItem(cacheKey, JSON.stringify(lore));
    storage.setItem(ttlKey, String(Date.now() + CACHE_TTL_MS));
    return lore;
  } catch {
    if (staleCache) {
      try { return JSON.parse(staleCache) as ChapterLore; } catch {}
    }
    return null;
  }
}
