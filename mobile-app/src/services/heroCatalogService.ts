/**
 * Hero catalog + ownership — Shahnameh's real hero/artifact/creature
 * collection (`docs/realgram/TASK_SPLIT.md` A→B(125) roadmap, closing the
 * data-mismatch flagged in A→B(135)/B→A(136)).
 *
 * `/api/catalog/heroes` used to serve 11 stale placeholder entries with no
 * relation to the real economy (admin-CMS test content, only 1 of 11 slugs
 * — 'rakhsh' — existed anywhere in the actual game). Rebuilt server-side
 * (season2/data/heroes.json regenerated from heroes.js's own live
 * COLLECTION array cross-verified against shahnameh-backend's
 * HERO_CATALOG for cost/prereq consistency, both sources agreed exactly)
 * to the 33 real, currently-purchasable heroes/artifacts. Same public,
 * non-identity-gated endpoint — no route change, just correct data.
 *
 * Ownership/buy/upgrade need the telegram_id bridge (B->A(132)), same
 * pattern as Clan join/apply and Earn.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CATALOG_URL       = `${SHAHNAMEH_ORIGIN}/api/catalog/heroes`;
const CACHE_KEY     = 'hero_catalog_v2';
const CACHE_TTL_KEY = 'hero_catalog_ttl_v2';
const CACHE_TTL_MS  = 6 * 3600 * 1_000; // static definition content — safe to cache for hours

export interface HeroPrereq {
  hero_id: string;
  level:   number;
}

export interface HeroCatalogEntry {
  slug:                string;
  name:                string;
  rarity:              string; // 'Common' | 'Rare' | 'Epic' | 'Legend' | 'Mythic'
  era:                 string; // e.g. 'Chapter 3'
  description:         string;
  image_url:           string; // already absolutized against SHAHNAMEH_ORIGIN
  cost:                number; // REAL to buy at level 1
  zar_per_hour:        number; // passive income at level 1
  farr_cost:           number;
  prereq:              HeroPrereq | null;
  unlock_requirement:  string; // friendly text version of prereq, '' if none
}

export interface OwnedHero {
  hero_id:      string;
  level:        number;
  zar_per_hour: number;
}

interface RawCatalog {
  status: boolean;
  heroes: Array<{
    slug: string; name: string; rarity?: string; era?: string; description?: string;
    image_url?: string; cost?: number; zar_per_hour?: number; farr_cost?: number;
    prereq?: HeroPrereq | null; unlock_requirement?: string; status?: string;
  }>;
}

function normalize(raw: RawCatalog): HeroCatalogEntry[] {
  return raw.heroes
    .filter((h) => h.status !== 'inactive')
    .map((h) => ({
      slug:               h.slug,
      name:               h.name,
      rarity:             h.rarity ?? '',
      era:                h.era ?? '',
      description:        h.description ?? '',
      image_url:          h.image_url ? (h.image_url.startsWith('http') ? h.image_url : `${SHAHNAMEH_ORIGIN}${h.image_url}`) : '',
      cost:               h.cost ?? 0,
      zar_per_hour:       h.zar_per_hour ?? 0,
      farr_cost:          h.farr_cost ?? 0,
      prereq:             h.prereq ?? null,
      unlock_requirement: h.unlock_requirement ?? '',
    }));
}

let _inFlight: Promise<HeroCatalogEntry[]> | null = null;

export async function getHeroCatalog(): Promise<HeroCatalogEntry[]> {
  const cached = syncGet(CACHE_KEY);
  const ttlStr = syncGet(CACHE_TTL_KEY);
  const expiry = ttlStr ? parseInt(ttlStr, 10) : 0;

  if (cached && Date.now() < expiry) {
    try { return JSON.parse(cached) as HeroCatalogEntry[]; } catch {}
  }

  if (_inFlight) return _inFlight;
  _inFlight = _fetch(cached).finally(() => { _inFlight = null; });
  return _inFlight;
}

async function _fetch(staleCache: string | null): Promise<HeroCatalogEntry[]> {
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
    try { return JSON.parse(staleCache) as HeroCatalogEntry[]; } catch {}
  }
  return [];
}

export async function getOwnedHeroes(telegramId: string): Promise<Map<string, OwnedHero>> {
  if (!telegramId) return new Map();
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/user/heroes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1 || !Array.isArray(json.heroes)) return new Map();
    return new Map(json.heroes.map((h: { hero_id: string; level: number; zar_per_hour: number }) => [h.hero_id, { hero_id: h.hero_id, level: h.level, zar_per_hour: h.zar_per_hour }]));
  } catch {
    return new Map();
  }
}

export type ActionResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function buyHero(telegramId: string, heroId: string): Promise<ActionResult<{ new_balance: number; level: number; zar_per_hour: number }>> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/user/buy-hero`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, hero_id: heroId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status === 1) return { ok: true, data: { new_balance: json.new_balance, level: json.level, zar_per_hour: json.zar_per_hour } };
    return { ok: false, error: String(json?.error ?? 'unknown_error') };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function upgradeHero(telegramId: string, heroId: string): Promise<ActionResult<{ new_balance: number; level: number; zar_per_hour: number }>> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/user/upgrade-hero`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, hero_id: heroId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status === 1) return { ok: true, data: { new_balance: json.new_balance, level: json.level, zar_per_hour: json.zar_per_hour } };
    return { ok: false, error: String(json?.error ?? 'unknown_error') };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
