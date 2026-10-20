jest.mock('../services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('../stores/authStore', () => ({ useAuthStore: { getState: () => ({}) } }));
import { getChannel, getChannels, reportChannel } from '../services/liveTvService';

describe('Live TV API deadlines', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { jest.useFakeTimers(); globalThis.fetch = jest.fn(); });
  afterEach(() => { globalThis.fetch = originalFetch; jest.useRealTimers(); });

  it('bounds a body that never settles after successful headers', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const result = getChannel('iptvorg:PMC.ae');
    await jest.advanceTimersByTimeAsync(10_501);
    expect(await result).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a failed list request honestly instead of an empty successful catalog', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
    expect(await getChannels()).toMatchObject({ channels: [], failed: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds POST response bodies and cancels their native request', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const result = reportChannel('iptvorg:PMC.ae');
    await jest.advanceTimersByTimeAsync(10_501);
    expect(await result).toBe(false);
    expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  });
});
