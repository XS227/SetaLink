import { create } from 'zustand';
import { ConnectionMachine, MachineState } from '../services/connectionMachine';

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
  connectionState:   ConnectionState;
  selectedServer:    VpnServer | null;
  sessionStartedAt:  number | null;   // unix ms
  sessionBytes:      SessionBytes;
  selectedProtocol:  string;
  error:             string | null;
  reconnectAttempts: number;

  connect:            () => void;
  disconnect:         () => void;
  setSelectedServer:  (server: VpnServer) => void;
  setSessionBytes:    (b: SessionBytes) => void;
  addSessionBytes:    (sent: number, received: number) => void;
  resetSession:       () => void;
  setProtocol:        (p: string) => void;
  clearError:         () => void;
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

      // Lazy import avoids circular dependency at module load time
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAIStore } = require('./aiStore');
        const protocol = get().selectedServer?.protocol ?? 'VLESS';
        useAIStore.getState().addLogEntry(
          `Connection established · ${protocol} · DPI bypass active`,
          'success'
        );
      } catch {}
    },

    onDisconnected: () => {
      set({
        sessionStartedAt:  null,
        sessionBytes:      { sent: 0, received: 0 },
        reconnectAttempts: 0,
      });
    },

    onError: (message) => {
      set({ error: message });

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useAIStore } = require('./aiStore');
        useAIStore.getState().addLogEntry(`Connection error: ${message}`, 'warn');
      } catch {}
    },
  });

  return {
    connectionState:   'idle',
    selectedServer:    DEFAULT_SERVER,
    sessionStartedAt:  null,
    sessionBytes:      { sent: 0, received: 0 },
    selectedProtocol:  'VLESS+Reality',
    error:             null,
    reconnectAttempts: 0,

    connect:    () => machine.send('CONNECT'),
    disconnect: () => machine.send('DISCONNECT'),

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
      set({ error: null });
    },

    setConnectionState: (s) => set({ connectionState: s }),
  };
});
