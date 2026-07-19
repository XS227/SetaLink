import { initTapAnalytics, recordTap, flushTapAnalytics } from '../services/tapAnalytics';

jest.mock('../utils/version', () => ({ APP_VERSION: '0.0.0-test' }));

describe('tapAnalytics — batched tap telemetry (B-24)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    (globalThis as any).fetch = fetchMock;
    initTapAnalytics('dev-test-1');
  });

  afterEach(() => {
    flushTapAnalytics(); // drain any leftover buffer between tests
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not call fetch for a single tap before the flush interval', () => {
    recordTap('Home', 'connect_button');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flushes on the timer, batching multiple taps into one request', () => {
    recordTap('Home', 'connect_button');
    recordTap('Game', 'tap_coin');
    jest.advanceTimersByTime(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('action=track-taps-batch');
    const body = opts.body as FormData;
    const taps = JSON.parse((body as any).get('taps'));
    expect(taps).toHaveLength(2);
    expect(taps[0]).toMatchObject({ screen: 'Home', element: 'connect_button' });
  });

  it('flushes early once the buffer hits the max batch size, without waiting for the timer', () => {
    for (let i = 0; i < 30; i++) recordTap('Servers', `row_${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes protocol/node when passed (connection-quality signal, optional)', () => {
    recordTap('Game', 'tap_coin', 'VLESS+Reality', 'node-42');
    recordTap('Game', 'tap_coin'); // no VPN context — omitted, not empty strings
    flushTapAnalytics();
    const body = fetchMock.mock.calls[0][1].body as FormData;
    const taps = JSON.parse((body as any).get('taps'));
    expect(taps[0]).toMatchObject({ protocol: 'VLESS+Reality', node: 'node-42' });
    expect(taps[1].protocol).toBeUndefined();
  });

  it('flushTapAnalytics sends immediately and clears the buffer', () => {
    recordTap('Profile', 'avatar_chip');
    flushTapAnalytics();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    jest.advanceTimersByTime(15_000);
    expect(fetchMock).not.toHaveBeenCalled(); // nothing left to send
  });
});
