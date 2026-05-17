import { create } from 'zustand';
import { ConnectionMachine, MachineState } from '../services/connectionMachine';
import { getAdapter }                       from '../services/vpnBridge';
import { buildXrayConfigJson }              from '../services/xrayConfigBuilder';

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
  setSelectedServer:  (server: VpnServer) => void;
  setSessionBytes:    (b: SessionBytes) => void;
  addSessionBytes:    (sent: number, received: number) => void;
  resetSession:       () => void;
  setProtocol:        (p: string) => void;
  clearError:         () => void;
  setConnectionLog:   (log: string[]) => void;
  // kept for backward compat in tests / adapters
  setConnectionState: (s: ConnectionState) => void;
}

const DEFAULT_SERVER: VpnServer = {
  id: 'de1', country: 'Germany', city: 'Frankfurt',
  flag: '🇩🇪', protocol: 'VLESS', transport: 'Reality',
  ping: 24, load: 34, premium: true,
};

export const useVpnStore = create<VpnState>((set, get) => {
  // Machine lives in closure — one instance per store, survives re-renders
  const machine = new ConnectionMachine({
    onStateChange: (next, _prev) => {
      set({ connectionState: next });

      if (next === 'reconnecting') {
        set({ reconnectAttempts: machine.getReconnectAttempts() });
      }
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
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useSettingsStore } = require('./settingsStore');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useServerStore }   = require('./serverStore');
        const dnsMode = useSettingsStore.getState().dnsMode;
        const creds   = useServerStore.getState().getImportedCreds(selectedServer.id);
        return buildXrayConfigJson(selectedServer, selectedProtocol, dnsMode, creds);
      } catch {
        return buildXrayConfigJson(selectedServer, selectedProtocol, 'Cloudflare (DoH)');
      }
    },
  }, getAdapter());

  return {
    connectionState:   'idle',
    selectedServer:    DEFAULT_SERVER,
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
