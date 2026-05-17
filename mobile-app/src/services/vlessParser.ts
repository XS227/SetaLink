// Parses vless:// share URIs including all Reality params: pbk, sid, fp, sni.
// Compatible with 3X-UI / Xray-core export format.

export type VlessNetwork  = 'tcp' | 'ws' | 'grpc' | 'httpupgrade' | 'splithttp';
export type VlessSecurity = 'reality' | 'tls' | 'none';

export interface ParsedVlessConfig {
  uuid:         string;
  address:      string;
  port:         number;
  name:         string;       // decoded URI fragment (#name)
  network:      VlessNetwork;
  security:     VlessSecurity;
  flow:         string;
  // Reality / TLS fields
  pbk?:         string;       // X25519 public key (base64)
  sid?:         string;       // Reality short ID
  fp?:          string;       // TLS fingerprint: chrome | firefox | safari | ios | android | …
  sni?:         string;       // server name indication
  // WebSocket / HTTPUpgrade / SplitHTTP
  path?:        string;
  host?:        string;
  // gRPC
  serviceName?: string;
}

export interface VlessParseError { error: string }
export type VlessParseResult = ParsedVlessConfig | VlessParseError;

export function isParseError(r: VlessParseResult): r is VlessParseError {
  return 'error' in r;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses a single vless:// URI.
 *
 * Reality params (security=reality): pbk, sid, fp, sni are all extracted.
 * TLS params (security=tls): sni, fp are extracted.
 * Transport (type=): tcp | ws | grpc | httpupgrade | splithttp.
 */
export function parseVlessUri(raw: string): VlessParseResult {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('vless://')) {
    return { error: 'Not a vless:// URI' };
  }

  try {
    // Extract fragment (#name) manually — URL() rejects the vless:// scheme
    const hashIdx = trimmed.indexOf('#');
    const name    = hashIdx >= 0 ? safeDecodeURIComponent(trimmed.slice(hashIdx + 1)) : '';
    const noFrag  = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;

    const body  = noFrag.slice('vless://'.length);

    // uuid@host:port?query
    const atIdx = body.indexOf('@');
    if (atIdx < 0) return { error: 'Missing @ separator between UUID and host' };

    const uuid     = body.slice(0, atIdx);
    const hostPart = body.slice(atIdx + 1);

    if (!UUID_RE.test(uuid)) return { error: `Invalid UUID: ${uuid}` };

    const qIdx     = hostPart.indexOf('?');
    const hostPort = qIdx >= 0 ? hostPart.slice(0, qIdx) : hostPart;
    const queryStr = qIdx >= 0 ? hostPart.slice(qIdx + 1) : '';

    const { address, port } = splitHostPort(hostPort);
    if (!address) return { error: 'Could not parse host:port' };

    const p        = parseQuery(queryStr);
    const security = (p.get('security') ?? 'none') as VlessSecurity;
    const network  = (p.get('type')     ?? 'tcp')  as VlessNetwork;
    const flow     = p.get('flow') ?? '';

    const cfg: ParsedVlessConfig = { uuid, address, port, name, network, security, flow };

    if (security === 'reality') {
      const pbk = p.get('pbk');
      if (!pbk) return { error: 'Reality URI missing pbk (public key)' };
      cfg.pbk = pbk;
      cfg.sid = p.get('sid') ?? '';
      cfg.fp  = p.get('fp')  ?? 'chrome';
      cfg.sni = p.get('sni') ?? '';
    } else if (security === 'tls') {
      cfg.sni = p.get('sni') ?? '';
      cfg.fp  = p.get('fp')  ?? '';
    }

    if (network === 'ws' || network === 'httpupgrade' || network === 'splithttp') {
      const rawPath = p.get('path');
      cfg.path = rawPath ? safeDecodeURIComponent(rawPath) : '/';
      cfg.host = p.get('host') ?? address;
    }

    if (network === 'grpc') {
      cfg.serviceName = p.get('serviceName') ?? '';
    }

    return cfg;
  } catch (e) {
    return { error: `Parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Parses every vless:// line from a newline-separated URI list.
 * Silently skips blank lines and unsupported schemes.
 */
export function parseUriList(text: string): ParsedVlessConfig[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('vless://'))
    .map((l) => parseVlessUri(l))
    .filter((r): r is ParsedVlessConfig => !isParseError(r));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitHostPort(s: string): { address: string; port: number } {
  if (s.startsWith('[')) {
    // IPv6: [::1]:443
    const end = s.indexOf(']');
    if (end < 0) return { address: '', port: 443 };
    return {
      address: s.slice(1, end),
      port:    Number(s.slice(end + 2)) || 443,
    };
  }
  const last = s.lastIndexOf(':');
  if (last < 0) return { address: s, port: 443 };
  return {
    address: s.slice(0, last),
    port:    Number(s.slice(last + 1)) || 443,
  };
}

function parseQuery(q: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!q) return m;
  for (const pair of q.split('&')) {
    const eq  = pair.indexOf('=');
    const key = eq >= 0 ? safeDecodeURIComponent(pair.slice(0, eq)) : pair;
    const val = eq >= 0 ? safeDecodeURIComponent(pair.slice(eq + 1)) : '';
    m.set(key, val);
  }
  return m;
}

function safeDecodeURIComponent(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
