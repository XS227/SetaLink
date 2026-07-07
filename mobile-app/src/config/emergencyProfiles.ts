/**
 * Built-in emergency profiles — last-resort fallback when:
 *   - No user profile has been imported
 *   - All imported profiles failed
 *   - Remote bootstrap fetch failed
 *
 * Goal: Install → Open → Connect, zero user action required.
 *
 * Last-resort only: used when BOTH the bootstrap fetch and its cache are
 * unavailable. Active server: Finland Helsinki (65.109.183.7) — the Reality
 * node proven reachable from Iran (the Hetzner DE IP is blocked there, and the
 * old 178.104.77.231 became the trading VPS after the 2026-07-06 IP swap, so
 * pointing here would connect to the wrong box).
 * Primary inbound: Cloudflare-SNI :443 (XTLS Vision).
 * WS/XHTTP/HTTPUpgrade: edge.setalink.no (nginx TLS proxy).
 */

import { storage, syncGet } from '../storage/storage';

const BOOTSTRAP_URL =
  'https://setalink.no/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1';

const BOOTSTRAP_CACHE_KEY = 'emergency_bootstrap_v6';

// vless://92a861cd-6029-4882-9de5-35d9291e0828@65.109.183.7:443?type=tcp&encryption=none&security=reality&pbk=eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU&fp=chrome&sni=www.cloudflare.com&sid=b3a824bd&flow=xtls-rprx-vision#Realink-Finland
const HARDCODED_PROFILE: EmergencyProfile = {
  id:          'server-emergency',
  label:       'Realink Finland',
  uuid:        '92a861cd-6029-4882-9de5-35d9291e0828',
  address:     '65.109.183.7',
  port:        443,
  publicKey:   'eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU',
  shortId:     'b3a824bd',
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
      // Germany Nuremberg (91.107.158.53) after the 2026-07-06 IP swap — flow=""
      // matches the x-ui inbound there. Blocked from Iran, but a valid EU fallback.
      uuid:        'fd709d48-a983-484a-99e3-afc97e2c3692',
      publicKey:   'IJXsDOA55gNiMZprjOdfaS6pN9ifm4MSqlsiZDGzki8',
      shortId:     'd93af82f2ecb7f6a',
      sni:         'www.cloudflare.com',
      port:        443,
      address:     '91.107.158.53',
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
