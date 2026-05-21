import { create }                    from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage }                   from '../storage/storage';
import type { AIModeKey }            from './aiStore';
import type { ServerCredentials }    from '../services/serverConfigService';

export interface ServerRecord {
  id:        string;
  country:   string;
  city:      string;
  flag:      string;
  ping:      number;
  load:      number;  // 0–100
  protocol:  string;
  transport?: string;
  tags?:     string[];
  premium?:  boolean;
  comingSoon?: boolean;
}

// Coming-soon placeholder entries — shown greyed out, never selectable
export const COMING_SOON_SERVERS: ServerRecord[] = [
  { id: 'cs-finland',     country: 'Finland',     city: 'Helsinki', flag: '🇫🇮', ping: 0, load: 0, protocol: 'Reality', comingSoon: true },
  { id: 'cs-norway',      country: 'Norway',      city: 'Oslo',     flag: '🇳🇴', ping: 0, load: 0, protocol: 'Reality', comingSoon: true },
  { id: 'cs-greece',      country: 'Greece',      city: 'Athens',   flag: '🇬🇷', ping: 0, load: 0, protocol: 'Reality', comingSoon: true },
  { id: 'cs-netherlands', country: 'Netherlands', city: 'Amsterdam',flag: '🇳🇱', ping: 0, load: 0, protocol: 'Reality', comingSoon: true },
];

export type FilterTab = 'All' | 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming';
export const FILTER_TABS: FilterTab[] = ['All', 'Recommended', 'Fastest', 'Stealth', 'Streaming'];

// No hardcoded demo servers — only real imported or backend-provided nodes appear here.
export const SERVER_CATALOG: ServerRecord[] = [];

// Composite server score for AI-driven ranking
export function scoreServer(s: ServerRecord, mode: AIModeKey): number {
  const pingScore = (150 - s.ping) * 0.5;
  const loadScore = (100 - s.load) * 0.3;
  let bonus = 0;

  switch (mode) {
    case 'gaming':    bonus = s.ping < 40 ? 30 : 0; break;
    case 'streaming': bonus = (s.tags ?? []).includes('Streaming') ? 25 : 0; break;
    case 'stealth':   bonus = (s.tags ?? []).includes('Stealth')   ? 25 : 0; break;
    case 'iran':      bonus = (s.protocol === 'Reality' || (s.tags ?? []).includes('Stealth')) ? 30 : 0; break;
    case 'auto':      bonus = (s.tags ?? []).includes('Recommended') ? 20 : 0; break;
    case 'fallback':  bonus = 0; break;
  }

  return pingScore + loadScore + bonus;
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
        set({ servers: data, isLoading: false });
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

      const newServers: ServerRecord[] = [
        {
          id:        'server-reality-cf',
          country:   'Germany',
          city:      'Hetzner · Cloudflare :443',
          flag:      '🇩🇪',
          ping:      40,
          load:      20,
          protocol:  'Reality',
          transport: 'TCP',
          tags:      ['Stealth', 'Recommended'],
        },
        {
          id:        'server-ws',
          country:   'SetaLink Edge',
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
          country:   'SetaLink Edge',
          city:      'Old Edge WS/XHTTP fallback',
          flag:      '🌐',
          ping:      50,
          load:      22,
          protocol:  'XHTTP',
          transport: 'XHTTP',
          tags:      ['Stealth'],
        },
      ];

      // Add Oracle and Amazon as separate selectable servers if altProfiles are present
      const altProfiles = profile.altProfiles ?? [];
      if (altProfiles[0]) {
        newServers.splice(1, 0, {
          id:        'server-reality-oracle',
          country:   'Germany',
          city:      'Hetzner · Oracle :8443',
          flag:      '🇩🇪',
          ping:      45,
          load:      22,
          protocol:  'Reality',
          transport: 'TCP',
          tags:      ['Stealth'],
        });
      }
      if (altProfiles[1]) {
        newServers.splice(2, 0, {
          id:        'server-reality-amazon',
          country:   'Germany',
          city:      'Hetzner · Amazon :2052',
          flag:      '🇩🇪',
          ping:      48,
          load:      23,
          protocol:  'Reality',
          transport: 'TCP',
          tags:      ['Stealth'],
        });
      }

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
