/**
 * Built-in emergency profiles — last-resort fallback when:
 *   - No user profile has been imported
 *   - All imported profiles failed
 *   - Remote bootstrap fetch failed
 *
 * Goal: Install → Open → Connect, zero user action required.
 *
 * Active server: Hetzner Nuremberg DE (178.104.77.231)
 * Primary inbound: SetaLink-Cloudflare :443 (no XTLS Vision, Cloudflare SNI)
 * Alt inbounds:    SetaLink-Oracle :8443, SetaLink-Amazon :2052
 *
 * WS/XHTTP/HTTPUpgrade: edge.setalink.no → old server (UUID whitelisted)
 */

import { storage } from '../storage/storage';

const BOOTSTRAP_URL =
  'https://setalink.no/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1';

const BOOTSTRAP_CACHE_KEY = 'emergency_bootstrap_v4';

// vless://fd709d48-a983-484a-99e3-afc97e2c3692@178.104.77.231:443?type=tcp&encryption=none&security=reality&pbk=IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8&fp=chrome&sni=www.cloudflare.com&sid=d93af82f2ecb7f6a#SetaLink-Cloudflare
const HARDCODED_PROFILE: EmergencyProfile = {
  id:          'server-emergency',
  label:       'SetaLink Hetzner DE',
  uuid:        'fd709d48-a983-484a-99e3-afc97e2c3692',
  address:     '178.104.77.231',
  port:        443,
  publicKey:   'IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8',
  shortId:     'd93af82f2ecb7f6a',
  sni:         'www.cloudflare.com',
  flow:        '',
  fingerprint: 'chrome',
  edgeAddress: 'edge.setalink.no',
  edgePort:    443,
  wsPath:      '/ws',
  xhttpPath:   '/xhttp/',
  httpupPath:  '/httpup',
  altProfiles: [
    {
      // vless://c8af7366-b531-4f35-bea2-6fb70d1e4850@178.104.77.231:8443?security=reality&pbk=5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY&sid=70df7a&sni=www.oracle.com#SetaLink-Oracle
      uuid:        'c8af7366-b531-4f35-bea2-6fb70d1e4850',
      publicKey:   '5eItT4D3ZmR8Nit_JWjpm9XfX4CzZGzvhovxF4n_6CY',
      shortId:     '70df7a',
      sni:         'www.oracle.com',
      port:        8443,
      address:     '178.104.77.231',
      flow:        '',
      fingerprint: 'chrome',
    },
    {
      // vless://1580e282-be00-4ddc-932b-9bbcd69f0dad@178.104.77.231:2052?security=reality&pbk=Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo&sid=a4&sni=www.amazon.com#SetaLink-Amazon
      uuid:        '1580e282-be00-4ddc-932b-9bbcd69f0dad',
      publicKey:   'Wo4-Iz8anzOfnQye9L1ARwDElePwwLPq1b82A_ZEsjo',
      shortId:     'a4',
      sni:         'www.amazon.com',
      port:        2052,
      address:     '178.104.77.231',
      flow:        '',
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
