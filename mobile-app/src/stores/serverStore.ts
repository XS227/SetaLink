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

// No hardcoded demo servers — only real imported or backend-provided nodes appear here.
export const SERVER_CATALOG: ServerRecord[] = [];

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
  selectedId:    string;
  filter:        FilterTab;
  query:         string;
  isLoading:     boolean;
  loadError:     string | null;
  importedCreds: Record<string, ServerCredentials>;  // serverId → creds

  selectServer:  (id: string) => void;
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
  filter:        'All',
  query:         '',
  isLoading:     false,
  loadError:     null,
  importedCreds: {},

  selectServer: (id) => {
    set({ selectedId: id });

    const record = get().servers.find((s) => s.id === id);
    if (!record) return;

    // Sync selected server into vpnStore — one-way dependency, no cycle
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
        // importedCreds (v0.9.35 #4). Only real creds (uuid+publicKey) are kept.
        const fetchedCreds: Record<string, ServerCredentials> = {};
        await Promise.all(data.map(async (s) => {
          try {
            const c: Partial<ServerCredentials> = await ServersAPI.getConfig(s.id, token);
            if (c?.uuid && c?.publicKey) fetchedCreds[s.id] = c as ServerCredentials;
          } catch { /* node has no public config — skip */ }
        }));

        const prevSelectedId = get().selectedId;
        set((state) => ({
          servers:       data,
          importedCreds: { ...state.importedCreds, ...fetchedCreds },
          isLoading:     false,
        }));

        // Auto-select the fastest connectable server when the user has no valid
        // selection (new install, or previously selected node was removed).
        // Respects an existing manual choice — never overrides it.
        const newIds = new Set(data.map((s) => s.id));
        if (!prevSelectedId || !newIds.has(prevSelectedId)) {
          const best = data
            .filter((s) => fetchedCreds[s.id])
            .sort((a, b) => a.ping - b.ping)[0];
          if (best) {
            set({ selectedId: best.id });
            syncToVpnStore(best);
          }
        }
      } else {
        set({ isLoading: false });
      }
    } catch {
      // Keep SERVER_CATALOG fallback on any network/API error
      set({ isLoading: false, loadError: 'Using saved server list' });
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
