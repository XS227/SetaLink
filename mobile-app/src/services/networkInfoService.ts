/**
 * Network info service — resolves the device's local IP and the VPN exit (public) IP.
 *
 * Local IP:   react-native-network-info (installed dep)
 * Public IP:  lightweight fetch to api64.ipify.org (JSON, ~300 B response)
 *             Falls back gracefully when offline or blocked.
 *
 * Both results are cached for 60 s to avoid hammering the network on every
 * DiagnosticsScreen render cycle.
 */

export interface NetworkInfo {
  localIp:  string | null;
  publicIp: string | null;
}

const CACHE_TTL_MS  = 60_000;
const PUBLIC_IP_URL = 'https://api64.ipify.org?format=json';

let _cache:      NetworkInfo | null = null;
let _cacheExpiry = 0;

export async function getNetworkInfo(): Promise<NetworkInfo> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  const [localIp, publicIp] = await Promise.all([
    fetchLocalIp(),
    fetchPublicIp(),
  ]);

  _cache      = { localIp, publicIp };
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return _cache;
}

export function clearNetworkInfoCache(): void {
  _cache      = null;
  _cacheExpiry = 0;
}

async function fetchLocalIp(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NetworkInfo } = require('react-native-network-info');
    const ip = await NetworkInfo.getIPV4Address();
    return typeof ip === 'string' && ip.length > 0 ? ip : null;
  } catch {
    return null;
  }
}

async function fetchPublicIp(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 4000);

    const res  = await fetch(PUBLIC_IP_URL, { signal: controller.signal });
    clearTimeout(timeout);

    const json = await res.json() as { ip?: string };
    return json.ip ?? null;
  } catch {
    return null;
  }
}
