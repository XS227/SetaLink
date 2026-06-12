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

// Overlays LIVE DNS state from the native connect step log onto the snapshot's
// health checks: DNS OK / DNS FAILED / DNS TIMEOUT / fallback DNS used.
function withLiveDns(snap: DiagnosticsSnapshot): DiagnosticsSnapshot {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useVpnStore } = require('../stores/vpnStore');
    const { connectionLog, connectionState } = useVpnStore.getState();
    if (connectionState !== 'connected' || !connectionLog?.length) return snap;

    let dnsLine: string | null = null;
    for (let i = connectionLog.length - 1; i >= 0; i--) {
      const l = connectionLog[i]!;
      if (l.includes('dns_check') || l.includes('dns_resolve')) { dnsLine = l; break; }
    }
    // Emergency profiles route DNS to the 1.1.1.1-only fallback resolver.
    let fallbackDns = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAIStore } = require('../stores/aiStore');
      fallbackDns = !!useAIStore.getState().autoConnect.winningConfig?.label?.includes('Emergency');
    } catch {}

    const dnsCheck =
      dnsLine === null                      ? { status: 'warn' as const, detail: 'DNS check pending…' } :
      dnsLine.toLowerCase().includes('timeout') ? { status: 'fail' as const, detail: 'DNS TIMEOUT — resolver not answering through tunnel' } :
      dnsLine.startsWith('✓')               ? { status: 'ok'   as const, detail: fallbackDns ? 'DNS OK · fallback DNS used (1.1.1.1)' : 'DNS OK — resolution working through tunnel' } :
                                              { status: 'fail' as const, detail: 'DNS FAILED — hostnames may not resolve' };

    return {
      ...snap,
      healthChecks: snap.healthChecks.map(h =>
        h.label === 'DNS Resolution' ? { ...h, ...dnsCheck } : h),
    };
  } catch { return snap; }
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

    set({ isRunning: true, elapsedSecs: 0, snapshot: withLiveDns(takeSnapshot(activeServerHint())) });

    _pollTimer = setInterval(() => {
      set({ snapshot: withLiveDns(takeSnapshot(activeServerHint())) });
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

  runOnce: () => set({ snapshot: withLiveDns(takeSnapshot(activeServerHint())) }),

  pushLiveStats: (s) => set({ liveStats: s }),
  clearLiveStats: () => set({ liveStats: null }),
}));
