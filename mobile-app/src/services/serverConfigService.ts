// eslint-disable-next-line no-var
declare var btoa: (data: string) => string;

/**
 * Server config service — resolves per-server Xray credentials.
 *
 * In production this calls the SetaLink API:
 *   GET /api/v1/servers/{serverId}/config
 *   Authorization: Bearer {token}
 *
 * Returns signed short-lived credentials (UUID, Reality publicKey, shortId,
 * resolved address, port) that the xrayConfigBuilder embeds in the tunnel config.
 *
 * Currently returns deterministic mock credentials so the builder produces
 * a syntactically valid (if non-functional) config for local testing.
 */

// Secondary Reality inbound with independent keypair (different port/uuid/pubkey).
// Used for Hetzner's multi-inbound setup: Cloudflare :443, Oracle :8443, Amazon :2052.
export interface AltRealityProfile {
  uuid:         string;
  publicKey:    string;
  shortId:      string;
  sni:          string;
  port:         number;
  address?:     string;  // defaults to primary creds.address
  flow?:        string;
  fingerprint?: string;
}

export interface ServerCredentials {
  uuid:        string;
  address:     string;   // Reality/VPN server hostname
  port:        number;   // Primary Reality port
  publicKey:   string;   // X25519 Reality key
  shortId:     string;
  sni:         string;   // reality serverName
  flow:        string;   // e.g. 'xtls-rprx-vision' or '' for none
  fingerprint: string;   // TLS fingerprint: chrome | firefox | safari | …
  // Edge transport (WebSocket / XHTTP / HTTPUpgrade via nginx)
  edgeAddress?: string;  // nginx proxy host (e.g. edge.setalink.no)
  edgePort?:    number;  // nginx port (443)
  wsPath?:      string;  // WebSocket path (e.g. /ws)
  xhttpPath?:   string;  // XHTTP path (e.g. /xhttp/)
  httpupPath?:  string;  // HTTPUpgrade path (e.g. /httpup)
  // Additional Reality inbounds with separate keypairs (Hetzner multi-inbound)
  altProfiles?: AltRealityProfile[];
}

const CACHE_TTL_MS = 5 * 60_000;   // 5 min

interface CacheEntry { creds: ServerCredentials; expiry: number }
const _cache = new Map<string, CacheEntry>();

/** Fetch or return cached credentials for a server. */
export async function getServerCredentials(
  serverId:  string,
  authToken: string,
): Promise<ServerCredentials> {
  const cached = _cache.get(serverId);
  if (cached && Date.now() < cached.expiry) return cached.creds;

  const creds = await _fetchCredentials(serverId, authToken);
  _cache.set(serverId, { creds, expiry: Date.now() + CACHE_TTL_MS });
  return creds;
}

export function evictServerCache(serverId: string): void {
  _cache.delete(serverId);
}

async function _fetchCredentials(
  serverId:  string,
  authToken: string,
): Promise<ServerCredentials> {
  // Try real API first; fall through to mock on any failure or mock token
  if (authToken && !authToken.startsWith('mock-')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ServersAPI } = require('./api/servers.api');
      const data: Partial<ServerCredentials> = await ServersAPI.getConfig(serverId, authToken);
      if (data.uuid && data.publicKey) return data as ServerCredentials;
    } catch {}
  }

  // Mock fallback — deterministic from serverId so config stays stable in dev
  return _mockCredentials(serverId);
}

function _mockCredentials(serverId: string): ServerCredentials {
  // Deterministic fake credentials based on server ID for reproducibility
  const hash = serverId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hex  = (hash * 0xdeadbeef).toString(16).padStart(8, '0').slice(0, 8);

  return {
    uuid:        `00000000-0000-4000-8000-${hex.padEnd(12, '0')}`,
    address:     `${serverId}.edge.setalink.net`,
    port:        443,
    publicKey:   `AAAA${btoa(serverId + 'pubkey').slice(0, 40)}`,
    shortId:     hex.slice(0, 8),
    sni:         'www.microsoft.com',
    flow:        'xtls-rprx-vision',
    fingerprint: 'chrome',
  };
}
