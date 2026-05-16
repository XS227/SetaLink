import { create } from 'zustand';
import { snapshot as takeSnapshot, DiagnosticsSnapshot, ServerHint } from '../services/diagnosticsEngine';

function activeServerHint(): ServerHint | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useVpnStore } = require('../stores/vpnStore');
    const s = useVpnStore.getState().selectedServer;
    if (!s) return undefined;
    return { id: s.id, ping: s.ping, protocol: s.protocol, city: s.city, country: s.country };
  } catch { return undefined; }
}

const POLL_INTERVAL_MS = 2000;

interface LiveStats { ping: number; uploadMbps: number; downloadMbps: number }

interface DiagnosticsState {
  snapshot:    DiagnosticsSnapshot | null;
  isRunning:   boolean;
  elapsedSecs: number;
  liveStats:   LiveStats | null;  // real adapter stats when VPN is connected

  startMonitor:  () => void;
  stopMonitor:   () => void;
  runOnce:       () => void;
  pushLiveStats: (s: LiveStats) => void;
  clearLiveStats: () => void;
}

let _pollTimer:    ReturnType<typeof setInterval> | null = null;
let _elapsedTimer: ReturnType<typeof setInterval> | null = null;

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  snapshot:    null,
  isRunning:   false,
  elapsedSecs: 0,
  liveStats:   null,

  startMonitor: () => {
    if (_pollTimer) return; // already running

    set({ isRunning: true, elapsedSecs: 0, snapshot: takeSnapshot(activeServerHint()) });

    _pollTimer = setInterval(() => {
      set({ snapshot: takeSnapshot(activeServerHint()) });
    }, POLL_INTERVAL_MS);

    _elapsedTimer = setInterval(() => {
      set((s) => ({ elapsedSecs: s.elapsedSecs + 1 }));
    }, 1000);
  },

  stopMonitor: () => {
    if (_pollTimer)    { clearInterval(_pollTimer);    _pollTimer    = null; }
    if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
    set({ isRunning: false });
  },

  runOnce: () => set({ snapshot: takeSnapshot(activeServerHint()) }),

  pushLiveStats: (s) => set({ liveStats: s }),
  clearLiveStats: () => set({ liveStats: null }),
}));
