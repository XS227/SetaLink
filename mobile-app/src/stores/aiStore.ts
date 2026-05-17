import { create } from 'zustand';

export type AIModeKey =
  | 'auto'
  | 'iran'
  | 'gaming'
  | 'streaming'
  | 'stealth'
  | 'fallback';

export interface AIMode {
  key:         AIModeKey;
  label:       string;
  icon:        string;
  description: string;
  accentColor: string;
  protocols:   string[];
}

export const AI_MODES: AIMode[] = [
  {
    key: 'auto', label: 'Auto', icon: '◎',
    description: 'AI selects the optimal protocol and route in real time.',
    accentColor: '#00E87A',
    protocols: ['VLESS', 'Reality', 'WebSocket'],
  },
  {
    key: 'iran', label: 'Iran Mode', icon: '◈',
    description: 'Stealth routing tuned for deep packet inspection bypass.',
    accentColor: '#FF7A3D',
    protocols: ['Reality', 'XHTTP', 'HTTPUpgrade'],
  },
  {
    key: 'gaming', label: 'Gaming', icon: '⬡',
    description: 'Low-latency priority routing. Minimizes ping and jitter.',
    accentColor: '#00AAFF',
    protocols: ['VLESS', 'Reality'],
  },
  {
    key: 'streaming', label: 'Streaming', icon: '≡',
    description: 'High-throughput CDN routing for video and live content.',
    accentColor: '#FFB800',
    protocols: ['WebSocket', 'VLESS'],
  },
  {
    key: 'stealth', label: 'Stealth', icon: '○',
    description: 'Maximum obfuscation. Indistinguishable from HTTPS.',
    accentColor: '#9B77FF',
    protocols: ['Reality', 'XHTTP', 'HTTPUpgrade'],
  },
  {
    key: 'fallback', label: 'Auto Fallback', icon: '⊕',
    description: 'AI switches protocols if connection degrades.',
    accentColor: '#3B9EFF',
    protocols: ['VLESS → Reality → WebSocket'],
  },
];

export interface AILogEntry {
  id:        string;
  timestamp: number;   // unix ms
  message:   string;
  level:     'info' | 'warn' | 'success';
}

export interface AIFeatures {
  autoProtocol:        boolean;
  smartReconnect:      boolean;
  domainRotation:      boolean;
  cdnFallback:         boolean;
  latencyAwareRouting: boolean;
}

interface AIState {
  activeMode: AIModeKey;
  features:   AIFeatures;
  liveLog:    AILogEntry[];

  selectMode:    (mode: AIModeKey) => void;
  toggleFeature: (key: keyof AIFeatures) => void;
  addLogEntry:   (message: string, level?: AILogEntry['level']) => void;
  clearLog:      () => void;
  activeModeDef: () => AIMode;
}

let _logIdCounter = 100;

export const useAIStore = create<AIState>((set, get) => ({
  activeMode: 'auto',

  features: {
    autoProtocol:        true,
    smartReconnect:      true,
    domainRotation:      false,
    cdnFallback:         true,
    latencyAwareRouting: true,
  },

  liveLog: [],

  selectMode: (mode) => set({ activeMode: mode }),

  toggleFeature: (key) => set((s) => ({
    features: { ...s.features, [key]: !s.features[key] },
  })),

  addLogEntry: (message, level = 'info') => set((s) => ({
    liveLog: [
      { id: String(++_logIdCounter), timestamp: Date.now(), message, level },
      ...s.liveLog.slice(0, 49), // keep last 50 entries
    ],
  })),

  clearLog: () => set({ liveLog: [] }),

  activeModeDef: () => AI_MODES.find((m) => m.key === get().activeMode) ?? AI_MODES[0],
}));
