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

// Periodic "still connected" heartbeat. Without it the panel only hears from
// a device at connect/disconnect, so the admin online count reads 0 for
// long-running sessions (and stays stale when the app is killed).
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
let statusHeartbeat: ReturnType<typeof setInterval> | null = null;

function stopStatusHeartbeat() {
  if (statusHeartbeat) { clearInterval(statusHeartbeat); statusHeartbeat = null; }
}

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
  lastPingMs:         number;          // last live latency sample; recorded into session history
  // Protocol auto-fallback state (internal — not persisted)
  _fallbackIdx:       number;
  _fallbackActive:    boolean;
  // Node failover state — tracks which nodes were tried in this connect cycle
  _triedNodeIds:      string[];

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
  setLastPingMs:      (ms: number) => void;
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
      set({ sessionStartedAt: Date.now(), error: null, smartStatus: null, _fallbackActive: false, _fallbackIdx: 0, _triedNodeIds: [] });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectLog, uploadTunnelLog } = require('../services/vpnBridge');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        const log = getLastConnectLog();
        const user = useAuthStore.getState().user;
        if (log.length > 0) {
          set({ connectionLog: log });
          if (user?.deviceId) uploadTunnelLog(user.deviceId, log);
        } else {
          // App Group UserDefaults cross-process write may not have propagated yet
          // (extension calls synchronize() but iOS still has a small window).
          // Retry once after 300 ms — keeps DNS/probe status from showing "Unknown".
          set({ connectionLog: [] });
          setTimeout(() => {
            try {
              const retried: string[] = getLastConnectLog();
              if (retried.length > 0) {
                set({ connectionLog: retried });
                if (user?.deviceId) uploadTunnelLog(user.deviceId, retried);
              }
            } catch {}
          }, 300);
        }
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
            activeSni:  '',
          }).catch(() => {});
          stopStatusHeartbeat();
          statusHeartbeat = setInterval(() => {
            const s = get();
            if (s.connectionState !== 'connected') { stopStatusHeartbeat(); return; }
            reportVpnStatus(user.deviceId, 'online', {
              protocol,
              rxBytes: s.sessionBytes.received,
              txBytes: s.sessionBytes.sent,
            }).catch(() => {});
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { useInboxStore } = require('./inboxStore');
              useInboxStore.getState().refresh(user.deviceId).catch(() => {});
            } catch {}
          }, HEARTBEAT_INTERVAL_MS);
        }
      } catch {}
    },

    onDisconnected: () => {
      stopStatusHeartbeat();
      const state = get();

      // Always record the completed session, even during server switches
      if (state.sessionStartedAt && state.selectedServer) {
        const endedAt  = Date.now();
        const duration = Math.max(1, Math.floor((endedAt - state.sessionStartedAt) / 1000));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useSessionStore } = require('./sessionStore');
          // Winning auto-connect route label (if the session came from auto-connect)
          let route: string | undefined;
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { useAIStore } = require('./aiStore');
            route = useAIStore.getState().autoConnect?.winningConfig?.label || undefined;
          } catch {}
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
            pingMs:     state.lastPingMs || state.selectedServer.ping || undefined,
            route,
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
          const { reportSessionEnd } = require('../services/entitlementService');
          // report-session is the single quota writer (delta model, idempotent
          // via session_id). We intentionally do NOT call report-usage with the
          // cumulative total — that double-counted and inflated lifetime usage.
          if (state.sessionStartedAt && state.selectedServer) {
            const sessionDuration = Math.max(1, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
            const sessionId = `${user.deviceId}-${state.sessionStartedAt}`;
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
              '',
              sessionId,
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
      const { _fallbackActive, _fallbackIdx, _triedNodeIds } = get();
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

      // All protocols exhausted (or AI-mode single-shot) — try next node before giving up.
      // Reads failover_max_nodes from cached remote config (sync, never blocks).
      let nodeFailoverAttempted = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getCachedConfig } = require('../services/remoteConfigService') as typeof import('../services/remoteConfigService');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useServerStore } = require('./serverStore') as typeof import('./serverStore');
        const cfg = getCachedConfig();
        const maxExtra = cfg.failover_max_nodes ?? 2;
        const nodesDisabled = cfg.nodes_disabled ?? [];

        if (_triedNodeIds.length < maxExtra) {
          const sst = useServerStore.getState();
          const curId = sst.selectedId;
          const newTried = [..._triedNodeIds, curId].filter(Boolean);
          const nextServer = [...sst.servers]
            .filter(s =>
              s.id !== curId &&
              !newTried.includes(s.id) &&
              !nodesDisabled.includes(s.id) &&
              sst.importedCreds[s.id],
            )
            .sort((a, b) => (b.successScore ?? 0) - (a.successScore ?? 0))[0];

          if (nextServer) {
            set({
              _triedNodeIds:  newTried,
              _fallbackActive: false,
              _fallbackIdx:   0,
              isSwitchingServer: true,
              smartStatus: `${nextServer.flag} Trying ${nextServer.city}…`,
              error: null,
            });
            sst.selectServer(nextServer.id);
            machine.send('DISCONNECT');
            nodeFailoverAttempted = true;
          }
        }
      } catch {}

      if (nodeFailoverAttempted) return;

      // All nodes and protocols exhausted — surface the final error.
      set({ _fallbackActive: false, _fallbackIdx: 0, _triedNodeIds: [], error: analysis.userMessage, smartStatus: null });
      appendMetric({ type: message.toLowerCase().includes('routing') ? 'routing_failed' : 'connect_failed', at: Date.now(), reason: message, country: get().selectedServer?.country });
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLastConnectLog, uploadTunnelLog } = require('../services/vpnBridge');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        const log = getLastConnectLog();
        set({ connectionLog: log });
        const user = useAuthStore.getState().user;
        if (user?.deviceId) uploadTunnelLog(user.deviceId, log);
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
    lastPingMs:        0,
    _fallbackIdx:      0,
    _fallbackActive:   false,
    _triedNodeIds:     [],

    connect: () => {
      // Forced-update gate: a build below minSupported must not connect.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { isVpnUpdateBlocked } = require('../services/updateService');
        if (isVpnUpdateBlocked()) {
          set({ error: 'A critical update is required before connecting. Please update the app.' });
          return;
        }
      } catch {}
      // Start auto-fallback only on a fresh connect (not during a fallback retry).
      if (!get()._fallbackActive) {
        set({ _fallbackActive: true, _fallbackIdx: 0, error: null, smartStatus: 'Establishing secure tunnel…' });
      }
      // Write device_id + country to App Group before the extension starts.
      // PacketTunnelProvider reads these to include in the diagnostic upload.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { setDiagnosticContext } = require('../services/vpnBridge');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAuthStore } = require('./authStore');
        const user   = useAuthStore.getState().user;
        const server = get().selectedServer;
        if (user?.deviceId) {
          setDiagnosticContext(user.deviceId, server?.country ?? '').catch(() => {});
        }
      } catch {}
      machine.send('CONNECT');
    },

    disconnect: () => {
      set({ _fallbackActive: false, _fallbackIdx: 0, _triedNodeIds: [], smartStatus: null });
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

    setLastPingMs: (ms) => set({ lastPingMs: ms }),

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
