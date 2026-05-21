import { create } from 'zustand';
import { ConnectionMachine, MachineState } from '../services/connectionMachine';
import { getAdapter }                       from '../services/vpnBridge';
import { buildXrayConfigJson, validateCreds } from '../services/xrayConfigBuilder';
import { appendMetric } from '../services/vpnMetricsStore';
import { classifyFailure } from '../services/failureClassifier';

// Re-exported so screens that import ConnectionState don't break
export type ConnectionState = MachineState;

export interface VpnServer {
  id:        string;
  country:   string;
  city:      string;
  flag:      string;
  protocol:  string;
  transport: string;
  ping:      number;
  load:      number;
  premium:   boolean;
}

interface SessionBytes { sent: number; received: number }

// Ordered protocol fallback for auto-connect: Reality → XHTTP → WebSocket.
// Each entry is the protocol string that buildXrayConfigJson understands.
const FALLBACK_PROTOCOLS = ['Reality', 'XHTTP', 'WebSocket'] as const;

interface TraceTestResult {
  ok: boolean;
  statusCode?: number;
  routedIp?: string;
  body?: string;
  bytesIn?: number;
  error?: string;
}

interface VpnState {
  connectionState:    ConnectionState;
  selectedServer:     VpnServer | null;
  sessionStartedAt:   number | null;   // unix ms
  sessionBytes:       SessionBytes;
  selectedProtocol:   string;
  error:              string | null;
  smartStatus:        string | null;   // user-friendly status line (non-technical)
  reconnectAttempts:  number;
  isSwitchingServer:  boolean;
  connectionLog:      string[];        // step log from most recent connect attempt
  traceTestResult:    TraceTestResult | null;
  traceTestRunning:   boolean;
  // Protocol auto-fallback state (internal — not persisted)
  _fallbackIdx:       number;
  _fallbackActive:    boolean;

  connect:            () => void;
  disconnect:         () => void;
  switchServer:       () => void;
  setSelectedServer:  (server: VpnServer | null) => void;
  setSessionBytes:    (b: SessionBytes) => void;
  addSessionBytes:    (sent: number, received: number) => void;
  resetSession:       () => void;
  setProtocol:        (p: string) => void;
  clearError:         () => void;
  setConnectionLog:   (log: string[]) => void;
  runTraceTest:       () => Promise<void>;
  // kept for backward compat in tests / adapters
  setConnectionState: (s: ConnectionState) => void;
}

// No default server — user must import a real VLESS config before connecting.

export const useVpnStore = create<VpnState>((set, get) => {
  // Machine lives in closure — one instance per store, survives re-renders
  const machine = new ConnectionMachine({
    onStateChange: (next, _prev) => {
      set({ connectionState: next });
    },

    onConnected: () => {
      set({ sessionStartedAt: Date.now(), error: null, smartStatus: null, _fallbackActive: false, _fallbackIdx: 0 });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectLog } = require('../services/vpnBridge');
        set({ connectionLog: getLastConnectLog() });
      } catch {}

      const server = get().selectedServer;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAIStore } = require('./aiStore');
        useAIStore.getState().addLogEntry(
          `Connection established · ${server?.protocol ?? 'VPN'} · DPI bypass active`,
          'success'
        );
      } catch {}

      appendMetric({ type: 'connect_success', at: Date.now(), country: server?.country, transport: server?.transport, protocol: server?.protocol });

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useToastStore } = require('./toastStore');
        useToastStore.getState().show(
          `Connected to ${server?.city ?? 'server'}`,
          'success'
        );
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { HapticService } = require('../services/hapticService');
        HapticService.connect();
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { reportVpnStatus } = require('../services/entitlementService');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectProbeOk } = require('../services/vpnBridge');
        const user = useAuthStore.getState().user;
        if (user) {
          const server = get().selectedServer;
          const protocol = server ? `${server.protocol}${server.transport && server.transport !== server.protocol ? '+' + server.transport : ''}` : '';
          reportVpnStatus(user.deviceId, 'online', {
            protocol,
            internetOk: getLastConnectProbeOk?.() ?? false,
            activeSni:  server?.sni ?? '',
          }).catch(() => {});
        }
      } catch {}
    },

    onDisconnected: () => {
      const state = get();

      // Always record the completed session, even during server switches
      if (state.sessionStartedAt && state.selectedServer) {
        const endedAt  = Date.now();
        const duration = Math.max(1, Math.floor((endedAt - state.sessionStartedAt) / 1000));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useSessionStore } = require('./sessionStore');
          useSessionStore.getState().addSession({
            serverId:   state.selectedServer.id,
            serverName: `${state.selectedServer.city}, ${state.selectedServer.country}`,
            serverFlag: state.selectedServer.flag,
            protocol:   state.selectedServer.protocol,
            startedAt:  state.sessionStartedAt,
            endedAt,
            duration,
            sentBytes:  state.sessionBytes.sent,
            recvBytes:  state.sessionBytes.received,
            status:     'success',
          });
        } catch {}
      }

      if (state.sessionStartedAt) {
        appendMetric({ type: 'disconnect', at: Date.now(), durationSec: Math.max(1, Math.floor((Date.now() - state.sessionStartedAt)/1000)), reconnects: state.reconnectAttempts });
      }

      // Update local quota usage and report session to backend.
      const totalBytes = state.sessionBytes.sent + state.sessionBytes.received;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        if (totalBytes > 0) useAuthStore.getState().consumeQuota(totalBytes);
        const user = useAuthStore.getState().user;
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { reportUsage, reportSessionEnd } = require('../services/entitlementService');
          if (totalBytes > 0) reportUsage(user.deviceId, useAuthStore.getState().user!.quotaBytesUsed).catch(() => {});
          if (state.sessionStartedAt && state.selectedServer) {
            const sessionDuration = Math.max(1, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getLastConnectProbeOk } = require('../services/vpnBridge');
            const probeResult: 'ok' | 'fail' | 'unknown' = getLastConnectProbeOk() ? 'ok' : 'fail';
            reportSessionEnd(
              user.deviceId,
              state.selectedServer.protocol,
              state.sessionBytes.sent,
              state.sessionBytes.received,
              sessionDuration,
              probeResult,
            ).catch(() => {});
          }
        }
      } catch {}

      set({ sessionStartedAt: null, sessionBytes: { sent: 0, received: 0 }, reconnectAttempts: 0 });

      // Server switch: skip the disconnect toast and auto-reconnect to the new server
      if (get().isSwitchingServer) {
        set({ isSwitchingServer: false });
        const nextServer = get().selectedServer;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useToastStore } = require('./toastStore');
          useToastStore.getState().show(
            `Switching to ${nextServer?.city ?? 'server'}…`,
            'info'
          );
        } catch {}
        setTimeout(() => machine.send('CONNECT'), 350);
        return;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useToastStore } = require('./toastStore');
        useToastStore.getState().show('Disconnected', 'info');
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { HapticService } = require('../services/hapticService');
        HapticService.disconnect();
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { reportVpnStatus } = require('../services/entitlementService');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectFailureCategory } = require('../services/vpnBridge');
        const user = useAuthStore.getState().user;
        if (user) {
          const failCat = getLastConnectFailureCategory?.() || '';
          reportVpnStatus(user.deviceId, 'offline', {
            internetOk: false,
            ...(failCat ? { failureCategory: failCat } : {}),
          }).catch(() => {});
        }
      } catch {}
    },

    onError: (message) => {
      // Classify the failure for user-friendly status display
      const analysis = classifyFailure(message);

      // Protocol auto-fallback: silently try next protocol before surfacing the error.
      const { _fallbackActive, _fallbackIdx } = get();
      const nextIdx = _fallbackIdx + 1;
      if (_fallbackActive && nextIdx < FALLBACK_PROTOCOLS.length) {
        const nextProto = FALLBACK_PROTOCOLS[nextIdx]!;
        const step = nextIdx + 1;
        const total = FALLBACK_PROTOCOLS.length;
        set({ _fallbackIdx: nextIdx, smartStatus: `Route failed → trying ${nextProto} (${step}/${total})…`, error: `Optimizing route… (${nextProto})` });
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getLastConnectLog } = require('../services/vpnBridge');
          set({ connectionLog: getLastConnectLog() });
        } catch {}
        setTimeout(() => machine.send('CONNECT'), 800);
        return;
      }
      // All protocols exhausted (or not in fallback mode) — surface the error.
      set({ _fallbackActive: false, _fallbackIdx: 0, error: analysis.userMessage, smartStatus: null });
      appendMetric({ type: message.toLowerCase().includes('routing') ? 'routing_failed' : 'connect_failed', at: Date.now(), reason: message, country: get().selectedServer?.country });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectLog } = require('../services/vpnBridge');
        set({ connectionLog: getLastConnectLog() });
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAIStore } = require('./aiStore');
        useAIStore.getState().addLogEntry(`Connection error: ${message}`, 'warn');
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useToastStore } = require('./toastStore');
        useToastStore.getState().show(message, 'error');
      } catch {}

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { HapticService } = require('../services/hapticService');
        HapticService.error();
      } catch {}
    },

    getConnectConfig: () => {
      const { selectedServer, selectedProtocol, _fallbackActive, _fallbackIdx } = get();
      if (!selectedServer) return null;

      // If Auto Mode found a validated winning config for this server, use it directly.
      // This lets runAutoConnect pre-select the best profile without a second probe cycle.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAIStore } = require('./aiStore');
        const winner = useAIStore.getState().autoConnect.winningConfig;
        if (winner?.serverId === selectedServer.id && winner.configJson) {
          // AI already validated a winner — disable our fallback loop.
          set({ _fallbackActive: false, _fallbackIdx: 0 });
          return winner.configJson;
        }
      } catch {}

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useServerStore } = require('./serverStore') as typeof import('./serverStore');
      const creds = useServerStore.getState().getImportedCreds(selectedServer.id);

      // No real credentials — refuse to connect with placeholder config.
      if (!creds) return null;

      const credCheck = validateCreds(creds);
      if (!credCheck.valid) throw new Error(credCheck.error!);

      // When auto-fallback is active, use the current fallback protocol instead of
      // the per-server default. This lets Reality → XHTTP → WebSocket progression
      // happen transparently without changing the selected server.
      const protocol = _fallbackActive
        ? (FALLBACK_PROTOCOLS[_fallbackIdx] ?? selectedProtocol)
        : selectedProtocol;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useSettingsStore } = require('./settingsStore') as typeof import('./settingsStore');
        const dnsMode = useSettingsStore.getState().dnsMode;
        return buildXrayConfigJson(selectedServer, protocol, dnsMode, creds);
      } catch {
        return buildXrayConfigJson(selectedServer, protocol, 'Cloudflare (DoH)', creds);
      }
    },
  }, getAdapter());

  return {
    connectionState:   'idle',
    selectedServer:    null,
    sessionStartedAt:  null,
    sessionBytes:      { sent: 0, received: 0 },
    selectedProtocol:  'VLESS+Reality',
    error:             null,
    smartStatus:       null,
    reconnectAttempts: 0,
    isSwitchingServer: false,
    connectionLog:     [],
    traceTestResult:   null,
    traceTestRunning:  false,
    _fallbackIdx:      0,
    _fallbackActive:   false,

    connect: () => {
      // Start auto-fallback only on a fresh connect (not during a fallback retry).
      if (!get()._fallbackActive) {
        set({ _fallbackActive: true, _fallbackIdx: 0, error: null, smartStatus: 'Establishing secure tunnel…' });
      }
      machine.send('CONNECT');
    },

    disconnect: () => {
      set({ _fallbackActive: false, _fallbackIdx: 0, smartStatus: null });
      machine.send('DISCONNECT');
    },

    switchServer: () => {
      const { connectionState: cs } = get();
      if (cs !== 'connected') return;
      set({ isSwitchingServer: true });
      machine.send('DISCONNECT');
    },

    setSelectedServer: (server) => set({ selectedServer: server }),

    setSessionBytes: (b) => set({ sessionBytes: b }),

    addSessionBytes: (sent, received) => set((prev) => ({
      sessionBytes: {
        sent:     prev.sessionBytes.sent     + sent,
        received: prev.sessionBytes.received + received,
      },
    })),

    resetSession: () => {
      machine.destroy();
      set({
        connectionState:   'idle',
        sessionStartedAt:  null,
        sessionBytes:      { sent: 0, received: 0 },
        error:             null,
        reconnectAttempts: 0,
      });
    },

    setProtocol: (p) => set({ selectedProtocol: p }),

    clearError: () => {
      machine.send('RESET');
      set({ error: null, connectionLog: [] });
    },

    setConnectionLog: (log) => set({ connectionLog: log }),

    runTraceTest: async () => {
      if (get().traceTestRunning) return;
      set({ traceTestRunning: true, traceTestResult: null });
      try {
        const result = await getAdapter().runTraceTest?.();
        set({ traceTestResult: result ?? { ok: false, error: 'Not available' } });
      } catch (e: unknown) {
        set({ traceTestResult: { ok: false, error: String((e as any)?.message ?? e) } });
      } finally {
        set({ traceTestRunning: false });
      }
    },

    setConnectionState: (s) => set({ connectionState: s }),
  };
});
