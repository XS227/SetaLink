/**
 * Chapter lore/scene content — per-chapter reading material for the native
 * chapter detail screen (`docs/realgram/TASK_SPLIT.md` A→B(124)).
 *
 * `season2/data/lore/{slug}.json` is public and non-identity-gated (same
 * trust level ShahnamehEmbed already extends to this domain, confirmed
 * live per (124)'s own investigation — keyumars.json, 200 OK, 52KB).
 * Carries the "Read the Chronicle" scene list + timeline + codex/battle
 * data chapter.html renders.
 *
 * 2026-07-29 (Khabat: "knytt kortene til historiene... husk samme logikken
 * mellom hero kortene, personer, steder, fiender, spesiale"): this used to
 * only read `lore_summary`/`scenes`, dropping `characters[]`/`places[]`
 * entirely even though they're already the exact card↔story link — each
 * entry's `slug` matches a hero-catalog slug 1:1 (confirmed: "keyumars",
 * "siamak" etc. exist identically in both season2/data/heroes.json and
 * every lore file's `characters[]`). Now parsed through, plus `unlock_via`
 * (e.g. `"scene:siamak-rises"`) — the same field chapter.js's own
 * `paintBattle()` reads to gate boss-fight character requirements, mirrored
 * here as `isCharacterUnlocked()`/`isPlaceUnlocked()` for the native
 * "card now available" popup.
 *
 * Multi-locale (en/fa/ru, no _zh at the source — falls back to English same
 * as everywhere else). Raw multi-language fields are kept on every entry
 * rather than resolved here, same reasoning as chapterCatalogService: a
 * language switch should show immediately without invalidating this
 * service's TTL cache.
 *
 * 2026-07-29 (Khabat: "quiz og videre prosess på kapitelen skjer i
 * realgram"): now also parses `battle` (boss/requirements) — the last
 * lore-file section this service dropped. Mirrors chapter.js's own
 * `reqMet()` switch (`kind: level/character/item/quiz/farr/owned_heroes`)
 * — evaluation itself lives in ChapterBattlePanel.tsx, not here, same
 * split as isCardUnlocked() above.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CACHE_TTL_MS = 6 * 3600 * 1_000; // static story content — safe to cache for hours

export interface ChapterScene {
  id: string;
  order: number;
  title: string;
  title_fa?: string;
  title_ru?: string;
  body: string;
  body_fa?: string;
  body_ru?: string;
  atmosphere: string;
  image: string;      // absolutized against SHAHNAMEH_ORIGIN
  video_url: string;  // absolutized against SHAHNAMEH_ORIGIN, '' if none
  reward: string;
}

/** A chapter-linked card reference — mirrors a hero-catalog entry's slug so
 *  callers can cross-reference into heroCatalogService's real cost/buy
 *  state. `unlocked`/`unlock_via` are content-level flags (chapter.js's own
 *  convention) — combine with a scene-read-set via isCardUnlocked() to get
 *  the real per-user answer. */
export interface ChapterCardRef {
  slug: string;
  name: string;
  name_fa?: string;
  name_ru?: string;
  image: string; // absolutized
  unlocked: boolean;
  unlock_via: string | null; // e.g. "scene:siamak-rises", null = no gate (already unlocked or ungated)
}

// Battle/boss requirement kinds — mirrors chapter.js's own `reqMet()`
// switch exactly (~L440). "desk"/"scenes_all"/quiz-tier requirements are
// auto-injected by the WEB client, not present in the raw JSON — this
// screen injects the native equivalents itself (see
// ChapterBattlePanel.tsx) rather than parsing them from here.
export type BattleRequirementKind = 'level' | 'character' | 'item' | 'quiz' | 'farr' | 'owned_heroes';

export interface BattleRequirement {
  id: string;
  kind: BattleRequirementKind;
  target: string; // hero_id / character slug / item id, meaning depends on kind
  heroId?: string; // for kind: 'level'
  level?: number;  // for kind: 'level'
  // 'item' requirements can be auto-granted on another event (e.g. "quiz" —
  // awarded once the easy tier is done) rather than being a real separate
  // action — mirrors the content's own `grant_on` field.
  grantOn?: string;
  label: string;
  label_fa?: string;
  label_ru?: string;
  hint: string;
  hint_fa?: string;
  hint_ru?: string;
}

export interface ChapterBattle {
  bossSlug: string;
  bossName: string;
  bossName_fa?: string;
  bossImage: string; // absolutized
  bossMasterImage: string; // absolutized, '' if none
  intro: string;
  intro_fa?: string;
  requirements: BattleRequirement[];
}

export interface ChapterLore {
  slug: string;
  lore_summary: string;
  lore_summary_fa?: string;
  lore_summary_ru?: string;
  scenes: ChapterScene[];
  characters: ChapterCardRef[];
  places: ChapterCardRef[];
  battle: ChapterBattle | null;
}

interface RawCharacterOrPlace {
  slug: string; name_en?: string; name_fa?: string; name_ru?: string;
  image?: string; unlocked?: boolean; unlock_via?: string;
}

interface RawScene {
  id: string; order: number;
  title_en: string; title_fa?: string; title_ru?: string;
  body_en: string; body_fa?: string; body_ru?: string;
  atmosphere?: string; image?: string; video_url?: string; reward?: string;
}

interface RawRequirement {
  id: string; kind: string; target?: string; hero_id?: string; level?: number; grant_on?: string;
  label_en?: string; label_fa?: string; label_ru?: string;
  hint_en?: string; hint_fa?: string; hint_ru?: string;
}

interface RawBattle {
  boss_slug?: string; boss_name_en?: string; boss_name_fa?: string;
  boss_image?: string; boss_master_image?: string;
  intro_en?: string; intro_fa?: string;
  requirements?: RawRequirement[];
}

interface RawLore {
  chapter_slug: string;
  lore_summary?: { en?: string; fa?: string; ru?: string };
  scenes?: RawScene[];
  characters?: RawCharacterOrPlace[];
  places?: RawCharacterOrPlace[];
  battle?: RawBattle;
}

function absolutize(path?: string): string {
  if (!path) return '';
  return path.startsWith('http') ? path : `${SHAHNAMEH_ORIGIN}${path}`;
}

function normalizeCardRef(raw: RawCharacterOrPlace): ChapterCardRef {
  return {
    slug:       raw.slug,
    name:       raw.name_en ?? raw.slug,
    name_fa:    raw.name_fa,
    name_ru:    raw.name_ru,
    image:      absolutize(raw.image),
    unlocked:   !!raw.unlocked,
    unlock_via: raw.unlock_via ?? null,
  };
}

const VALID_REQ_KINDS: BattleRequirementKind[] = ['level', 'character', 'item', 'quiz', 'farr', 'owned_heroes'];

function normalizeRequirement(raw: RawRequirement): BattleRequirement | null {
  if (!(VALID_REQ_KINDS as string[]).includes(raw.kind)) return null;
  return {
    id: raw.id,
    kind: raw.kind as BattleRequirementKind,
    target: raw.target ?? '',
    heroId: raw.hero_id,
    level: raw.level,
    grantOn: raw.grant_on,
    label: raw.label_en ?? '',
    label_fa: raw.label_fa,
    label_ru: raw.label_ru,
    hint: raw.hint_en ?? '',
    hint_fa: raw.hint_fa,
    hint_ru: raw.hint_ru,
  };
}

function normalizeBattle(raw: RawBattle | undefined): ChapterBattle | null {
  if (!raw || !raw.boss_slug) return null;
  return {
    bossSlug: raw.boss_slug,
    bossName: raw.boss_name_en ?? '',
    bossName_fa: raw.boss_name_fa,
    bossImage: absolutize(raw.boss_image),
    bossMasterImage: absolutize(raw.boss_master_image),
    intro: raw.intro_en ?? '',
    intro_fa: raw.intro_fa,
    requirements: (raw.requirements ?? [])
      .map(normalizeRequirement)
      .filter((r): r is BattleRequirement => r !== null),
  };
}

function normalize(raw: RawLore): ChapterLore {
  return {
    slug:            raw.chapter_slug,
    lore_summary:    raw.lore_summary?.en ?? '',
    lore_summary_fa: raw.lore_summary?.fa,
    lore_summary_ru: raw.lore_summary?.ru,
    scenes: (raw.scenes ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id:         s.id,
        order:      s.order,
        title:      s.title_en ?? '',
        title_fa:   s.title_fa,
        title_ru:   s.title_ru,
        body:       s.body_en ?? '',
        body_fa:    s.body_fa,
        body_ru:    s.body_ru,
        atmosphere: s.atmosphere ?? '',
        image:      absolutize(s.image),
        video_url:  absolutize(s.video_url),
        reward:     s.reward ?? '',
      })),
    characters: (raw.characters ?? []).map(normalizeCardRef),
    places:     (raw.places ?? []).map(normalizeCardRef),
    battle:     normalizeBattle(raw.battle),
  };
}

/** Mirrors chapter.js's own `paintBattle()` unlock check exactly (see that
 *  file, ~L419): a card is unlocked if the content already marks it
 *  `unlocked: true`, or its `unlock_via: "scene:X"` gate references a scene
 *  the player has actually read. Cards with no `unlock_via` and
 *  `unlocked: false` are locked with no reading-based way to open them
 *  (gated some other way — e.g. hero prereq level — not this screen's
 *  concern). */
export function isCardUnlocked(card: ChapterCardRef, readSceneIds: Set<string>): boolean {
  if (card.unlocked) return true;
  if (card.unlock_via?.startsWith('scene:')) {
    return readSceneIds.has(card.unlock_via.slice('scene:'.length));
  }
  return false;
}

/** Cards whose unlock gate is exactly this scene — used right after marking
 *  a scene read to decide whether to show the golden "card now available"
 *  popup. Only returns cards that were NOT already unlocked before this
 *  scene was read (checked against `readSceneIdsBefore`, the read-set as it
 *  was prior to this scene). */
export function cardsUnlockedBySceneRead(
  lore: ChapterLore, sceneId: string, readSceneIdsBefore: Set<string>,
): ChapterCardRef[] {
  const gate = `scene:${sceneId}`;
  return [...lore.characters, ...lore.places].filter(
    (c) => c.unlock_via === gate && !isCardUnlocked(c, readSceneIdsBefore),
  );
}

const _inFlight = new Map<string, Promise<ChapterLore | null>>();

export async function getChapterLore(slug: string): Promise<ChapterLore | null> {
  const cacheKey = `chapter_lore_v3_${slug}`; // v3: adds battle
  const ttlKey   = `chapter_lore_ttl_v3_${slug}`;
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
