import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';
import type { OptimizerProfile, OptimizerResult } from '../services/connectionOptimizer';
import type { AutoPhase, AutoConnectStatus } from '../services/autoConnector';

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

export interface OptimizerState {
  isRunning:       boolean;
  profiles:        OptimizerProfile[];
  lastResult:      OptimizerResult | null;
  bestProfileId:   string | null;
}

// Mirrors AutoProfile from autoConnector without importing the full service type
export interface AutoConnectProfile {
  id:          string;
  label:       string;
  protocol:    string;
  sni:         string;
  port:        number;
  flow:        string;
  fingerprint: string;
  emergency:   boolean;
  status:      'pending' | 'testing' | 'success' | 'fail' | 'skipped';
  latencyMs?:  number;
  error?:      string;
  probeOk?:    boolean;
}

export interface AutoConnectWinner {
  serverId:   string;
  profileId:  string;
  configJson: string;
  probeOk:    boolean;
  label:      string;
}

export interface AutoConnectState {
  isRunning:     boolean;
  mode:          'auto' | 'iran' | null;
  phase:         AutoPhase;
  profiles:      AutoConnectProfile[];
  currentIndex:  number;
  currentLabel:  string;
  result:        { winnerId: string | null; probeOk: boolean; durationMs: number } | null;
  winningConfig: AutoConnectWinner | null;
}

interface AIState {
  activeMode:    AIModeKey;
  features:      AIFeatures;
  liveLog:       AILogEntry[];
  optimizer:     OptimizerState;

  selectMode:         (mode: AIModeKey) => void;
  toggleFeature:      (key: keyof AIFeatures) => void;
  addLogEntry:        (message: string, level?: AILogEntry['level']) => void;
  clearLog:           () => void;
  activeModeDef:      () => AIMode;

  // Optimizer actions
  setOptimizerRunning:  (running: boolean) => void;
  setOptimizerProfiles: (profiles: OptimizerProfile[]) => void;
  setOptimizerResult:   (result: OptimizerResult) => void;
  clearOptimizerResult: () => void;

  // Auto-connect actions
  autoConnect:            AutoConnectState;
  startAutoConnect:       (mode: 'auto' | 'iran') => void;
  updateAutoStatus:       (status: AutoConnectStatus, profiles: AutoConnectProfile[]) => void;
  setAutoResult:          (result: { winnerId: string | null; probeOk: boolean; durationMs: number }) => void;
  setWinningConfig:       (winner: AutoConnectWinner | null) => void;
  clearAutoConnect:       () => void;
}

let _logIdCounter = 100;

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      activeMode: 'auto',

      features: {
        autoProtocol:        true,
        smartReconnect:      true,
        domainRotation:      false,
        cdnFallback:         true,
        latencyAwareRouting: true,
      },

      liveLog: [],

      optimizer: {
        isRunning:     false,
        profiles:      [],
        lastResult:    null,
        bestProfileId: null,
      },

      autoConnect: {
        isRunning:     false,
        mode:          null,
        phase:         'idle',
        profiles:      [],
        currentIndex:  0,
        currentLabel:  '',
        result:        null,
        winningConfig: null,
      },

      selectMode: (mode) => set({ activeMode: mode }),

      toggleFeature: (key) => set((s) => ({
        features: { ...s.features, [key]: !s.features[key] },
      })),

      addLogEntry: (message, level = 'info') => set((s) => ({
        liveLog: [
          { id: String(++_logIdCounter), timestamp: Date.now(), message, level },
          ...s.liveLog.slice(0, 49),
        ],
      })),

      clearLog: () => set({ liveLog: [] }),

      activeModeDef: () => AI_MODES.find((m) => m.key === get().activeMode) ?? AI_MODES[0],

      setOptimizerRunning: (running) =>
        set((s) => ({ optimizer: { ...s.optimizer, isRunning: running } })),

      setOptimizerProfiles: (profiles) =>
        set((s) => ({ optimizer: { ...s.optimizer, profiles } })),

      setOptimizerResult: (result) =>
        set((s) => ({
          optimizer: {
            ...s.optimizer,
            isRunning:     false,
            profiles:      result.profiles,
            lastResult:    result,
            bestProfileId: result.bestProfileId,
          },
        })),

      clearOptimizerResult: () =>
        set((s) => ({
          optimizer: { ...s.optimizer, profiles: [], lastResult: null, bestProfileId: null },
        })),

      startAutoConnect: (mode) =>
        set((s) => ({
          autoConnect: {
            ...s.autoConnect,
            isRunning: true, mode,
            phase: 'testing', profiles: [], currentIndex: 0, currentLabel: '',
            result: null,
          },
        })),

      updateAutoStatus: (status, profiles) =>
        set((s) => ({
          autoConnect: {
            ...s.autoConnect,
            phase:        status.phase,
            currentIndex: status.profileIndex,
            currentLabel: status.profileLabel,
            profiles,
          },
        })),

      setAutoResult: (result) =>
        set((s) => ({
          autoConnect: {
            ...s.autoConnect,
            isRunning: false,
            result,
            phase: result.winnerId && result.probeOk ? 'probe-validated' : 'failed',
          },
        })),

      setWinningConfig: (winner) =>
        set((s) => ({
          autoConnect: { ...s.autoConnect, winningConfig: winner },
        })),

      clearAutoConnect: () =>
        set((s) => ({
          autoConnect: {
            ...s.autoConnect,
            isRunning: false, mode: null,
            phase: 'idle', profiles: [], currentIndex: 0, currentLabel: '',
            result: null,
          },
        })),
    }),
    {
      name:    'ai-store-v1',
      storage: createJSONStorage(() => storage),
      // Persist mode, features, optimizer results, and winning config (never isRunning flags)
      partialize: (s) => ({
        activeMode:    s.activeMode,
        features:      s.features,
        optimizer: {
          isRunning:     false,
          profiles:      s.optimizer.profiles,
          lastResult:    s.optimizer.lastResult,
          bestProfileId: s.optimizer.bestProfileId,
        },
        autoConnect: {
          isRunning:     false,
          mode:          null,
          phase:         'idle' as const,
          profiles:      [],
          currentIndex:  0,
          currentLabel:  '',
          result:        s.autoConnect.result,
          winningConfig: s.autoConnect.winningConfig,
        },
      }),
    },
  ),
);
