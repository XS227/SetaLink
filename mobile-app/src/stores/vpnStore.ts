import { create } from 'zustand';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

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
  connectionState:  ConnectionState;
  selectedServer:   VpnServer | null;
  sessionStartedAt: number | null;   // unix ms, set on 'connected'
  sessionBytes:     SessionBytes;
  selectedProtocol: string;

  setConnectionState: (s: ConnectionState) => void;
  setSelectedServer:  (server: VpnServer)  => void;
  setSessionBytes:    (b: SessionBytes)    => void;
  addSessionBytes:    (sent: number, received: number) => void;
  resetSession:       () => void;
  setProtocol:        (p: string) => void;
}

const DEFAULT_SERVER: VpnServer = {
  id: 'de-fra-01', country: 'Germany', city: 'Frankfurt',
  flag: '🇩🇪', protocol: 'VLESS', transport: 'Reality',
  ping: 24, load: 42, premium: true,
};

export const useVpnStore = create<VpnState>((set) => ({
  connectionState:  'idle',
  selectedServer:   DEFAULT_SERVER,
  sessionStartedAt: null,
  sessionBytes:     { sent: 0, received: 0 },
  selectedProtocol: 'VLESS+Reality',

  setConnectionState: (s) => set((prev) => ({
    connectionState: s,
    sessionStartedAt:
      s === 'connected'  ? Date.now() :
      s === 'idle'       ? null :
      prev.sessionStartedAt,
  })),

  setSelectedServer: (server)  => set({ selectedServer: server }),
  setSessionBytes:   (b)       => set({ sessionBytes: b }),
  addSessionBytes: (sent, received) => set((prev) => ({
    sessionBytes: {
      sent:     prev.sessionBytes.sent     + sent,
      received: prev.sessionBytes.received + received,
    },
  })),
  resetSession: () => set({ sessionBytes: { sent: 0, received: 0 }, sessionStartedAt: null }),
  setProtocol:  (p) => set({ selectedProtocol: p }),
}));
