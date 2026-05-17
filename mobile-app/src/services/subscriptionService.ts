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

function buildEntry(cfg: ParsedVlessConfig, index: number): ImportedServer {
  const isReality = cfg.security === 'reality';
  const protocol  =
    isReality           ? 'Reality'   :
    cfg.network === 'ws' ? 'WebSocket' : 'VLESS';

  const displayName = cfg.name || `${cfg.address}:${cfg.port}`;
  let country = displayName;
  let city    = cfg.address;

  if (displayName.includes(' - ')) {
    [country, city] = displayName.split(' - ', 2) as [string, string];
  }

  const flag = extractFlag(displayName) ?? '⚡';
  const id   = `sub-${index}-${cfg.address.replace(/[^a-zA-Z0-9]/g, '-')}-${cfg.port}`;

  const record: ServerRecord = {
    id,
    country: country.trim(),
    city:    city.trim() || cfg.address,
    flag,
    ping:    0,
    load:    0,
    protocol,
    tags:    isReality ? ['Stealth'] : [],
    premium: false,
  };

  const creds: ServerCredentials = {
    uuid:      cfg.uuid,
    address:   cfg.address,
    port:      cfg.port,
    publicKey: cfg.pbk ?? '',
    shortId:   cfg.sid ?? '',
    sni:       cfg.sni ?? cfg.address,
  };

  return { record, creds };
}

function extractFlag(s: string): string | null {
  // Match a Unicode regional indicator pair (emoji flag)
  const m = s.match(/\p{Regional_Indicator}{2}/u);
  return m?.[0] ?? null;
}
