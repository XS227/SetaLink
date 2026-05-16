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

export interface ServerCredentials {
  uuid:      string;
  address:   string;
  port:      number;
  publicKey: string;   // X25519 Reality key
  shortId:   string;
  sni:       string;   // reality serverName
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
  // Try real API first (comment this block out to stay on mocks during dev)
  if (authToken && !authToken.startsWith('mock-')) {
    try {
      const res = await fetch(
        `https://api.setalink.net/v1/servers/${encodeURIComponent(serverId)}/config`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (res.ok) {
        const data = await res.json() as Partial<ServerCredentials>;
        if (data.uuid && data.publicKey) return data as ServerCredentials;
      }
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
    uuid:      `00000000-0000-4000-8000-${hex.padEnd(12, '0')}`,
    address:   `${serverId}.edge.setalink.net`,
    port:      443,
    publicKey: `AAAA${Buffer.from(serverId + 'pubkey').toString('base64').slice(0, 40)}`,
    shortId:   hex.slice(0, 8),
    sni:       'www.microsoft.com',
  };
}
