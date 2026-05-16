// Pure TypeScript state machine — no React, no Zustand.
// Manages VPN connection lifecycle; delegates actual I/O to VpnAdapter.
// Provide an adapter for real VPN; omit to stay on mock delays (dev/test).

import type { VpnAdapter } from './vpnBridge';

export type MachineState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'
  | 'reconnecting';

export type MachineEvent =
  | 'CONNECT'
  | 'DISCONNECT'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'FAILED'
  | 'RECONNECT'
  | 'RESET';

export interface MachineCallbacks {
  onStateChange:   (next: MachineState, prev: MachineState) => void;
  onConnected:     () => void;
  onDisconnected:  () => void;
  onError:         (message: string) => void;
  /** Return the Xray JSON config to pass to the adapter. Returning null triggers mock path. */
  getConnectConfig?: () => string | null;
}

// [currentState][event] → nextState  (omitted = invalid, silently ignored)
const TRANSITIONS: Partial<Record<MachineState, Partial<Record<MachineEvent, MachineState>>>> = {
  idle:          { CONNECT:      'connecting'    },
  connecting:    { CONNECTED:    'connected',    FAILED:  'error',   DISCONNECT: 'idle'  },
  connected:     { DISCONNECT:   'disconnecting'                                         },
  disconnecting: { DISCONNECTED: 'idle'                                                   },
  error:         { CONNECT:      'reconnecting', RESET:   'idle'                         },
  reconnecting:  { CONNECTED:    'connected',    FAILED:  'error',   RESET:      'idle'  },
};

const MAX_RECONNECT         = 3;
const MOCK_SUCCESS_RATE     = 0.95;
const MOCK_CONNECT_DELAY_MS = () => 1500 + Math.random() * 1000;
const MOCK_DISCONNECT_MS    = () => 600  + Math.random() * 400;

export class ConnectionMachine {
  private state:             MachineState = 'idle';
  private reconnectAttempts: number       = 0;
  private timers:            ReturnType<typeof setTimeout>[] = [];
  private aborted            = false;

  constructor(
    private readonly cb:      MachineCallbacks,
    private readonly adapter?: VpnAdapter,
  ) {}

  getState():             MachineState { return this.state; }
  getReconnectAttempts(): number       { return this.reconnectAttempts; }

  send(event: MachineEvent): void {
    const next = TRANSITIONS[this.state]?.[event];
    if (!next) return;

    const prev = this.state;
    this.state = next;
    this.cb.onStateChange(next, prev);
    this._onEnter(next, prev);
  }

  destroy(): void {
    this.aborted = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private _onEnter(state: MachineState, prev: MachineState): void {
    switch (state) {
      case 'connecting':
        this._doConnect(MOCK_CONNECT_DELAY_MS());
        break;

      case 'reconnecting': {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
        this._doConnect(delay);
        break;
      }

      case 'connected':
        this.reconnectAttempts = 0;
        this.cb.onConnected();
        break;

      case 'disconnecting':
        this._doDisconnect();
        break;

      case 'idle':
        if (prev !== 'idle') this.cb.onDisconnected();
        break;

      case 'error':
        this.cb.onError(
          this.reconnectAttempts >= MAX_RECONNECT
            ? 'Max reconnection attempts reached'
            : 'Connection failed',
        );
        break;
    }
  }

  private _doConnect(mockDelayMs: number): void {
    if (this.aborted) return;

    const config = this.cb.getConnectConfig?.() ?? null;

    if (this.adapter && config) {
      // Real path — delegate to VpnAdapter
      this.adapter.connect(config).then(
        () => { if (!this.aborted) this.send('CONNECTED'); },
        () => { if (!this.aborted) this.send('FAILED'); },
      );
    } else {
      // Mock path — random delay + success rate
      const t = setTimeout(() => {
        this.send(Math.random() < MOCK_SUCCESS_RATE ? 'CONNECTED' : 'FAILED');
      }, mockDelayMs);
      this.timers.push(t);
    }
  }

  private _doDisconnect(): void {
    if (this.aborted) return;

    if (this.adapter) {
      this.adapter.disconnect().then(
        () => { if (!this.aborted) this.send('DISCONNECTED'); },
        () => { if (!this.aborted) this.send('DISCONNECTED'); }, // always succeed on disconnect
      );
    } else {
      const t = setTimeout(() => this.send('DISCONNECTED'), MOCK_DISCONNECT_MS());
      this.timers.push(t);
    }
  }
}
