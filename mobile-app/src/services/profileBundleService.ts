/**
 * Profile bundle service — fetches and caches the admin-published routing bundle.
 *
 * The bundle is a JSON file published at setalink.no/api.php?action=profile-bundle
 * and contains:
 *   - Multiple VPN profiles (Reality, XHTTP, WS, SNI-Spoof candidates)
 *   - SNI priority list (replaces remote config sni_priorities)
 *   - SNI spoof candidates (used for Reality + fake-SNI profiles)
 *   - Backup IPs and domains
 *
 * This enables the admin to update routing strategy without an APK update.
 * The bundle is cached for 6 hours in MMKV; stale cache is used on network error.
 */

import { storage } from '../storage/storage';

const BUNDLE_URL = 'https://setalink.no/api.php?mobile=1&action=profile-bundle&_token=setalink-mobile-diag-v1';
const CACHE_KEY  = 'profile_bundle_v2';
const TTL_MS     = 6 * 60 * 60 * 1000; // 6 hours

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BundleProfile {
  id:           string;
  label:        string;
  type:         'reality' | 'xhttp' | 'websocket' | 'httpupgrade' | 'sni-spoof';
  uuid:         string;
  address:      string;
  port:         number;
  sni:          string;
  publicKey?:   string;
  shortId?:     string;
  flow?:        string;
  fingerprint:  string;
  edgeAddress?: string;
  edgePort?:    number;
  wsPath?:      string;
  xhttpPath?:   string;
  httpupPath?:  string;
  priority:     number;   // lower = higher priority
}

export interface ProfileBundle {
  version:        number;
  published_at:   string;
  sni_candidates: string[];           // Reality SNI priority order
  spoof_snis:     string[];           // Extra SNI variants for stealth mode
  backup_ips:     string[];
  backup_domains: string[];
  profiles:       BundleProfile[];    // Explicit profile overrides (optional)
}

interface CachedBundle {
  bundle:    ProfileBundle;
  fetchedAt: number;
}

// ── Hardcoded defaults (used when no bundle is available) ─────────────────────

const DEFAULT_BUNDLE: ProfileBundle = {
  version:        1,
  published_at:   '2026-05-19',
  sni_candidates: [
    'www.microsoft.com', 'www.bing.com', 'www.apple.com',
    'www.samsung.com', 'www.speedtest.net',
  ],
  spoof_snis: [
    'auth.vercel.com',
    'cdn.jsdelivr.net',
    'hcaptcha.com',
    'assets.vercel.com',
    'images.unsplash.com',
    'cloudflare.com',
  ],
  backup_ips:     ['5.249.252.221'],
  backup_domains: ['edge.setalink.no'],
  profiles:       [],
};

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readCache(): CachedBundle | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (typeof raw === 'string' && raw) return JSON.parse(raw) as CachedBundle;
  } catch {}
  return null;
}

function writeCache(bundle: ProfileBundle): void {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ bundle, fetchedAt: Date.now() } satisfies CachedBundle));
  } catch {}
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchBundle(): Promise<ProfileBundle | null> {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10_000);
    const res  = await fetch(BUNDLE_URL, { signal: ctrl.signal });
    clearTimeout(tid);
    const json = await res.json() as { ok: boolean; data?: ProfileBundle };
    if (json.ok && json.data?.version) {
      writeCache(json.data);
      return json.data;
    }
  } catch {}
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

let _bundle: ProfileBundle | null = null;

/** Returns cached bundle synchronously, or null if not yet loaded. */
export function getBundleSync(): ProfileBundle {
  if (_bundle) return _bundle;
  const cached = readCache();
  if (cached) {
    _bundle = cached.bundle;
    return cached.bundle;
  }
  return DEFAULT_BUNDLE;
}

/**
 * Returns bundle, refreshing from server if cache is stale.
 * Falls back to stale cache or hardcoded defaults on network error.
 */
export async function getBundle(): Promise<ProfileBundle> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    _bundle = cached.bundle;
    return cached.bundle;
  }
  const fresh = await fetchBundle();
  if (fresh) {
    _bundle = fresh;
    return fresh;
  }
  if (cached) {
    _bundle = cached.bundle;
    return cached.bundle; // stale but usable
  }
  return DEFAULT_BUNDLE;
}

/** SNI candidates for Reality profiles, in priority order. */
export async function getSniCandidates(): Promise<string[]> {
  const b = await getBundle();
  return b.sni_candidates.length > 0 ? b.sni_candidates : DEFAULT_BUNDLE.sni_candidates;
}

/** SNI spoof candidates — extra fake domains for stealth Reality profiles. */
export async function getSpoofSnis(): Promise<string[]> {
  const b = await getBundle();
  return b.spoof_snis.length > 0 ? b.spoof_snis : DEFAULT_BUNDLE.spoof_snis;
}

/** Synchronous spoof SNIs (for use in non-async profile builders). */
export function getSpoofSnisSync(): string[] {
  return getBundleSync().spoof_snis.length > 0
    ? getBundleSync().spoof_snis
    : DEFAULT_BUNDLE.spoof_snis;
}

/** Synchronous SNI candidates. */
export function getSniCandidatesSync(): string[] {
  return getBundleSync().sni_candidates.length > 0
    ? getBundleSync().sni_candidates
    : DEFAULT_BUNDLE.sni_candidates;
}

/** Refresh bundle in the background — call on app boot. */
export function prefetchBundle(): void {
  getBundle().catch(() => {});
}
