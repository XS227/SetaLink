/**
 * Chapter catalog — static Shahnameh chapter content (title, summary,
 * cover image, rewards) for the native Journey screen (RealGramChaptersScreen).
 *
 * Khabat's build-test ask (2026-07-27): the Profile tab's Chapters card was
 * "41/42 bare tekst" (a flat slug list) and should "look as nice as it does
 * in the Shahnameh chapter [journey] page" — but as RealGram's own native
 * page, not the embedded Shahnameh WebView itself. contract §9's profile
 * summary (realGramProfileService.ts) only carries per-user state
 * (slug/done/rewards_done), not the display copy — this fetches the same
 * public catalog season2/learn.js itself reads (`/season2/data/chapters.json`,
 * confirmed live: 50 chapters, title/summary/image_url/rewards per entry).
 * It's static marketing/story content, not identity-gated, same trust level
 * as ShahnamehEmbed already loading season2 URLs directly — no panel proxy
 * needed.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CATALOG_URL       = `${SHAHNAMEH_ORIGIN}/season2/data/chapters.json`;
const CACHE_KEY     = 'chapter_catalog_v1';
const CACHE_TTL_KEY = 'chapter_catalog_ttl_v1';
const CACHE_TTL_MS  = 6 * 3600 * 1_000; // static story content — safe to cache for hours

export interface ChapterCatalogEntry {
  slug:          string;
  order:         number;
  title:         string;
  summary:       string;
  image_url:     string; // already absolutized against SHAHNAMEH_ORIGIN, '' if none
  reward_xp:     number;
  reward_real:   number;
}

interface RawCatalog {
  totalChapters: number;
  chapters: Array<{
    slug: string;
    order: number;
    title: string;
    summary: string;
    image_url?: string;
    rewards?: { xp?: number; real?: number };
  }>;
}

function normalize(raw: RawCatalog): ChapterCatalogEntry[] {
  return raw.chapters
    .map((c) => ({
      slug:        c.slug,
      order:       c.order,
      title:       c.title,
      summary:     c.summary,
      image_url:   c.image_url ? (c.image_url.startsWith('http') ? c.image_url : `${SHAHNAMEH_ORIGIN}${c.image_url}`) : '',
      reward_xp:   c.rewards?.xp ?? 0,
      reward_real: c.rewards?.real ?? 0,
    }))
    .sort((a, b) => a.order - b.order);
}

let _inFlight: Promise<ChapterCatalogEntry[]> | null = null;

export async function getChapterCatalog(): Promise<ChapterCatalogEntry[]> {
  const cached = syncGet(CACHE_KEY);
  const ttlStr = syncGet(CACHE_TTL_KEY);
  const expiry = ttlStr ? parseInt(ttlStr, 10) : 0;

  if (cached && Date.now() < expiry) {
    try { return JSON.parse(cached) as ChapterCatalogEntry[]; } catch {}
  }

  if (_inFlight) return _inFlight;
  _inFlight = _fetch(cached).finally(() => { _inFlight = null; });
  return _inFlight;
}

async function _fetch(staleCache: string | null): Promise<ChapterCatalogEntry[]> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(CATALOG_URL, { signal: controller.signal });
    clearTimeout(tid);
    const raw = await res.json() as RawCatalog;
    const entries = normalize(raw);
    if (entries.length > 0) {
      storage.setItem(CACHE_KEY, JSON.stringify(entries));
      storage.setItem(CACHE_TTL_KEY, String(Date.now() + CACHE_TTL_MS));
      return entries;
    }
  } catch { /* network unavailable — fall through to stale cache / empty */ }

  if (staleCache) {
    try { return JSON.parse(staleCache) as ChapterCatalogEntry[]; } catch {}
  }
  return [];
}
