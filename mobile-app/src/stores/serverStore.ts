import { create } from 'zustand';
import type { AIModeKey }         from './aiStore';
import type { ServerCredentials } from '../services/serverConfigService';

export interface ServerRecord {
  id:       string;
  country:  string;
  city:     string;
  flag:     string;
  ping:     number;
  load:     number;  // 0–100
  protocol: string;
  tags?:    string[];
  premium?: boolean;
}

export type FilterTab = 'All' | 'Recommended' | 'Fastest' | 'Stealth' | 'Streaming';
export const FILTER_TABS: FilterTab[] = ['All', 'Recommended', 'Fastest', 'Stealth', 'Streaming'];

export const SERVER_CATALOG: ServerRecord[] = [
  { id: 'de1', country: 'Germany',        city: 'Frankfurt',   flag: '🇩🇪', ping: 24,  load: 34, protocol: 'VLESS',     tags: ['Recommended', 'Fastest'], premium: true  },
  { id: 'nl1', country: 'Netherlands',    city: 'Amsterdam',   flag: '🇳🇱', ping: 31,  load: 42, protocol: 'VLESS',     tags: ['Streaming'],              premium: true  },
  { id: 'fi1', country: 'Finland',        city: 'Helsinki',    flag: '🇫🇮', ping: 38,  load: 21, protocol: 'Reality',                                     premium: false },
  { id: 'fr1', country: 'France',         city: 'Paris',       flag: '🇫🇷', ping: 28,  load: 57, protocol: 'VLESS',     tags: ['Stealth'],                premium: false },
  { id: 'us1', country: 'United States',  city: 'New York',    flag: '🇺🇸', ping: 88,  load: 63, protocol: 'WebSocket'                                                  },
  { id: 'us2', country: 'United States',  city: 'Los Angeles', flag: '🇺🇸', ping: 112, load: 71, protocol: 'VLESS'                                                       },
  { id: 'sg1', country: 'Singapore',      city: 'Singapore',   flag: '🇸🇬', ping: 67,  load: 48, protocol: 'Reality',   tags: ['Streaming'],              premium: true  },
  { id: 'jp1', country: 'Japan',          city: 'Tokyo',       flag: '🇯🇵', ping: 95,  load: 39, protocol: 'VLESS'                                                       },
  { id: 'uk1', country: 'United Kingdom', city: 'London',      flag: '🇬🇧', ping: 33,  load: 55, protocol: 'VLESS',     tags: ['Streaming'],              premium: true  },
  { id: 'ch1', country: 'Switzerland',    city: 'Zurich',      flag: '🇨🇭', ping: 35,  load: 18, protocol: 'Reality',   tags: ['Stealth'],                premium: true  },
  { id: 'tr1', country: 'Turkey',         city: 'Istanbul',    flag: '🇹🇷', ping: 52,  load: 44, protocol: 'VLESS'                                                       },
  { id: 'se1', country: 'Sweden',         city: 'Stockholm',   flag: '🇸🇪', ping: 41,  load: 29, protocol: 'Reality'                                                     },
];

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
  importFromVless:        (uri: string) => { success: boolean; error?: string };
  importFromSubscription: (url: string) => Promise<{ imported: number; errors: number }>;
  removeImportedServer:   (id: string) => void;
  clearImportedServers:   () => void;

  // Credential lookup for the VPN config builder
  getImportedCreds: (serverId: string) => ServerCredentials | undefined;

  // Selector functions — call these in components, not store subscriptions
  filteredServers: (mode?: AIModeKey) => ServerRecord[];
  aiPicks:         (mode?: AIModeKey) => ServerRecord[];
  selectedRecord:  () => ServerRecord | undefined;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers:       SERVER_CATALOG,
  selectedId:    'de1',
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useVpnStore } = require('./vpnStore');
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
      set({ isLoading: false, loadError: 'Could not refresh server list' });
    }
  },

  importFromVless: (uri) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseSingleVless } = require('../services/subscriptionService') as typeof import('../services/subscriptionService');
      const entry = parseSingleVless(uri);
      if (!entry) return { success: false, error: 'Invalid or unsupported VLESS URI' };

      const { servers, importedCreds } = get();
      // Avoid duplicate by address+port
      const exists = servers.some(
        (s) => importedCreds[s.id]?.address === entry.creds.address &&
               importedCreds[s.id]?.port    === entry.creds.port,
      );
      if (exists) return { success: false, error: 'Server already imported' };

      set({
        servers:       [...servers, entry.record],
        importedCreds: { ...importedCreds, [entry.record.id]: entry.creds },
      });
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
    set({
      servers:       servers.filter((s) => s.id !== id),
      importedCreds: next,
      selectedId:    selectedId === id ? 'de1' : selectedId,
    });
  },

  clearImportedServers: () => {
    const { servers, importedCreds, selectedId } = get();
    const importedIds = new Set(Object.keys(importedCreds));
    set({
      servers:       servers.filter((s) => !importedIds.has(s.id)),
      importedCreds: {},
      selectedId:    importedIds.has(selectedId) ? 'de1' : selectedId,
    });
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
}));
