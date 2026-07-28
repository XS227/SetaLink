/**
 * Clan browse — the public half of Shahnameh's guild system (`docs/realgram/
 * TASK_SPLIT.md` A→B(125) roadmap: Clan/Guild).
 *
 * `/api/season2/clan/browse` is confirmed live public (no telegram_id
 * needed) — a directory of existing clans. "My clan" / join / apply /
 * contribute all need the telegram_id identity bridge A→B(125) is still
 * blocked on, so this is browse-only for now, same split as chapters/heroes.
 * Distinct from RealGramClanScreen (the Clan TAB, deliberately redesigned
 * 2026-07-22 around RealGram's own community features, not a guild reskin)
 * — this is the actual Shahnameh guild directory, a separate page.
 */

const SHAHNAMEH_ORIGIN = 'https://shahnameh.setaei.com';
const CACHE_TTL_MS = 60_000;

export interface ClanListing {
  clan_id:           string;
  clan_name:         string;
  motto:             string;
  member_count:      number;
  total_real_earned: number;
  clan_photo:        string; // already absolutized against SHAHNAMEH_ORIGIN
  leader_name:       string;
  user_status:       string; // 'none' | 'member' | 'pending' | ... (server-defined)
}

let _cache: { data: ClanListing[]; expiresAt: number } | null = null;

export async function getClanDirectory(): Promise<ClanListing[]> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/clan/browse`, { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1 || !Array.isArray(json.clans)) return _cache?.data ?? [];
    const data: ClanListing[] = json.clans.map((c: any) => ({
      clan_id:           c.clan_id,
      clan_name:         c.clan_name,
      motto:             c.motto ?? '',
      member_count:      c.member_count ?? 0,
      total_real_earned: c.total_real_earned ?? 0,
      clan_photo:        c.clan_photo ? (String(c.clan_photo).startsWith('http') ? c.clan_photo : `${SHAHNAMEH_ORIGIN}${c.clan_photo}`) : '',
      leader_name:       c.leader_name ?? '',
      user_status:       c.user_status ?? 'none',
    }));
    _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  } catch {
    return _cache?.data ?? [];
  }
}
