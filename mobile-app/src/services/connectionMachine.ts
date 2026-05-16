// Pure TypeScript state machine — no React, no Zustand.
// Manages VPN connection lifecycle with mock async transitions.
// Future: replace _scheduleConnect / _scheduleDisconnect with real Xray bridge calls.

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
  onStateChange:  (next: MachineState, prev: MachineState) => void;
  onConnected:    () => void;
  onDisconnected: () => void;
  onError:        (message: string) => void;
}

// [currentState][event] → nextState  (omitted = invalid transition, silently ignored)
const TRANSITIONS: Partial<Record<MachineState, Partial<Record<MachineEvent, MachineState>>>> = {
  idle:          { CONNECT:      'connecting'    },
  connecting:    { CONNECTED:    'connected',    FAILED:  'error',   DISCONNECT: 'idle'  },
  connected:     { DISCONNECT:   'disconnecting'                                         },
  disconnecting: { DISCONNECTED: 'idle'                                                   },
  error:         { CONNECT:      'reconnecting', RESET:   'idle'                         },
  reconnecting:  { CONNECTED:    'connected',    FAILED:  'error',   RESET:      'idle'  },
};

const MAX_RECONNECT = 3;
const CONNECT_SUCCESS_RATE = 0.95;

export class ConnectionMachine {
  private state: MachineState = 'idle';
  private reconnectAttempts = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly cb: MachineCallbacks) {}

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
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private _onEnter(state: MachineState, prev: MachineState): void {
    switch (state) {
      case 'connecting':
        this._scheduleConnect(1500 + Math.random() * 1000);
        break;

      case 'reconnecting': {
        this.reconnectAttempts++;
        // Exponential back-off, capped at 8 s
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
        this._scheduleConnect(delay);
        break;
      }

      case 'connected':
        this.reconnectAttempts = 0;
        this.cb.onConnected();
        break;

      case 'disconnecting':
        this._scheduleDisconnect(600 + Math.random() * 400);
        break;

      case 'idle':
        if (prev !== 'idle') this.cb.onDisconnected();
        break;

      case 'error':
        this.cb.onError(
          this.reconnectAttempts >= MAX_RECONNECT
            ? 'Max reconnection attempts reached'
            : 'Connection failed'
        );
        break;
    }
  }

  private _scheduleConnect(delayMs: number): void {
    const t = setTimeout(() => {
      this.send(Math.random() < CONNECT_SUCCESS_RATE ? 'CONNECTED' : 'FAILED');
    }, delayMs);
    this.timers.push(t);
  }

  private _scheduleDisconnect(delayMs: number): void {
    const t = setTimeout(() => this.send('DISCONNECTED'), delayMs);
    this.timers.push(t);
  }
}
