// vpnBridge tests — only covers MockAdapter since NativeAdapter requires native module
import type { VpnAdapter } from '../services/vpnBridge';

function buildMockAdapter(): VpnAdapter {
  // Import through module to get the real MockAdapter behaviour
  // MockAdapter is not exported directly so we use createAdapter with native module absent
  jest.resetModules();
  jest.mock('../specs/NativeXrayModule', () => { throw new Error('not available'); }, { virtual: true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../services/vpnBridge').createAdapter();
}

describe('vpnBridge — MockAdapter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('createAdapter returns a MockAdapter when native module unavailable', () => {
    const adapter = buildMockAdapter();
    expect(typeof adapter.connect).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
    expect(typeof adapter.getStats).toBe('function');
    expect(typeof adapter.isRunning).toBe('function');
  });

  it('isRunning returns false before connect', async () => {
    const adapter = buildMockAdapter();
    expect(await adapter.isRunning()).toBe(false);
  });

  it('connect resolves and isRunning becomes true (mocked success)', async () => {
    const adapter = buildMockAdapter();

    // Mock Math.random to guarantee success
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const connectPromise = adapter.connect('{}');
    jest.advanceTimersByTime(4000);
    await connectPromise;

    expect(await adapter.isRunning()).toBe(true);
    jest.restoreAllMocks();
  });

  it('connect rejects when random triggers failure', async () => {
    const adapter = buildMockAdapter();

    jest.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValue(0.0); // second call: 0.0 < threshold → fail? No...
    // MockAdapter: fails when Math.random() >= MOCK_SUCCESS_RATE (0.95)
    // So returning 0.99 means failure
    jest.restoreAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // >= 0.95 → fail

    const connectPromise = adapter.connect('{}');
    jest.advanceTimersByTime(4000);

    await expect(connectPromise).rejects.toThrow('Connection failed (mock)');
    jest.restoreAllMocks();
  });

  it('disconnect resolves and isRunning becomes false', async () => {
    const adapter = buildMockAdapter();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const connectPromise = adapter.connect('{}');
    jest.advanceTimersByTime(4000);
    await connectPromise;

    const disconnectPromise = adapter.disconnect();
    jest.advanceTimersByTime(2000);
    await disconnectPromise;

    expect(await adapter.isRunning()).toBe(false);
    jest.restoreAllMocks();
  });

  it('getStats returns numeric fields', async () => {
    const adapter = buildMockAdapter();
    const stats = await adapter.getStats();
    expect(typeof stats.uploadBytes).toBe('number');
    expect(typeof stats.downloadBytes).toBe('number');
    expect(typeof stats.pingMs).toBe('number');
    expect(typeof stats.uptime).toBe('number');
  });

  it('getAdapter() returns the same singleton on repeated calls', () => {
    jest.resetModules();
    jest.mock('../specs/NativeXrayModule', () => { throw new Error('not available'); }, { virtual: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAdapter } = require('../services/vpnBridge');
    expect(getAdapter()).toBe(getAdapter());
  });
});
