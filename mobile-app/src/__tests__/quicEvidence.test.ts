/**
 * Build 80 — app-process QUIC evidence orchestration.
 *
 * The service must: wait for the tunnel to settle, only probe a verified
 * tunnel, retry an inconclusive BOTH_FAIL once, post the verdict as a
 * 'quic_probe' telemetry row, and never fire after a disconnect.
 */
import { scheduleQuicEvidenceProbe, cancelQuicEvidenceProbe } from '../services/quicEvidenceService';

jest.mock('../services/api/telemetry.api', () => ({
  uploadConnectTelemetry: jest.fn(),
}));

const mockAdapter = {
  getTunnelState: jest.fn(),
  runQuicProbe:   jest.fn(),
};
jest.mock('../services/vpnBridge', () => ({
  getAdapter: () => mockAdapter,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uploadConnectTelemetry } = require('../services/api/telemetry.api');

const okResult = {
  verdict: 'QUIC_OK', line: 'TCP=ok QUIC=ok ⇒ QUIC_OK [app-path]',
  tcpOk: true, tcpMs: 100, tcpDetail: 'HTTP 200',
  quicOk: true, quicMs: 120, quicDetail: 'HTTP 200',
};
const bothFail = {
  ...okResult, verdict: 'BOTH_FAIL', tcpOk: false, quicOk: false,
};

// Let pending promise chains inside the service resolve between timer steps.
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAdapter.getTunnelState.mockResolvedValue('connected_verified');
  mockAdapter.runQuicProbe.mockResolvedValue(okResult);
});
afterEach(() => {
  cancelQuicEvidenceProbe();
  jest.useRealTimers();
});

test('probes after settle and posts the verdict in tunnel_mode', async () => {
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  expect(mockAdapter.runQuicProbe).not.toHaveBeenCalled(); // settle delay respected
  jest.advanceTimersByTime(12_000);
  await flush();
  expect(mockAdapter.runQuicProbe).toHaveBeenCalledTimes(1);
  expect(uploadConnectTelemetry).toHaveBeenCalledWith(expect.objectContaining({
    event: 'quic_probe', node_id: 'fi-hel', tunnel_mode: 'QUIC_OK',
    internet_ok: true, probe_ms: 120,
  }));
});

test('BOTH_FAIL retries once, then records the second verdict', async () => {
  mockAdapter.runQuicProbe
    .mockResolvedValueOnce(bothFail)
    .mockResolvedValueOnce(okResult);
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  jest.advanceTimersByTime(12_000);
  await flush();
  expect(uploadConnectTelemetry).not.toHaveBeenCalled(); // inconclusive — no row yet
  jest.advanceTimersByTime(8_000);
  await flush();
  expect(mockAdapter.runQuicProbe).toHaveBeenCalledTimes(2);
  expect(uploadConnectTelemetry).toHaveBeenCalledWith(
    expect.objectContaining({ tunnel_mode: 'QUIC_OK' }));
});

test('persistent BOTH_FAIL is recorded after the retry (still useful signal)', async () => {
  mockAdapter.runQuicProbe.mockResolvedValue(bothFail);
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  jest.advanceTimersByTime(12_000);
  await flush();
  jest.advanceTimersByTime(8_000);
  await flush();
  expect(uploadConnectTelemetry).toHaveBeenCalledWith(
    expect.objectContaining({ tunnel_mode: 'BOTH_FAIL' }));
});

test('never probes an unverified tunnel', async () => {
  mockAdapter.getTunnelState.mockResolvedValue('degraded');
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  jest.advanceTimersByTime(12_000);
  await flush();
  expect(mockAdapter.runQuicProbe).not.toHaveBeenCalled();
  expect(uploadConnectTelemetry).not.toHaveBeenCalled();
});

test('cancel (disconnect) stops a pending probe', async () => {
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  cancelQuicEvidenceProbe();
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(mockAdapter.runQuicProbe).not.toHaveBeenCalled();
});

test('stale connection check wins over the timer', async () => {
  scheduleQuicEvidenceProbe('fi-hel', () => false); // disconnected before settle
  jest.advanceTimersByTime(12_000);
  await flush();
  expect(mockAdapter.runQuicProbe).not.toHaveBeenCalled();
});

test('adapter errors are swallowed (diagnostics must never throw)', async () => {
  mockAdapter.getTunnelState.mockRejectedValue(new Error('bridge down'));
  scheduleQuicEvidenceProbe('fi-hel', () => true);
  jest.advanceTimersByTime(12_000);
  await expect(flush()).resolves.toBeUndefined();
  expect(uploadConnectTelemetry).not.toHaveBeenCalled();
});
