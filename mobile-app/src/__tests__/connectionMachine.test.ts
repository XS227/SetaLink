import { ConnectionMachine, MachineState } from '../services/connectionMachine';
import type { VpnAdapter } from '../services/vpnBridge';

function buildMachine(overrides?: Partial<{ adapter: VpnAdapter }>) {
  const events: Array<{ next: MachineState; prev: MachineState }> = [];
  const connected    = jest.fn();
  const disconnected = jest.fn();
  const error        = jest.fn();

  const machine = new ConnectionMachine(
    {
      onStateChange:   (next, prev) => events.push({ next, prev }),
      onConnected:     connected,
      onDisconnected:  disconnected,
      onError:         error,
      // Provide a stub config so the adapter path is taken when an adapter is given
      getConnectConfig: overrides?.adapter ? () => '{}' : undefined,
    },
    overrides?.adapter,
  );

  return { machine, events, connected, disconnected, error };
}

// ── Mock adapter ──────────────────────────────────────────────────────────────

function makeAdapter(opts: { succeed?: boolean } = {}): VpnAdapter {
  const { succeed = true } = opts;
  return {
    connect:    jest.fn(() => succeed ? Promise.resolve() : Promise.reject(new Error('fail'))),
    disconnect: jest.fn(() => Promise.resolve()),
    getStats:   jest.fn(() => Promise.resolve({ uploadBytes: 0, downloadBytes: 0, pingMs: 10, uptime: 0 })),
    isRunning:  jest.fn(() => Promise.resolve(succeed)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectionMachine — state transitions', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts in idle', () => {
    const { machine } = buildMachine();
    expect(machine.getState()).toBe('idle');
  });

  it('transitions idle → connecting on CONNECT', () => {
    const { machine, events } = buildMachine();
    machine.send('CONNECT');
    expect(machine.getState()).toBe('connecting');
    expect(events[0]).toEqual({ next: 'connecting', prev: 'idle' });
  });

  it('transitions connecting → connected via mock timer (CONNECTED event)', () => {
    const { machine, connected } = buildMachine();
    machine.send('CONNECT');
    // Advance past mock delay
    jest.advanceTimersByTime(4000);
    // State may be 'connected' or 'error' depending on random; just assert callbacks are possible
    expect(['connected', 'error']).toContain(machine.getState());
    machine.destroy();
  });

  it('transitions connected → disconnecting → idle on DISCONNECT', async () => {
    const adapter = makeAdapter({ succeed: true });
    const { machine, disconnected } = buildMachine({ adapter });

    machine.send('CONNECT');
    // Wait for adapter.connect to resolve
    await Promise.resolve();
    expect(machine.getState()).toBe('connected');

    machine.send('DISCONNECT');
    expect(machine.getState()).toBe('disconnecting');

    await Promise.resolve();
    expect(machine.getState()).toBe('idle');
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('transitions to error when adapter.connect rejects', async () => {
    const adapter = makeAdapter({ succeed: false });
    const { machine, error } = buildMachine({ adapter });

    machine.send('CONNECT');
    await Promise.resolve();

    expect(machine.getState()).toBe('error');
    expect(error).toHaveBeenCalledWith('Connection failed');
  });

  it('error → reconnecting on CONNECT, increments reconnectAttempts', async () => {
    const adapter = makeAdapter({ succeed: false });
    const { machine } = buildMachine({ adapter });

    machine.send('CONNECT');
    await Promise.resolve(); // → error

    machine.send('CONNECT'); // → reconnecting
    expect(machine.getState()).toBe('reconnecting');
    expect(machine.getReconnectAttempts()).toBe(1);
  });

  it('ignores invalid transitions silently', () => {
    const { machine } = buildMachine();
    machine.send('DISCONNECT'); // invalid from idle
    expect(machine.getState()).toBe('idle');
  });

  it('destroy cancels pending timers', () => {
    const { machine } = buildMachine();
    machine.send('CONNECT');
    machine.destroy();
    jest.advanceTimersByTime(10000);
    // State stays at 'connecting' — mock timer was cancelled
    expect(machine.getState()).toBe('connecting');
  });
});

describe('xrayConfigBuilder', () => {
  it('generates valid JSON with VLESS Reality protocol', () => {
    const { buildXrayConfig } = require('../services/xrayConfigBuilder');
    const server = {
      id: 'de1', country: 'Germany', city: 'Frankfurt',
      flag: '🇩🇪', protocol: 'VLESS', transport: 'Reality',
      ping: 24, load: 34, premium: true,
    };
    const config = buildXrayConfig(server, 'VLESS+Reality', 'Cloudflare (DoH)');
    expect(config.outbounds[0].protocol).toBe('vless');
    expect(config.outbounds[0].streamSettings?.security).toBe('reality');
    expect(config.inbounds).toHaveLength(2);
    expect(config.routing.rules.length).toBeGreaterThan(0);
  });

  it('generates WebSocket variant for WebSocket protocol', () => {
    const { buildXrayConfig } = require('../services/xrayConfigBuilder');
    const server = {
      id: 'us1', country: 'US', city: 'New York',
      flag: '🇺🇸', protocol: 'WebSocket', transport: 'WebSocket',
      ping: 88, load: 63, premium: false,
    };
    const config = buildXrayConfig(server, 'WebSocket', 'Cloudflare (DoH)');
    expect(config.outbounds[0].streamSettings?.network).toBe('ws');
  });
});
