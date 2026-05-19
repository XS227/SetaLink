/**
 * Built-in emergency profiles — last-resort fallback when:
 *   - No user profile has been imported
 *   - All imported profiles failed
 *   - Remote bootstrap fetch failed
 *
 * Goal: Install → Open → Connect, zero user action required.
 *
 * NOTE: Set EMERGENCY_UUID, EMERGENCY_PUBLIC_KEY, EMERGENCY_SHORT_ID
 * and EMERGENCY_SERVER_ADDRESS to your real server credentials.
 * These are loaded from the EMERGENCY_* env vars baked in at build time,
 * or from the remote bootstrap endpoint if available.
 */

import { storage } from '../storage/storage';

const BOOTSTRAP_URL =
  'https://setalink.no/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1';

const BOOTSTRAP_CACHE_KEY = 'emergency_bootstrap_v3';

export interface EmergencyProfile {
  id:          string;
  label:       string;
  uuid:        string;
  address:     string;   // Reality/VPN server (port 8443)
  port:        number;
  publicKey:   string;
  shortId:     string;
  sni:         string;
  flow:        string;
  fingerprint: string;
  // Edge transport fields (populated from bootstrap API)
  edgeAddress?: string;  // nginx proxy host (e.g. edge.setalink.no)
  edgePort?:    number;
  wsPath?:      string;
  xhttpPath?:   string;
  httpupPath?:  string;
}

/** Returns the bootstrapped emergency profile, or null if not available. */
export async function getEmergencyProfile(): Promise<EmergencyProfile | null> {
  // Try cached bootstrap first
  const cached = storage.getItem(BOOTSTRAP_CACHE_KEY);
  if (cached) {
    try {
      const p = JSON.parse(cached) as EmergencyProfile;
      if (p.uuid && p.publicKey && p.address) return p;
    } catch {}
  }

  // Fetch fresh bootstrap from admin
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 8_000);
    const res  = await fetch(BOOTSTRAP_URL, { signal: controller.signal });
    clearTimeout(tid);

    const json = await res.json() as { ok: boolean; data: EmergencyProfile };
    if (json.ok && json.data?.uuid && json.data?.publicKey) {
      storage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(json.data));
      return json.data;
    }
  } catch {}

  return null;
}

/** Call after a successful connection to update the cached bootstrap. */
export function cacheEmergencyProfile(profile: EmergencyProfile): void {
  try { storage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(profile)); } catch {}
}

export function clearCachedEmergencyProfile(): void {
  storage.removeItem(BOOTSTRAP_CACHE_KEY);
}
