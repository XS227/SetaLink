import { create }                    from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage }                   from '../storage/storage';
import type { AIModeKey }            from './aiStore';
import type { ServerCredentials }    from '../services/serverConfigService';

export interface ServerRecord {
  id:           string;
  country:      string;
  city:         string;
  flag:         string;
  ping:         number;
  load:         number;       // 0–100
  protocol:     string;
  transport?:   string;
  tags?:        string[];
  premium?:     boolean;
  comingSoon?:  boolean;
  /** Telemetry-derived success rate (0–100) from the last 7 days. Backend-provided. */
  successScore?: number;
}

// Coming-soon placeholder entries — shown greyed out, never selectable
// "Coming soon" placeholders removed from the Servers page (v0.9.43) — show only
// real, connectable nodes. Keep the export (empty) so the screen's filter no-ops.
export const COMING_SOON_SERVERS: ServerRecord[] = [];

// ── Authoritative node identity (2026-07-05) ────────────────────────────────
// The server label MUST come from the actual assigned node, never a hardcoded
// UI assumption. After the bootstrap flipped Finland to primary, the old
// hardcoded "Germany · Hetzner" labels lied about where the user connected.
// This maps the runtime Reality address (from bootstrap creds) to its real
// identity; unknown addresses fall back to any country/city carried by the
// profile, then to a neutral label — never to a guessed country.
interface NodeIdentity { country: string; city: string; flag: string }
const NODE_IDENTITY: Record<string, NodeIdentity> = {
  '65.109.183.7':   { country: 'Finland', city: 'Hetzner · Helsinki', flag: '🇫🇮' },
  '91.107.158.53': { country: 'Germany', city: 'Hetzner · Nürnberg', flag: '🇩🇪' },
  // CDN-fronted stealth node — branded as Realink (never surface the CDN vendor
  // name in the UI). Address is the current Cloudflare-fronted apex.
  'alanya-turist.no': { country: 'Realink', city: 'Secure Edge · Stealth', flag: '☁️' },
};
export function resolveNodeIdentity(
  address?: string,
  fallback?: Partial<NodeIdentity>,
): NodeIdentity {
  const known = address ? NODE_IDENTITY[address] : undefined;
  if (known) return known;
  return {
    country: fallback?.country || 'Realink Node',
    city:    fallback?.city    || (address ? `Reality · ${address}` : 'Reality'),
    flag:    fallback?.flag    || '🌐',
  };
}

export type FilterTab = 'All' | 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming';
export const FILTER_TABS: FilterTab[] = ['All', 'Recommended', 'Fastest', 'Stealth', 'Streaming'];

// ── Bundled cf-edge fallback (2026-07-07) ───────────────────────────────────
// cf-edge is the Cloudflare-fronted WebSocket stealth node — the hardest node
// to block, because its traffic is indistinguishable from normal Cloudflare
// HTTPS. It normally arrives via the /v1/servers catalog, but that fetch itself
// can be blocked/throttled from a censored network — exactly when the user most
// needs the CDN-fronted node. When the catalog fetch fails the app used to fall
// back to a Reality-only emergency profile (Finland + Germany direct IPs), so a
// tester on a hostile network was stranded on the slow direct node with cf-edge
// nowhere in the list. Bundling the node + its (non-secret, WS — no Reality key)
// credentials guarantees the stealth path is always selectable, offline of the
// API. Its real creds are refreshed by fetchServers whenever the catalog loads.
export const CF_EDGE_ID = 'cf-edge';

export const BUNDLED_CF_EDGE: ServerRecord = {
  id:        CF_EDGE_ID,
  country:   'Realink',
  city:      'Secure Edge · Stealth',
  flag:      '☁️',
  ping:      60,
  load:      20,
  protocol:  'WebSocket',
  transport: 'WS',
  tags:      ['Recommended', 'Stealth'],
};

export const BUNDLED_CF_EDGE_CREDS: ServerCredentials = {
  uuid:        '69205cf6-23a7-4e64-a1a2-865fd49471fe',
  // Hostname rotated cf.setalink.no → real.setalink.no (2026-07-07) → alanya-turist.no
  // (2026-07-08) as Iran progressively SNI-blocked the *.setalink.no names on
  // Cloudflare. Same Cloudflare origin (5.249.255.116), same uuid/wsPath; origin
  // serves all names (wildcard vhost). A live catalog fetch overrides this, but the
  // bundled default must also point at the un-blocked apex so fresh installs /
  // offline fallback reach the origin from a hostile network.
  address:     'alanya-turist.no',
  port:        443,
  publicKey:   '',            // WebSocket node — no Reality key
  shortId:     '',
  sni:         'alanya-turist.no',
  flow:        '',
  fingerprint: 'chrome',
  edgeAddress: 'alanya-turist.no',
  // Dial Cloudflare by literal anycast IP, not the hostname: on iOS the tunnel
  // resolves DNS through itself, so a hostname edge address deadlocks the WS
  // handshake (0 /cfws reached origin on b84/b85). Cloudflare routes by SNI
  // (edgeAddress), so any published edge IP works. See xrayConfigBuilder
  // edgeConnectAddress(). Backend catalog can override via creds.edgeIp.
  edgeIp:      '104.21.61.220',
  edgePort:    443,
  wsPath:      '/cfws',
};

/** Ranking for the DEFAULT auto-selection (only used when the user has not
 *  chosen a node). Raw server-side ping is a poor proxy for a censored user:
 *  a low-ping direct node can be DPI-blocked/throttled from their network,
 *  while the Cloudflare-fronted stealth node (higher nominal ping) actually
 *  works. So we rank by, in order:
 *    1. successScore — real per-node success rate from telemetry (backend).
 *    2. a Recommended/Stealth tag — the reliable cf-edge, preferred when we
 *       have no telemetry yet (fresh install) so censored users land on a
 *       node that works instead of a fast-but-blocked one.
 *    3. lowest health-check ping — final tiebreak.
 *  The connect optimizer still validates real internet and fails over, so this
 *  only changes which node the user STARTS on. */
function isPreferredNode(s: ServerRecord): boolean {
  return (s.tags ?? []).some((t) => t === 'Recommended' || t === 'Stealth');
}
export function compareForAutoSelect(a: ServerRecord, b: ServerRecord): number {
  const sa = typeof a.successScore === 'number' ? a.successScore : -1;
  const sb = typeof b.successScore === 'number' ? b.successScore : -1;
  if (sb !== sa) return sb - sa;                       // higher success first
  const ra = isPreferredNode(a) ? 1 : 0;
  const rb = isPreferredNode(b) ? 1 : 0;
  if (rb !== ra) return rb - ra;                       // stealth/recommended first
  return a.ping - b.ping;                              // then lowest ping
}

/** Merge the bundled cf-edge node + creds into a servers list / creds map when
 *  missing. Never overwrites fresher catalog creds — additive only. */
function ensureBundledFallback(
  servers: ServerRecord[],
  creds:   Record<string, ServerCredentials>,
): { servers: ServerRecord[]; creds: Record<string, ServerCredentials> } {
  const hasNode  = servers.some((s) => s.id === CF_EDGE_ID);
  const nextSrv  = hasNode ? servers : [...servers, BUNDLED_CF_EDGE];
  const nextCred = creds[CF_EDGE_ID]
    ? creds
    : { ...creds, [CF_EDGE_ID]: BUNDLED_CF_EDGE_CREDS };
  return { servers: nextSrv, creds: nextCred };
}

// No hardcoded demo servers — only real imported or backend-provided nodes.
// cf-edge is the one bundled exception: the CDN-fronted node must survive a
// blocked catalog fetch (see ensureBundledFallback).
export const SERVER_CATALOG: ServerRecord[] = [BUNDLED_CF_EDGE];

// Composite server score for AI-driven ranking
export function scoreServer(s: ServerRecord, mode: AIModeKey): number {
  const pingScore = (150 - s.ping) * 0.5;
  const loadScore = (100 - s.load) * 0.3;
  // successScore weight: shifts score by ±20 around the neutral point (80% = +0, 100% = +20, 0% = -32).
  // Only applied when the backend has provided telemetry data (>= 5 events).
  const successBonus = s.successScore !== undefined ? ((s.successScore - 80) * 0.4) : 0;
  let bonus = 0;

  switch (mode) {
    case 'gaming':    bonus = s.ping < 40 ? 30 : 0; break;
    case 'streaming': bonus = (s.tags ?? []).includes('Streaming') ? 25 : 0; break;
    case 'stealth':   bonus = (s.tags ?? []).includes('Stealth')   ? 25 : 0; break;
    case 'iran':      bonus = (s.protocol === 'Reality' || (s.tags ?? []).includes('Stealth')) ? 30 : 0; break;
    case 'auto':      bonus = (s.tags ?? []).includes('Recommended') ? 20 : 0; break;
    case 'fallback':  bonus = 0; break;
  }

  return pingScore + loadScore + successBonus + bonus;
}

interface ServerState {
  servers:       ServerRecord[];
  selectedId:    string;      // ACTIVE node — failover may switch this transiently
  userSelectedId: string;     // the user's sticky manual preference (only they set it)
  filter:        FilterTab;
  query:         string;
  isLoading:     boolean;
  loadError:     string | null;
  importedCreds: Record<string, ServerCredentials>;  // serverId → creds

  // isUser=true (default) records a sticky user preference; failover passes
  // false so it can switch the active node without hijacking that preference.
  selectServer:  (id: string, isUser?: boolean) => void;
  // Reset the active node back to the user's manual preference (called on a
  // fresh user-initiated connect so failover never permanently reassigns it).
  restoreUserSelection: () => void;
  setFilter:     (f: FilterTab) => void;
  setQuery:      (q: string) => void;
  fetchServers:  (token: string) => Promise<void>;

  // Import actions
  importFromVless:        (uri: string) => { success: boolean; error?: string; updated?: boolean };
  importFromSubscription: (url: string) => Promise<{ imported: number; errors: number }>;
  removeImportedServer:   (id: string) => void;
  clearImportedServers:   () => void;

  // Bootstrap profile — fetches remote emergency profile for fresh installs
  loadBootstrapIfEmpty:  () => Promise<boolean>;

  // Credential lookup for the VPN config builder
  getImportedCreds: (serverId: string) => ServerCredentials | undefined;

  // Selector functions — call these in components, not store subscriptions
  filteredServers: (mode?: AIModeKey) => ServerRecord[];
  aiPicks:         (mode?: AIModeKey) => ServerRecord[];
  selectedRecord:  () => ServerRecord | undefined;
}

function syncToVpnStore(record: ServerRecord): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useVpnStore } = require('./vpnStore') as typeof import('./vpnStore');
    useVpnStore.getState().setSelectedServer({
      id:        record.id,
      country:   record.country,
      city:      record.city,
      flag:      record.flag,
      protocol:  record.protocol,
      transport: record.protocol === 'Reality' ? 'Reality' : 'TCP',
      ping:      record.ping,
      load:      record.load,
      premium:   record.premium ?? false,
    });
  } catch {}
}

export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
  servers:       SERVER_CATALOG,
  selectedId:    '',
  userSelectedId: '',
  filter:        'All',
  query:         '',
  isLoading:     false,
  loadError:     null,
  // Seed the bundled cf-edge creds so the stealth node is connectable even
  // before (or without) a successful catalog fetch.
  importedCreds: { [CF_EDGE_ID]: BUNDLED_CF_EDGE_CREDS },

  selectServer: (id, isUser = true) => {
    // A manual tap sets the sticky preference; failover (isUser=false) only
    // moves the ACTIVE node so it can't permanently overwrite the user's choice.
    set(isUser ? { selectedId: id, userSelectedId: id } : { selectedId: id });

    const record = get().servers.find((s) => s.id === id);
    if (!record) return;

    // Sync selected server into vpnStore — one-way dependency, no cycle
    syncToVpnStore(record);
  },

  restoreUserSelection: () => {
    // On a fresh user-initiated connect, start from the user's manual choice
    // again — so a prior failover to another node doesn't stick forever. No-op
    // when the user never picked a node, or it's already active, or it's gone.
    const { userSelectedId, selectedId, servers, importedCreds } = get();
    if (!userSelectedId || userSelectedId === selectedId) return;
    const record = servers.find((s) => s.id === userSelectedId);
    // Only restore to a node that still exists and is connectable — otherwise
    // leave the current (failover) node so we don't bounce onto a dead choice.
    if (!record || !importedCreds[userSelectedId]) return;
    set({ selectedId: userSelectedId });
    syncToVpnStore(record);
  },

  setFilter: (f) => set({ filter: f }),
  setQuery:  (q) => set({ query: q }),

  fetchServers: async (token) => {
    set({ isLoading: true, loadError: null });
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ServersAPI } = require('../services/api/servers.api');
      const data: ServerRecord[] = await ServersAPI.list(token);
      if (Array.isArray(data) && data.length > 0) {
        // Fetch each /v1 node's credentials so backend-provided nodes (e.g.
        // Finland) are actually connectable — the connect builder reads from
        // importedCreds (v0.9.35 #4).
        const fetchedCreds: Record<string, ServerCredentials> = {};
        await Promise.all(data.map(async (s) => {
          try {
            const c: Partial<ServerCredentials> = await ServersAPI.getConfig(s.id, token);
            // Reality nodes need a publicKey; CDN/WS/XHTTP nodes have none
            // (cf-edge serves publicKey:""). Requiring it unconditionally threw
            // their creds away, so selecting them could never connect and the
            // failover silently bounced the user back to the primary node.
            const needsKey = (s.protocol ?? 'Reality').includes('Reality');
            if (c?.uuid && (!needsKey || c.publicKey)) fetchedCreds[s.id] = c as ServerCredentials;
          } catch { /* node has no public config — skip */ }
        }));

        const prevSelectedId = get().selectedId;
        // Always keep the bundled cf-edge node + creds present, even if the
        // catalog omitted it (or its per-node config fetch failed above), so the
        // stealth path never silently disappears from the list.
        const merged = ensureBundledFallback(
          data,
          { ...get().importedCreds, ...fetchedCreds },
        );
        set({
          servers:       merged.servers,
          importedCreds: merged.creds,
          isLoading:     false,
        });

        // Auto-select the best connectable server when the user has no valid
        // selection (new install, or previously selected node was removed).
        // Respects an existing manual choice — never overrides it.
        const newIds = new Set(merged.servers.map((s) => s.id));
        if (!prevSelectedId || !newIds.has(prevSelectedId)) {
          const best = merged.servers
            .filter((s) => merged.creds[s.id])
            .sort(compareForAutoSelect)[0];
          if (best) {
            set({ selectedId: best.id });
            syncToVpnStore(best);
          }
        }
      } else {
        set({ isLoading: false });
      }
    } catch {
      // Network/API error (e.g. the catalog itself is blocked from a censored
      // network) — keep the saved list but guarantee the CDN-fronted cf-edge is
      // in it, since that is the node most likely to still reach the user here.
      const merged = ensureBundledFallback(get().servers, get().importedCreds);
      set({
        servers:       merged.servers,
        importedCreds: merged.creds,
        isLoading:     false,
        loadError:     'Using saved server list',
      });
    }
  },

  importFromVless: (uri) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseSingleVless } = require('../services/subscriptionService') as typeof import('../services/subscriptionService');
      const entry = parseSingleVless(uri);
      if (!entry) return { success: false, error: 'Invalid or unsupported VLESS URI' };

      const { servers, importedCreds, selectedId } = get();

      // Check for existing import by address+port
      const existingServer = servers.find(
        (s) => importedCreds[s.id]?.address === entry.creds.address &&
               importedCreds[s.id]?.port    === entry.creds.port,
      );

      if (existingServer) {
        // Update existing credentials in-place (allows recovering from broken configs).
        // UUID or keys may have rotated — replace creds, keep the server record.
        set({
          importedCreds: { ...importedCreds, [existingServer.id]: entry.creds },
        });
        return { success: true, updated: true };
      }

      set({
        servers:       [...servers, entry.record],
        importedCreds: { ...importedCreds, [entry.record.id]: entry.creds },
      });

      // Auto-select the imported server when no server is currently selected
      if (!selectedId) {
        get().selectServer(entry.record.id);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Import failed' };
    }
  },

  importFromSubscription: async (url) => {
    set({ isLoading: true, loadError: null });
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { fetchSubscription } = require('../services/subscriptionService') as typeof import('../services/subscriptionService');
      const result = await fetchSubscription(url);

      const { servers, importedCreds } = get();
      const existingAddrs = new Set(
        Object.values(importedCreds).map((c) => `${c.address}:${c.port}`),
      );

      const newServers: ServerRecord[]                   = [];
      const newCreds: Record<string, ServerCredentials>  = {};
      for (const entry of result.servers) {
        const key = `${entry.creds.address}:${entry.creds.port}`;
        if (!existingAddrs.has(key)) {
          newServers.push(entry.record);
          newCreds[entry.record.id] = entry.creds;
          existingAddrs.add(key);
        }
      }

      set({
        servers:       [...servers, ...newServers],
        importedCreds: { ...importedCreds, ...newCreds },
        isLoading:     false,
      });
      return { imported: newServers.length, errors: result.errors };
    } catch (e) {
      set({ isLoading: false, loadError: e instanceof Error ? e.message : 'Subscription fetch failed' });
      throw e;
    }
  },

  removeImportedServer: (id) => {
    const { servers, importedCreds, selectedId } = get();
    const next = { ...importedCreds };
    delete next[id];
    const nextServers = servers.filter((s) => s.id !== id);
    const nextSelected = selectedId === id ? (nextServers[0]?.id ?? '') : selectedId;
    set({ servers: nextServers, importedCreds: next, selectedId: nextSelected });
    // Sync vpnStore when selection changes
    if (selectedId === id) {
      const nextRecord = nextServers[0];
      if (nextRecord) syncToVpnStore(nextRecord);
      else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useVpnStore } = require('./vpnStore') as typeof import('./vpnStore');
          useVpnStore.getState().setSelectedServer(null);
        } catch {}
      }
    }
  },

  clearImportedServers: () => {
    const { servers, importedCreds, selectedId } = get();
    const importedIds = new Set(Object.keys(importedCreds));
    const nextServers = servers.filter((s) => !importedIds.has(s.id));
    const nextSelected = importedIds.has(selectedId) ? (nextServers[0]?.id ?? '') : selectedId;
    set({ servers: nextServers, importedCreds: {}, selectedId: nextSelected });
    if (importedIds.has(selectedId)) {
      const nextRecord = nextServers[0];
      if (nextRecord) syncToVpnStore(nextRecord);
      else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useVpnStore } = require('./vpnStore') as typeof import('./vpnStore');
          useVpnStore.getState().setSelectedServer(null);
        } catch {}
      }
    }
  },

  loadBootstrapIfEmpty: async () => {
    const BOOTSTRAP_IDS = [
      'server-reality', 'server-reality-cf', 'server-reality-oracle', 'server-reality-amazon',
      'server-ws', 'server-xhttp', 'server-emergency', 'bootstrap-1',
    ];
    const LEGACY_IPS = ['5.249.252.221'];

    // Always purge stale auto-imported profiles (sub-* IDs) and any server using the
    // old One.com/Uniweb IP before checking whether bootstrap needs to run.
    {
      const { servers: cur, importedCreds: curCreds, selectedId: curSelected } = get();
      const staleIds = cur
        .filter(
          (s) => s.id.startsWith('sub-') ||
                 LEGACY_IPS.includes(curCreds[s.id]?.address ?? ''),
        )
        .map((s) => s.id);

      if (staleIds.length > 0) {
        const cleanedCreds = { ...curCreds };
        staleIds.forEach((id) => delete cleanedCreds[id]);
        const cleanedServers = cur.filter((s) => !staleIds.includes(s.id));
        const newSelected = staleIds.includes(curSelected) ? '' : curSelected;
        set({ servers: cleanedServers, importedCreds: cleanedCreds, selectedId: newSelected });
      }
    }

    const { servers, importedCreds } = get();

    // Check if the primary Hetzner Reality inbound is present
    const hasHetzner = servers.some((s) => s.id === 'server-reality-cf');
    if (hasHetzner) return false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getEmergencyProfile } = require('../config/emergencyProfiles') as typeof import('../config/emergencyProfiles');
      const profile = await getEmergencyProfile();
      if (!profile?.uuid || !profile?.address || !profile?.publicKey) return false;

      // Primary Hetzner Cloudflare creds (port 443 — standard HTTPS, best for Iran/restricted networks)
      const cfCreds: ServerCredentials = {
        uuid:        profile.uuid,
        address:     profile.address,
        port:        profile.port,
        publicKey:   profile.publicKey,
        shortId:     profile.shortId,
        sni:         profile.sni,
        flow:        profile.flow,
        fingerprint: profile.fingerprint,
        edgeAddress: profile.edgeAddress || 'edge.setalink.no',
        edgePort:    profile.edgePort    || 443,
        wsPath:      profile.wsPath      || '/ws',
        xhttpPath:   profile.xhttpPath   || '/xhttp/',
        httpupPath:  profile.httpupPath  || '/httpup',
        // Alt Reality inbounds (Oracle :8443, Amazon :2052) — separate keypairs
        altProfiles: profile.altProfiles ?? [],
      };

      // Label the primary from the ACTUAL connected node, not a hardcoded guess.
      const primaryId = resolveNodeIdentity(profile.address, {
        country: (profile as { country?: string }).country,
        city:    (profile as { city?: string }).city,
      });
      const newServers: ServerRecord[] = [
        {
          id:        'server-reality-cf',
          country:   primaryId.country,
          city:      `${primaryId.city} :${profile.port || 443}`,
          flag:      primaryId.flag,
          ping:      40,
          load:      20,
          protocol:  'Reality',
          transport: 'TCP',
          tags:      ['Stealth', 'Recommended'],
        },
        {
          id:        'server-ws',
          country:   'Realink Edge',
          city:      'Old Edge WS/XHTTP fallback',
          flag:      '🌐',
          ping:      55,
          load:      25,
          protocol:  'WebSocket',
          transport: 'WS',
          tags:      ['Streaming'],
        },
        {
          id:        'server-xhttp',
          country:   'Realink Edge',
          city:      'Old Edge WS/XHTTP fallback',
          flag:      '🌐',
          ping:      50,
          load:      22,
          protocol:  'XHTTP',
          transport: 'XHTTP',
          tags:      ['Stealth'],
        },
      ];

      // Alt Reality inbounds → separate selectable servers, each labelled from
      // its OWN address (falls back to the primary address the alt inherits).
      const altProfiles = profile.altProfiles ?? [];
      altProfiles.slice(0, 2).forEach((alt, i) => {
        const id = resolveNodeIdentity(alt.address || profile.address);
        newServers.splice(1 + i, 0, {
          id:        i === 0 ? 'server-reality-oracle' : 'server-reality-amazon',
          country:   id.country,
          city:      `${id.city} :${alt.port || (i === 0 ? 8443 : 2052)}`,
          flag:      id.flag,
          ping:      45 + i * 3,
          load:      22 + i,
          protocol:  'Reality',
          transport: 'TCP',
          tags:      ['Stealth'],
        });
      });

      const newCreds: Record<string, ServerCredentials> = {
        'server-reality-cf': cfCreds,
        // WS/XHTTP use same UUID as CF (whitelisted on edge.setalink.no Xray)
        'server-ws':    cfCreds,
        'server-xhttp': cfCreds,
      };

      // Oracle and Amazon get their own creds if altProfiles available
      if (altProfiles[0]) {
        newCreds['server-reality-oracle'] = {
          uuid:        altProfiles[0].uuid,
          address:     altProfiles[0].address || profile.address,
          port:        altProfiles[0].port,
          publicKey:   altProfiles[0].publicKey,
          shortId:     altProfiles[0].shortId,
          sni:         altProfiles[0].sni,
          flow:        altProfiles[0].flow        || '',
          fingerprint: altProfiles[0].fingerprint || 'chrome',
          edgeAddress: profile.edgeAddress || 'edge.setalink.no',
          edgePort:    profile.edgePort    || 443,
          wsPath:      profile.wsPath      || '/ws',
          xhttpPath:   profile.xhttpPath   || '/xhttp/',
          httpupPath:  profile.httpupPath  || '/httpup',
        };
      }
      if (altProfiles[1]) {
        newCreds['server-reality-amazon'] = {
          uuid:        altProfiles[1].uuid,
          address:     altProfiles[1].address || profile.address,
          port:        altProfiles[1].port,
          publicKey:   altProfiles[1].publicKey,
          shortId:     altProfiles[1].shortId,
          sni:         altProfiles[1].sni,
          flow:        altProfiles[1].flow        || '',
          fingerprint: altProfiles[1].fingerprint || 'chrome',
          edgeAddress: profile.edgeAddress || 'edge.setalink.no',
          edgePort:    profile.edgePort    || 443,
          wsPath:      profile.wsPath      || '/ws',
          xhttpPath:   profile.xhttpPath   || '/xhttp/',
          httpupPath:  profile.httpupPath  || '/httpup',
        };
      }

      // Remove all old bootstrap entries, preserve any user-imported servers
      const otherServers = servers.filter((s) => !BOOTSTRAP_IDS.includes(s.id));
      const otherCreds   = { ...importedCreds };
      BOOTSTRAP_IDS.forEach((id) => delete otherCreds[id]);

      const prevSelectedId = get().selectedId;
      const defaultId = 'server-reality-cf';
      set({
        servers:       [...otherServers, ...newServers],
        importedCreds: { ...otherCreds, ...newCreds },
        selectedId:    prevSelectedId && !BOOTSTRAP_IDS.includes(prevSelectedId)
                       ? prevSelectedId
                       : defaultId,
      });
      if (!prevSelectedId || BOOTSTRAP_IDS.includes(prevSelectedId)) {
        const firstServer = newServers.find((s) => s.id === defaultId) ?? newServers[0];
        if (firstServer) syncToVpnStore(firstServer);
      }
      return true;
    } catch {
      return false;
    }
  },

  getImportedCreds: (serverId) => get().importedCreds[serverId],

  filteredServers: (mode = 'auto') => {
    const { servers, filter, query } = get();
    return servers
      .filter((s) => {
        const q = query.toLowerCase();
        const matchQuery = s.country.toLowerCase().includes(q) || s.city.toLowerCase().includes(q);
        const matchFilter =
          filter === 'All'     ? true :
          filter === 'Fastest' ? s.ping < 50 :
          (s.tags ?? []).includes(filter);
        return matchQuery && matchFilter;
      })
      .sort((a, b) => scoreServer(b, mode) - scoreServer(a, mode));
  },

  aiPicks: (mode = 'auto') =>
    [...get().servers]
      .sort((a, b) => scoreServer(b, mode) - scoreServer(a, mode))
      .slice(0, 3),

  selectedRecord: () => get().servers.find((s) => s.id === get().selectedId),
    }),
    {
      name:    'setalink-servers-v2',
      storage: createJSONStorage(() => storage),
      // Only persist data — functions are recreated from the store definition
      partialize: (state) => ({
        servers:       state.servers,
        importedCreds: state.importedCreds,
        selectedId:    state.selectedId,
        userSelectedId: state.userSelectedId,
      }),
      // On app start, sync the persisted selected server into vpnStore
      onRehydrateStorage: () => (state) => {
        if (!state?.selectedId) return;
        const record = state.servers.find((s) => s.id === state.selectedId);
        if (record) syncToVpnStore(record);
      },
    }
  )
);
