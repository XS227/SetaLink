/**
 * Built-in emergency profiles — last-resort fallback when:
 *   - No user profile has been imported
 *   - All imported profiles failed
 *   - Remote bootstrap fetch failed
 *
 * Goal: Install → Open → Connect, zero user action required.
 *
 * Active server: Hetzner Nuremberg DE (178.104.77.231)
 * Primary inbound: SetaLink-Cloudflare :443 (XTLS Vision, Cloudflare SNI)
 * Alt inbound:     SetaLink-Microsoft :443 (XTLS Vision, Microsoft SNI)
 *
 * WS/XHTTP/HTTPUpgrade: edge.setalink.no (nginx TLS proxy)
 */

import { storage, syncGet } from '../storage/storage';

const BOOTSTRAP_URL =
  'https://setalink.no/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1';

const BOOTSTRAP_CACHE_KEY = 'emergency_bootstrap_v6';

// vless://b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3@178.104.77.231:443?type=tcp&encryption=none&security=reality&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&fp=chrome&sni=www.cloudflare.com&sid=7f81892e&flow=xtls-rprx-vision#SetaLink-Cloudflare
const HARDCODED_PROFILE: EmergencyProfile = {
  id:          'server-emergency',
  label:       'Realink Hetzner DE',
  uuid:        'b5243b1c-af7a-40f0-ad31-97fc6f9ba3e3',
  address:     '178.104.77.231',
  port:        443,
  publicKey:   'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
  shortId:     '7f81892e',
  sni:         'www.cloudflare.com',
  flow:        'xtls-rprx-vision',
  fingerprint: 'chrome',
  edgeAddress: 'edge.setalink.no',
  edgePort:    443,
  wsPath:      '/ws',
  xhttpPath:   '/xhttp',
  httpupPath:  '/httpup',
  altProfiles: [
    {
      // vless://9280e04d-ffdb-45b4-9558-66b9d6f89b49@178.104.77.231:443?security=reality&pbk=Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU&sid=82ab1a310f0aeb06&sni=www.microsoft.com&flow=xtls-rprx-vision#SetaLink-Microsoft
      uuid:        '9280e04d-ffdb-45b4-9558-66b9d6f89b49',
      publicKey:   'Lt23oNYSse3ElAqCEWqTcFYCplvuLWsjsI7ZH7E_rGU',
      shortId:     '82ab1a310f0aeb06',
      sni:         'www.microsoft.com',
      port:        443,
      address:     '178.104.77.231',
      flow:        'xtls-rprx-vision',
      fingerprint: 'chrome',
    },
  ],
};

export interface AltProfile {
  uuid:         string;
  publicKey:    string;
  shortId:      string;
  sni:          string;
  port:         number;
  address?:     string;
  flow?:        string;
  fingerprint?: string;
}

export interface EmergencyProfile {
  id:          string;
  label:       string;
  uuid:        string;
  address:     string;
  port:        number;
  publicKey:   string;
  shortId:     string;
  sni:         string;
  flow:        string;
  fingerprint: string;
  edgeAddress?: string;
  edgePort?:    number;
  wsPath?:      string;
  xhttpPath?:   string;
  httpupPath?:  string;
  altProfiles?: AltProfile[];
}

/** Returns the bootstrapped emergency profile, or null if not available. */
export async function getEmergencyProfile(): Promise<EmergencyProfile | null> {
  // Try cached bootstrap first
  const cached = syncGet(BOOTSTRAP_CACHE_KEY);
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

  // Always fall back to the hardcoded working profile
  return HARDCODED_PROFILE;
}

/** Call after a successful connection to update the cached bootstrap. */
export function cacheEmergencyProfile(profile: EmergencyProfile): void {
  try { storage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(profile)); } catch {}
}

export function clearCachedEmergencyProfile(): void {
  storage.removeItem(BOOTSTRAP_CACHE_KEY);
}
