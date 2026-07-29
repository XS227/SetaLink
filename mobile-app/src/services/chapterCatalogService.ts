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
 *
 * 2026-07-29 (Khabat: "språk er ikke klar når jeg åpner chaptets, bare
 * engelsk er tilgjengelig"): the source `chapters.json` already carries
 * `title_fa`/`summary_fa`/`title_ru`/`summary_ru` per chapter — this used to
 * only read the bare English fields. Now carries all variants through;
 * RealGramChaptersScreen picks the active one via localizedField() at
 * render time (not baked in here, so a language switch doesn't need a
 * refetch/cache-bust). No `_zh` exists at the source — Chinese falls back
 * to English, same convention as useT()'s own fallback.
 *
 * 2026-07-29 (Khabat: "quiz og videre prosess på kapitelen skjer i
 * realgram"): also carries `ferdowsi_chronicle` now (age/year/historical
 * context/personal challenge/lore impact) — Ferdowsi's Desk's content,
 * dropped entirely before. Same per-field localization pattern as
 * title/summary above.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CATALOG_URL       = `${SHAHNAMEH_ORIGIN}/season2/data/chapters.json`;
const CACHE_KEY     = 'chapter_catalog_v2'; // v2: adds ferdowsi_chronicle
const CACHE_TTL_KEY = 'chapter_catalog_ttl_v2';
const CACHE_TTL_MS  = 6 * 3600 * 1_000; // static story content — safe to cache for hours

export interface FerdowsiChronicle {
  age: number;
  year: string;
  historicalContext: string;
  historicalContext_fa?: string;
  historicalContext_ru?: string;
  personalChallenge: string;
  personalChallenge_fa?: string;
  personalChallenge_ru?: string;
  loreImpact: string;
  loreImpact_fa?: string;
  loreImpact_ru?: string;
}

export interface ChapterCatalogEntry {
  slug:          string;
  order:         number;
  title:         string;
  title_fa?:     string;
  title_ru?:     string;
  summary:       string;
  summary_fa?:   string;
  summary_ru?:   string;
  image_url:     string; // already absolutized against SHAHNAMEH_ORIGIN, '' if none
  reward_xp:     number;
  reward_real:   number;
  ferdowsi_chronicle: FerdowsiChronicle | null;
}

interface RawChronicle {
  age?: number; year?: string;
  historical_context?: string; historical_context_fa?: string; historical_context_ru?: string;
  personal_challenge?: string; personal_challenge_fa?: string; personal_challenge_ru?: string;
  lore_impact?: string; lore_impact_fa?: string; lore_impact_ru?: string;
}

interface RawCatalog {
  totalChapters: number;
  chapters: Array<{
    slug: string;
    order: number;
    title: string;
    title_fa?: string;
    title_ru?: string;
    summary: string;
    summary_fa?: string;
    summary_ru?: string;
    image_url?: string;
    rewards?: { xp?: number; real?: number };
    ferdowsi_chronicle?: RawChronicle;
  }>;
}

function normalizeChronicle(raw: RawChronicle | undefined): FerdowsiChronicle | null {
  if (!raw || !raw.historical_context) return null;
  return {
    age: raw.age ?? 0,
    year: raw.year ?? '',
    historicalContext: raw.historical_context ?? '',
    historicalContext_fa: raw.historical_context_fa,
    historicalContext_ru: raw.historical_context_ru,
    personalChallenge: raw.personal_challenge ?? '',
    personalChallenge_fa: raw.personal_challenge_fa,
    personalChallenge_ru: raw.personal_challenge_ru,
    loreImpact: raw.lore_impact ?? '',
    loreImpact_fa: raw.lore_impact_fa,
    loreImpact_ru: raw.lore_impact_ru,
  };
}

function normalize(raw: RawCatalog): ChapterCatalogEntry[] {
  return raw.chapters
    .map((c) => ({
      slug:        c.slug,
      order:       c.order,
      title:       c.title,
      title_fa:    c.title_fa,
      title_ru:    c.title_ru,
      summary:     c.summary,
      summary_fa:  c.summary_fa,
      summary_ru:  c.summary_ru,
      image_url:   c.image_url ? (c.image_url.startsWith('http') ? c.image_url : `${SHAHNAMEH_ORIGIN}${c.image_url}`) : '',
      reward_xp:   c.rewards?.xp ?? 0,
      reward_real: c.rewards?.real ?? 0,
      ferdowsi_chronicle: normalizeChronicle(c.ferdowsi_chronicle),
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
