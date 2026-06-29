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

import { storage, syncGet } from '../storage/storage';

const REMOTE_CONFIG_URL =
  'https://setalink.no/api.php?mobile=1&action=remote-config&_token=setalink-mobile-diag-v1';

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
  support_url:      string;           // Telegram or web support link
  edge_host:        string;           // nginx edge proxy hostname for WS/XHTTP transports
  emergency_profiles?: any[];         // pushed via admin, takes priority over hardcoded
  stealth_profiles?:   any[];         // stealth server configs
  update_required?:    boolean;
  min_supported_version?: string;

  // ── Adaptive network flags ────────────────────────────────────────────
  /** Max additional nodes to try on failover after the primary fails. Default: 2. */
  failover_max_nodes?: number;
  /** Node IDs to skip entirely during auto-selection and failover. */
  nodes_disabled?: string[];
  /** Set false to pause anonymous connect telemetry uploads. Default: true. */
  telemetry_enabled?: boolean;
  /** Fractional rollout per feature ID (0.0 – 1.0). */
  rollout?: Record<string, number>;
  /** Enable verbose logging for this platform ('ios' | 'android' | null). */
  extra_logging_platform?: string | null;
  /** Enable verbose logging for this specific node ID (null = all nodes). */
  extra_logging_node?: string | null;
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
  ttl:         3600,
  updated_at:  '',
  support_url: 'https://t.me/setalink_support',
  edge_host:   'edge.setalink.no',
};

let _inFlight: Promise<RemoteConfig> | null = null;

export async function getRemoteConfig(): Promise<RemoteConfig> {
  // Serve from cache if not expired
  const cached  = syncGet(CACHE_KEY);
  const ttlStr  = syncGet(CACHE_TTL_KEY);
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
  const cached = syncGet(CACHE_KEY);
  if (cached) {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(cached) }; } catch {}
  }
  return DEFAULT_CONFIG;
}

export function isKillSwitched(sni: string, protocol: string, cfg: RemoteConfig): boolean {
  return cfg.kill_switches.some(ks => ks === sni || ks === protocol || ks === `${protocol}/${sni}`);
}

/** Synchronously return the last-cached config without waiting for a fetch. */
export function getCachedConfig(): RemoteConfig {
  const cached = syncGet(CACHE_KEY);
  if (cached) {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(cached) }; } catch {}
  }
  return DEFAULT_CONFIG;
}

/**
 * Deterministic per-device rollout gate.
 * Returns true if this device should receive the feature.
 * fraction=1 → everyone, fraction=0 → nobody.
 */
export function isInRollout(featureId: string, cfg: RemoteConfig, deviceId?: string): boolean {
  const fraction = cfg.rollout?.[featureId];
  if (fraction === undefined || fraction >= 1.0) return true;
  if (fraction <= 0) return false;
  if (!deviceId) return Math.random() < fraction;
  // Stable per-device hash: sum of char codes mod 100
  const seed = `${deviceId}:${featureId}`;
  const hash = [...seed].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (hash % 100) < fraction * 100;
}

/** Force a fresh fetch on next call (e.g. after VPN failure). */
export function invalidateRemoteConfig(): void {
  storage.removeItem(CACHE_TTL_KEY);
}
