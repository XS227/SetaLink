// Fetches a Xray subscription URL and imports the encoded VLESS URI list.
//
// A subscription response is a base64-encoded text block where each line is
// a share URI (vless://, vmess://, etc.). This service handles fetch, decode,
// and parse — returning typed entries ready for the server store.

import { parseUriList, type ParsedVlessConfig } from './vlessParser';
import type { ServerCredentials }               from './serverConfigService';
import type { ServerRecord }                    from '../stores/serverStore';

export interface ImportedServer {
  record: ServerRecord;
  creds:  ServerCredentials;
}

export interface SubscriptionResult {
  servers: ImportedServer[];
  errors:  number;
  total:   number;
}

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Fetches a subscription URL, decodes the base64 body, and parses VLESS URIs.
 *
 * Returns ready-to-import server records + credentials.
 * Throws on network / HTTP failure so the caller can surface an error toast.
 */
export async function fetchSubscription(url: string): Promise<SubscriptionResult> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let rawBody: string;
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Xray/1.8.0', 'Accept': 'text/plain' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} from subscription URL`);
    rawBody = await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  const decoded = decodeSubscriptionBody(rawBody.trim());
  const lines   = decoded.split(/\r?\n/).map((l) => l.trim());
  const vlessLines = lines.filter((l) => l.startsWith('vless://'));

  const configs = parseUriList(decoded);
  const errors  = vlessLines.length - configs.length;
  _nameCount.clear();
  const servers = configs.map((cfg, i) => buildEntry(cfg, i));

  return { servers, errors, total: vlessLines.length };
}

/**
 * Parses a single vless:// URI string into an import entry.
 * Used for the manual "paste VLESS link" import flow.
 */
export function parseSingleVless(uri: string): ImportedServer | null {
  const { parseVlessUri, isParseError } = require('./vlessParser') as typeof import('./vlessParser');
  const result = parseVlessUri(uri.trim());
  if (isParseError(result)) return null;
  return buildEntry(result, 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function decodeSubscriptionBody(body: string): string {
  try {
    // Normalize URL-safe base64 → standard, then decode
    return atob(body.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    // Some providers send plain text without base64
    return body;
  }
}

// City hints from hostname / address patterns
const CITY_PATTERNS: Array<{ pattern: RegExp; city: string }> = [
  { pattern: /\b(frankfurt|fra\d*|fkb)\b/i,       city: 'Frankfurt'  },
  { pattern: /\b(helsinki|hel\d*)\b/i,             city: 'Helsinki'   },
  { pattern: /\b(amsterdam|ams\d*)\b/i,            city: 'Amsterdam'  },
  { pattern: /\b(paris|cdg|par\d*)\b/i,            city: 'Paris'      },
  { pattern: /\b(london|lon\d*|lhr)\b/i,           city: 'London'     },
  { pattern: /\b(virginia|ash\d*|iad)\b/i,         city: 'Virginia'   },
  { pattern: /\b(oregon|pdx)\b/i,                  city: 'Oregon'     },
  { pattern: /\b(ohio|cmh)\b/i,                    city: 'Ohio'       },
  { pattern: /\b(california|lax|sfo)\b/i,          city: 'California' },
  { pattern: /\b(singapore|sin\d*|sgp)\b/i,        city: 'Singapore'  },
  { pattern: /\b(tokyo|nrt|tyo)\b/i,               city: 'Tokyo'      },
  { pattern: /\b(istanbul|ist\d*)\b/i,             city: 'Istanbul'   },
  { pattern: /\b(stockholm|sto\d*|arlanda)\b/i,   city: 'Stockholm'  },
  { pattern: /\b(zurich|zrh|zur\d*)\b/i,           city: 'Zürich'     },
  { pattern: /\b(toronto|yyz|yto)\b/i,             city: 'Toronto'    },
  { pattern: /\b(sydney|syd\d*)\b/i,               city: 'Sydney'     },
  { pattern: /\b(tehran|thr)\b/i,                  city: 'Tehran'     },
  { pattern: /\b(berlin|ber\d*)\b/i,               city: 'Berlin'     },
  { pattern: /\b(munich|muc\d*)\b/i,               city: 'Munich'     },
  { pattern: /\b(warsaw|waw\d*)\b/i,               city: 'Warsaw'     },
  { pattern: /\b(dubai|dxb)\b/i,                   city: 'Dubai'      },
  { pattern: /\b(seoul|icn|sel)\b/i,               city: 'Seoul'      },
];

function detectCity(address: string): string | null {
  for (const { pattern, city } of CITY_PATTERNS) {
    if (pattern.test(address)) return city;
  }
  return null;
}

// Provider detection — ordered by hostname suffix specificity
const PROVIDER_PATTERNS: Array<{ pattern: RegExp; label: string; flag: string }> = [
  { pattern: /\.oracle\.com$/i,                             label: 'Oracle',       flag: '☁️' },
  { pattern: /\.amazonaws\.com$/i,                          label: 'AWS',          flag: '☁️' },
  { pattern: /compute\.amazonaws\.com$/i,                   label: 'AWS',          flag: '☁️' },
  { pattern: /hetzner\.(com|cloud|de)$/i,                   label: 'Hetzner',      flag: '🇩🇪' },
  { pattern: /\.hetzner\.cloud$/i,                          label: 'Hetzner',      flag: '🇩🇪' },
  { pattern: /cloudflare\.com$/i,                           label: 'Cloudflare',   flag: '🌐' },
  { pattern: /vultr\.com$/i,                                label: 'Vultr',        flag: '☁️' },
  { pattern: /linode\.com$|linodeobjects\.com$/i,           label: 'Linode',       flag: '☁️' },
  { pattern: /digitalocean\.com$/i,                         label: 'DigitalOcean', flag: '☁️' },
  { pattern: /ovh\.(net|com)$/i,                            label: 'OVH',          flag: '🇫🇷' },
  { pattern: /contabo\.(com|net)$/i,                        label: 'Contabo',      flag: '🇩🇪' },
  { pattern: /hostinger\.com$/i,                            label: 'Hostinger',    flag: '☁️' },
];

// Country hints from common hostname patterns
const COUNTRY_PATTERNS: Array<{ pattern: RegExp; country: string; flag: string }> = [
  { pattern: /\b(de|germany|frankfurt|berlin)\b/i, country: 'Germany',     flag: '🇩🇪' },
  { pattern: /\b(nl|netherlands|amsterdam)\b/i,     country: 'Netherlands', flag: '🇳🇱' },
  { pattern: /\b(fi|finland|helsinki)\b/i,          country: 'Finland',     flag: '🇫🇮' },
  { pattern: /\b(fr|france|paris)\b/i,              country: 'France',      flag: '🇫🇷' },
  { pattern: /\b(uk|gb|england|london)\b/i,         country: 'UK',          flag: '🇬🇧' },
  { pattern: /\b(us|usa|united.states|virginia|oregon|ohio|california)\b/i, country: 'US', flag: '🇺🇸' },
  { pattern: /\b(sg|singapore)\b/i,                 country: 'Singapore',   flag: '🇸🇬' },
  { pattern: /\b(jp|japan|tokyo)\b/i,               country: 'Japan',       flag: '🇯🇵' },
  { pattern: /\b(tr|turkey|istanbul)\b/i,           country: 'Turkey',      flag: '🇹🇷' },
  { pattern: /\b(se|sweden|stockholm)\b/i,          country: 'Sweden',      flag: '🇸🇪' },
  { pattern: /\b(ch|switzerland|zurich)\b/i,        country: 'Switzerland', flag: '🇨🇭' },
  { pattern: /\b(ca|canada|toronto|montreal)\b/i,   country: 'Canada',      flag: '🇨🇦' },
  { pattern: /\b(au|australia|sydney|melbourne)\b/i,country: 'Australia',   flag: '🇦🇺' },
  { pattern: /\b(ir|iran|tehran)\b/i,               country: 'Iran',        flag: '🇮🇷' },
];

function detectProvider(address: string): { label: string; flag: string } | null {
  for (const { pattern, label, flag } of PROVIDER_PATTERNS) {
    if (pattern.test(address)) return { label, flag };
  }
  return null;
}

function detectCountry(text: string): { country: string; flag: string } | null {
  for (const { pattern, country, flag } of COUNTRY_PATTERNS) {
    if (pattern.test(text)) return { country, flag };
  }
  return null;
}

// Global dedup counter across a single import batch
const _nameCount: Map<string, number> = new Map();

function dedupeTitle(base: string): string {
  const count = (_nameCount.get(base) ?? 0) + 1;
  _nameCount.set(base, count);
  return `${base} ${count}`;
}

function buildEntry(cfg: ParsedVlessConfig, index: number): ImportedServer {
  const isReality = cfg.security === 'reality';
  const protocol  =
    isReality            ? 'Reality'   :
    cfg.network === 'ws' ? 'WebSocket' : 'VLESS';

  const rawName = cfg.name ?? '';
  const isIp    = /^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.address);

  // 1. Detect provider and country
  const provider           = detectProvider(cfg.address);
  const countryFromName    = rawName ? detectCountry(rawName)    : null;
  const countryFromAddress = detectCountry(cfg.address);
  const countryInfo        = countryFromName ?? countryFromAddress;

  // 2. Build display name in "SetaLink X N" format (max ~22 chars before dedup)
  let titleBase: string;
  let flagChar: string;

  if (provider) {
    // Known cloud/hosting provider: "SetaLink Oracle", "SetaLink Hetzner"
    titleBase = `SetaLink ${provider.label}`;
    flagChar  = countryInfo?.flag ?? provider.flag;
  } else if (countryInfo) {
    // Detected country: "SetaLink Germany", "SetaLink Finland"
    titleBase = `SetaLink ${countryInfo.country}`;
    flagChar  = countryInfo.flag;
  } else if (rawName && rawName.length <= 32 && !rawName.includes(':')) {
    // Fragment is a user-given label — use up to 14 chars after stripping flags
    const stripped = rawName.replace(/\p{Regional_Indicator}{2}/gu, '').trim();
    titleBase = stripped.length > 1 ? `SetaLink ${stripped.slice(0, 14)}` : 'SetaLink Custom';
    flagChar  = extractFlag(rawName) ?? '⚡';
  } else {
    titleBase = 'SetaLink Custom';
    flagChar  = '⚡';
  }

  const country = dedupeTitle(titleBase);

  // 3. City: human-readable location, never the raw IP/hostname
  const cityFromAddress = detectCity(cfg.address);
  const cityFromName    = rawName ? detectCity(rawName) : null;
  let city: string;

  if (cityFromName) {
    city = cityFromName;
  } else if (cityFromAddress) {
    city = cityFromAddress;
  } else if (countryInfo) {
    city = countryInfo.country;
  } else if (provider) {
    city = provider.label;
  } else if (!isIp) {
    // Hostname but no location hint — show cleaned domain without TLD
    const hostParts = cfg.address.replace(/:\d+$/, '').split('.');
    const meaningful = hostParts.find((p) => p.length > 3 && !/^\d+$/.test(p));
    city = meaningful ? meaningful.charAt(0).toUpperCase() + meaningful.slice(1) : 'Custom';
  } else {
    city = 'Custom Server';
  }

  const id = `sub-${index}-${cfg.address.replace(/[^a-zA-Z0-9]/g, '-')}-${cfg.port}`;

  const record: ServerRecord = {
    id,
    country,
    city,
    flag: flagChar,
    ping:    0,
    load:    0,
    protocol,
    tags:    isReality ? ['Stealth'] : [],
    premium: false,
  };

  const creds: ServerCredentials = {
    uuid:        cfg.uuid,
    address:     cfg.address,
    port:        cfg.port,
    publicKey:   cfg.pbk  ?? '',
    shortId:     cfg.sid  ?? '',
    // Use || (not ??) so empty string from the parser also falls back
    sni:         cfg.sni  || '',
    flow:        cfg.flow || '',
    fingerprint: cfg.fp   || 'chrome',
  };

  return { record, creds };
}

function extractFlag(s: string): string | null {
  const m = s.match(/\p{Regional_Indicator}{2}/u);
  return m?.[0] ?? null;
}
