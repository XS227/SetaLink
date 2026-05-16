import { create } from 'zustand';
import { snapshot as takeSnapshot, DiagnosticsSnapshot } from '../services/diagnosticsEngine';

const POLL_INTERVAL_MS = 2000;

interface DiagnosticsState {
  snapshot:    DiagnosticsSnapshot | null;
  isRunning:   boolean;
  elapsedSecs: number;

  startMonitor: () => void;
  stopMonitor:  () => void;
  runOnce:      () => void;
}

let _pollTimer:    ReturnType<typeof setInterval> | null = null;
let _elapsedTimer: ReturnType<typeof setInterval> | null = null;

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  snapshot:    null,
  isRunning:   false,
  elapsedSecs: 0,

  startMonitor: () => {
    if (_pollTimer) return; // already running

    set({ isRunning: true, elapsedSecs: 0, snapshot: takeSnapshot() });

    _pollTimer = setInterval(() => {
      set({ snapshot: takeSnapshot() });
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

  runOnce: () => set({ snapshot: takeSnapshot() }),
}));
