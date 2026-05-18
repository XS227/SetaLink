/**
 * Remote config service — fetches dynamic configuration from the admin API.
 *
 * Enables the server to push:
 *   - SNI priority order
 *   - Kill-switches for broken routes
 *   - Protocol preference order
 *   - Emergency bootstrap profile
 *
 * The app works without a successful fetch (uses embedded defaults).
 * Config is cached in MMKV with a TTL so the app survives offline.
 */

import { storage } from '../storage/storage';

const REMOTE_CONFIG_URL =
  'https://admin.setalink.no/api.php?mobile=1&action=remote-config&_token=setalink-mobile-diag-v1';

const CACHE_KEY     = 'remote_config_v2';
const CACHE_TTL_KEY = 'remote_config_ttl_v2';

export interface RemoteConfig {
  version:          number;
  sni_priorities:   string[];         // ordered by effectiveness
  kill_switches:    string[];         // sni/protocol combos to skip
  protocol_order:   string[];         // Reality, XHTTP, WebSocket, etc.
  emergency_sni:    string;
  iran_sni_order:   string[];
  ttl:              number;           // seconds until stale
  updated_at:       string;
}

const DEFAULT_CONFIG: RemoteConfig = {
  version:        0,
  sni_priorities: [
    'www.microsoft.com', 'www.bing.com', 'www.apple.com',
    'www.samsung.com', 'www.speedtest.net',
  ],
  kill_switches:  [],
  protocol_order: ['Reality', 'XHTTP', 'WebSocket'],
  emergency_sni:  'www.microsoft.com',
  iran_sni_order: [
    'www.microsoft.com', 'www.bing.com', 'www.apple.com',
    'www.samsung.com', 'www.speedtest.net',
  ],
  ttl:        3600,
  updated_at: '',
};

let _inFlight: Promise<RemoteConfig> | null = null;

export async function getRemoteConfig(): Promise<RemoteConfig> {
  // Serve from cache if not expired
  const cached  = storage.getItem(CACHE_KEY);
  const ttlStr  = storage.getItem(CACHE_TTL_KEY);
  const expiry  = ttlStr ? parseInt(ttlStr, 10) : 0;

  if (cached && Date.now() < expiry) {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(cached) }; } catch {}
  }

  // Deduplicate concurrent fetches
  if (_inFlight) return _inFlight;
  _inFlight = _fetch().finally(() => { _inFlight = null; });
  return _inFlight;
}

async function _fetch(): Promise<RemoteConfig> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6_000);
    const res  = await fetch(REMOTE_CONFIG_URL, { signal: controller.signal });
    clearTimeout(tid);

    const json = await res.json() as { ok: boolean; data: Partial<RemoteConfig> };
    if (json.ok && json.data) {
      const cfg: RemoteConfig = { ...DEFAULT_CONFIG, ...json.data };
      storage.setItem(CACHE_KEY, JSON.stringify(cfg));
      storage.setItem(CACHE_TTL_KEY, String(Date.now() + (cfg.ttl || 3600) * 1_000));
      return cfg;
    }
  } catch { /* network unavailable — use cache or default */ }

  // Serve stale cache rather than default if available
  const cached = storage.getItem(CACHE_KEY);
  if (cached) {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(cached) }; } catch {}
  }
  return DEFAULT_CONFIG;
}

export function isKillSwitched(sni: string, protocol: string, cfg: RemoteConfig): boolean {
  return cfg.kill_switches.some(ks => ks === sni || ks === protocol || ks === `${protocol}/${sni}`);
}

/** Force a fresh fetch on next call (e.g. after VPN failure). */
export function invalidateRemoteConfig(): void {
  storage.removeItem(CACHE_TTL_KEY);
}
