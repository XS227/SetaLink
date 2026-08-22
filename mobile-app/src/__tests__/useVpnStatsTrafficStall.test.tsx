/**
 * Zombie-tunnel detection (2026-08-22).
 *
 * Khabat's own device (build 178/0.9.138) showed "Connected" while apps
 * loaded almost nothing. The native watchdog (XrayVpnService.kt) already
 * detects zero TUN traffic and logs traffic_stall at 30s/60s/.../480s, but
 * broadcasts it to no listener — the app never acted on it. useVpnStats'
 * existing 3s getStats() poll now counts consecutive zero-byte-delta polls
 * and calls vpnStore.reportTrafficStall() once the tunnel has been silent
 * for STALL_POLL_THRESHOLD polls, reusing the store's existing
 * reconnect-then-failover path for unexpected drops.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useVpnStats } from '../hooks/useVpnStats';

const mockGetStats = jest.fn();
jest.mock('../services/vpnBridge', () => ({
  getAdapter: () => ({ getStats: (...a: any[]) => mockGetStats(...a) }),
}));

jest.mock('../stores/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user: { deviceId: 'dev-test-1', plan: 'premium' } }),
}));

const mockReportTrafficStall = jest.fn();
const mockSetSessionBytes    = jest.fn();
const mockDisconnect         = jest.fn();
const mockSetLastPingMs      = jest.fn();

const mockStoreState = {
  connectionState:    'connected' as string,
  setSessionBytes:    mockSetSessionBytes,
  disconnect:         mockDisconnect,
  reportTrafficStall: mockReportTrafficStall,
  setLastPingMs:      mockSetLastPingMs,
};

jest.mock('../stores/vpnStore', () => {
  const fn: any = (selector: any) => selector(mockStoreState);
  fn.getState = () => mockStoreState;
  return { useVpnStore: fn };
});

function Harness() { useVpnStats(); return null; }

const POLL_MS = 3000;

describe('useVpnStats — zombie tunnel (traffic stall) detection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockStoreState.connectionState = 'connected';
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls reportTrafficStall() once after 20 consecutive zero-delta polls (~60s silent TUN)', async () => {
    // Bytes never move — native reports "connected" but nothing crosses the TUN.
    mockGetStats.mockResolvedValue({ uploadBytes: 1000, downloadBytes: 5000, pingMs: 40, uptime: 60 });

    let root!: renderer.ReactTestRenderer;
    await act(async () => { root = renderer.create(<Harness />); });

    for (let i = 0; i < 25; i++) {
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(mockReportTrafficStall).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it('does NOT call reportTrafficStall() while bytes keep increasing', async () => {
    let bytes = 0;
    mockGetStats.mockImplementation(async () => {
      bytes += 10_000;
      return { uploadBytes: bytes, downloadBytes: bytes, pingMs: 40, uptime: 60 };
    });

    let root!: renderer.ReactTestRenderer;
    await act(async () => { root = renderer.create(<Harness />); });

    for (let i = 0; i < 25; i++) {
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(mockReportTrafficStall).not.toHaveBeenCalled();
    root.unmount();
  });

  it('does not run the poll loop at all when not connected', async () => {
    mockStoreState.connectionState = 'idle';
    mockGetStats.mockResolvedValue({ uploadBytes: 1000, downloadBytes: 5000, pingMs: 40, uptime: 60 });

    let root!: renderer.ReactTestRenderer;
    await act(async () => { root = renderer.create(<Harness />); });

    for (let i = 0; i < 25; i++) {
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS);
        await Promise.resolve();
      });
    }

    expect(mockGetStats).not.toHaveBeenCalled();
    expect(mockReportTrafficStall).not.toHaveBeenCalled();
    root.unmount();
  });
});
