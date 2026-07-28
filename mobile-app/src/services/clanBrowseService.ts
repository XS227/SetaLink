/**
 * Clan — Shahnameh's guild system (`docs/realgram/TASK_SPLIT.md` A→B(125)
 * roadmap: Clan/Guild).
 *
 * `/api/season2/clan/browse` is confirmed live public (no telegram_id
 * needed) — a directory of existing clans, `user_status` per clan is
 * generic ('none' for everyone) without one. Passing telegram_id (now
 * available via ssoService per B->A(132)) makes user_status reflect the
 * caller's real membership/pending state, and unlocks `getMyClan`/
 * `applyToClan` — the actions that genuinely needed the identity bridge.
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
  user_status:       string; // 'none' | 'member' | 'pending' | 'leader' — generic 'none' without telegram_id
}

export interface MyClan {
  clan_id:      string;
  clan_name:    string;
  motto:        string;
  member_count: number;
  clan_photo:   string;
  treasury:     number;
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; error: string };

function normalizeClan(c: any): ClanListing {
  return {
    clan_id:           c.clan_id,
    clan_name:         c.clan_name,
    motto:             c.motto ?? '',
    member_count:      c.member_count ?? 0,
    total_real_earned: c.total_real_earned ?? 0,
    clan_photo:        c.clan_photo ? (String(c.clan_photo).startsWith('http') ? c.clan_photo : `${SHAHNAMEH_ORIGIN}${c.clan_photo}`) : '',
    leader_name:       c.leader_name ?? '',
    user_status:       c.user_status ?? 'none',
  };
}

// Only the anonymous (no telegram_id) call is cached — once identity is
// known the result is per-caller, not worth a cache-key scheme for a
// screen that's opened rarely and needs to reflect a just-submitted apply
// immediately.
let _anonCache: { data: ClanListing[]; expiresAt: number } | null = null;

export async function getClanDirectory(telegramId?: string): Promise<ClanListing[]> {
  if (!telegramId && _anonCache && Date.now() < _anonCache.expiresAt) return _anonCache.data;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const qs = telegramId ? `?telegram_id=${encodeURIComponent(telegramId)}` : '';
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/clan/browse${qs}`, { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1 || !Array.isArray(json.clans)) return telegramId ? [] : (_anonCache?.data ?? []);
    const data = json.clans.map(normalizeClan);
    if (!telegramId) _anonCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  } catch {
    return telegramId ? [] : (_anonCache?.data ?? []);
  }
}

export async function getMyClan(telegramId: string): Promise<MyClan | null> {
  if (!telegramId) return null;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(
      `${SHAHNAMEH_ORIGIN}/api/season2/clan/my-clan?telegram_id=${encodeURIComponent(telegramId)}`,
      { signal: controller.signal },
    );
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status !== 1 || !json.clan) return null;
    const c = json.clan;
    return {
      clan_id:      c.clan_id,
      clan_name:    c.clan_name,
      motto:        c.motto ?? '',
      member_count: c.member_count ?? 0,
      clan_photo:   c.clan_photo ? (String(c.clan_photo).startsWith('http') ? c.clan_photo : `${SHAHNAMEH_ORIGIN}${c.clan_photo}`) : '',
      treasury:     c.treasury ?? 0,
    };
  } catch {
    return null;
  }
}

/** Errors match guild.html/social.html's own known set (season2/social.js) —
 *  mapped to friendly copy by the caller, not here. */
export async function applyToClan(telegramId: string, clanId: string): Promise<ApplyResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/clan/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, clan_id: clanId }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status === 1) return { ok: true };
    return { ok: false, error: String(json?.error ?? 'unknown_error') };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

// ── Create clan (2026-07-28, Khabat: "cta knapp for å bygge ny clan") ──────
// `routes/api/season2.js`'s `/clan/create` — 50,000 REAL, name 3-30 chars,
// no `<>{}[]\|^`$@%` (matches its own validation exactly so the client can
// give the same feedback without waiting on a round trip for the common
// cases; the server re-validates regardless, this is UX only).
export const CLAN_CREATE_COST = 50_000;
const CLAN_NAME_MIN = 3;
const CLAN_NAME_MAX = 30;
const CLAN_NAME_BAD_CHARS = /[<>{}[\]\\|^`$@%]/;

export function validateClanNameLocally(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < CLAN_NAME_MIN) return 'too_short';
  if (trimmed.length > CLAN_NAME_MAX) return 'too_long';
  if (CLAN_NAME_BAD_CHARS.test(trimmed)) return 'invalid_chars';
  return null;
}

export async function checkClanNameAvailable(name: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/clan/check-name?name=${encodeURIComponent(name.trim())}`, { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json();
    return json?.status === 1 && json.available === true;
  } catch {
    return false;
  }
}

export type CreateClanResult =
  | { ok: true; clan_id: string }
  | { ok: false; error: string; need?: number; have?: number };

export async function createClan(telegramId: string, clanName: string, motto: string): Promise<CreateClanResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SHAHNAMEH_ORIGIN}/api/season2/clan/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, clan_name: clanName.trim(), motto: motto.trim() }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json?.status === 1 && json.clan?.clan_id) return { ok: true, clan_id: json.clan.clan_id };
    return { ok: false, error: String(json?.error ?? 'unknown_error'), need: json?.need, have: json?.have };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
