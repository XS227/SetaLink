import { create } from 'zustand';
import type { AIModeKey } from './aiStore';

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
  servers:    ServerRecord[];
  selectedId: string;
  filter:     FilterTab;
  query:      string;
  isLoading:  boolean;
  loadError:  string | null;

  selectServer:  (id: string) => void;
  setFilter:     (f: FilterTab) => void;
  setQuery:      (q: string) => void;
  fetchServers:  (token: string) => Promise<void>;

  // Selector functions — call these in components, not store subscriptions
  filteredServers: (mode?: AIModeKey) => ServerRecord[];
  aiPicks:         (mode?: AIModeKey) => ServerRecord[];
  selectedRecord:  () => ServerRecord | undefined;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers:    SERVER_CATALOG,
  selectedId: 'de1',
  filter:     'All',
  query:      '',
  isLoading:  false,
  loadError:  null,

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
