import { create } from 'zustand';
import { ConnectionMachine, MachineState } from '../services/connectionMachine';
import { getAdapter }                       from '../services/vpnBridge';
import { buildXrayConfigJson, validateCreds } from '../services/xrayConfigBuilder';
import { appendMetric } from '../services/vpnMetricsStore';

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

interface VpnState {
  connectionState:    ConnectionState;
  selectedServer:     VpnServer | null;
  sessionStartedAt:   number | null;   // unix ms
  sessionBytes:       SessionBytes;
  selectedProtocol:   string;
  error:              string | null;
  reconnectAttempts:  number;
  isSwitchingServer:  boolean;
  connectionLog:      string[];        // step log from most recent connect attempt

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
      set({ sessionStartedAt: Date.now(), error: null });
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
    },

    onError: (message) => {
      set({ error: message });
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
      const { selectedServer, selectedProtocol } = get();
      if (!selectedServer) return null;

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useServerStore } = require('./serverStore') as typeof import('./serverStore');
      const creds = useServerStore.getState().getImportedCreds(selectedServer.id);

      // No real credentials — refuse to connect with placeholder config.
      if (!creds) return null;

      const credCheck = validateCreds(creds);
      if (!credCheck.valid) throw new Error(credCheck.error!);

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useSettingsStore } = require('./settingsStore') as typeof import('./settingsStore');
        const dnsMode = useSettingsStore.getState().dnsMode;
        return buildXrayConfigJson(selectedServer, selectedProtocol, dnsMode, creds);
      } catch {
        return buildXrayConfigJson(selectedServer, selectedProtocol, 'Cloudflare (DoH)', creds);
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
    reconnectAttempts: 0,
    isSwitchingServer: false,
    connectionLog:     [],

    connect:    () => machine.send('CONNECT'),
    disconnect: () => machine.send('DISCONNECT'),

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

    setConnectionState: (s) => set({ connectionState: s }),
  };
});
