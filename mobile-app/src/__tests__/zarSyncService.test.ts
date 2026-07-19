/**
 * zarSyncService — server-synced ZAR (contract §8, REALGRAM_UNIFIED_PLATFORM.md §B).
 */

jest.mock('../services/tapAnalytics', () => ({
  initTapAnalytics: jest.fn(),
  recordTap: jest.fn(),
}));

const mockReconcile = jest.fn();
jest.mock('../stores/zarStore', () => ({
  useZarStore: { getState: () => ({ reconcileFromServer: mockReconcile }) },
}));

let vpnState = { connectionState: 'disconnected', selectedServer: null as null | { id: string; protocol: string } };
jest.mock('../stores/vpnStore', () => ({
  useVpnStore: { getState: () => vpnState },
}));

import { initTapAnalytics, recordTap } from '../services/tapAnalytics';
import {
  initZarSync, recordZarTap, flushZarSync,
} from '../services/zarSyncService';

describe('zarSyncService — server-authoritative ZAR sync', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockResolvedValue({ json: async () => ({ ok: true, data: { zar: 42, zar_earned: 5, capped: false } }) });
    (globalThis as any).fetch = fetchMock;
    vpnState = { connectionState: 'disconnected', selectedServer: null };
    mockReconcile.mockClear();
    (recordTap as jest.Mock).mockClear();
    (initTapAnalytics as jest.Mock).mockClear();
    initZarSync('dev-test-1');
  });

  afterEach(async () => {
    await flushZarSync();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('also activates tapAnalytics (previously-dormant B-24 infra)', () => {
    expect(initTapAnalytics).toHaveBeenCalledWith('dev-test-1');
  });

  it('does not call fetch for a single tap before the flush interval', () => {
    recordZarTap();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flushes on the timer and reconciles the store to the server value', async () => {
    recordZarTap();
    recordZarTap();
    await jest.advanceTimersByTimeAsync(12_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('action=tap-sync');
    expect((opts.body as FormData).get('taps')).toBe('2');
    expect(mockReconcile).toHaveBeenCalledWith(42);
  });

  it('records the anonymous connection-quality signal only while VPN-connected', () => {
    recordZarTap();
    expect(recordTap).toHaveBeenLastCalledWith('game_hub', 'tap_coin', undefined, undefined);

    vpnState = { connectionState: 'connected', selectedServer: { id: 'node-7', protocol: 'VLESS+Reality' } };
    recordZarTap();
    expect(recordTap).toHaveBeenLastCalledWith('game_hub', 'tap_coin', 'VLESS+Reality', 'node-7');
  });

  it('gives taps back to the buffer on a failed flush instead of losing them', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'server_error' }) });
    recordZarTap();
    await flushZarSync();
    expect(mockReconcile).not.toHaveBeenCalled();

    // Retried on the next flush and succeeds this time.
    fetchMock.mockResolvedValueOnce({ json: async () => ({ ok: true, data: { zar: 10, zar_earned: 5, capped: false } }) });
    await flushZarSync();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1].body as FormData).get('taps')).toBe('1');
    expect(mockReconcile).toHaveBeenCalledWith(10);
  });

  it('flushes early once the buffer hits the max batch size', async () => {
    for (let i = 0; i < 100; i++) recordZarTap();
    await Promise.resolve(); // let the fire-and-forget flush() microtask start
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1].body as FormData).get('taps')).toBe('100');
  });
});
