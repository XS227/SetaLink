/**
 * Hero catalog — static Shahnameh hero definitions (name, rarity, power,
 * bonus, unlock requirement) for the eventual native Heroes screen
 * (`docs/realgram/TASK_SPLIT.md` A→B(125) roadmap).
 *
 * Same posture as chapterCatalogService.ts: `season2/data/...` is public,
 * non-identity-gated story/definition content, same trust level
 * ShahnamehEmbed already extends to season2 URLs directly — no panel proxy.
 * This is catalog-only (the 11 hero definitions) — per-user ownership/level/
 * upgrade state needs the telegram_id identity bridge A→B(125) is still
 * blocked on, so there's no "owned" field here yet.
 */

import { storage, syncGet } from '../storage/storage';

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CATALOG_URL       = `${SHAHNAMEH_ORIGIN}/api/catalog/heroes`;
const CACHE_KEY     = 'hero_catalog_v1';
const CACHE_TTL_KEY = 'hero_catalog_ttl_v1';
const CACHE_TTL_MS  = 6 * 3600 * 1_000; // static definition content — safe to cache for hours

export interface HeroCatalogEntry {
  slug:                string;
  name:                string;
  rarity:              string; // e.g. 'Mythic', 'Legendary', 'Epic'
  era:                 string;
  description:         string;
  image_url:           string; // already absolutized against SHAHNAMEH_ORIGIN
  power:                number;
  bonus:                string; // e.g. '+12% tap power'
  reward_bonus:         string; // e.g. '+38 REAL/hr'
  unlock_requirement:   string; // e.g. 'Reach Chapter 8'
}

interface RawCatalog {
  status: number;
  heroes: Array<{
    slug: string;
    name: string;
    rarity?: string;
    era?: string;
    description?: string;
    image_url?: string;
    power?: number;
    bonus?: string;
    reward_bonus?: string;
    unlock_requirement?: string;
    status?: string;
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
      power:              h.power ?? 0,
      bonus:              h.bonus ?? '',
      reward_bonus:       h.reward_bonus ?? '',
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
