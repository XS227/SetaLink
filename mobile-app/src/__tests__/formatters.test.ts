import {
  formatBytes,
  formatBitrate,
  formatDuration,
  formatTimer,
  formatPing,
  formatRelativeTime,
} from '../utils/formatters';

describe('formatBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes (< 1 KB)', () => {
    expect(formatBytes(500)).toBe('500.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    // 1.5 MB = 1572864 bytes → 1572864/1024/1024 = 1.5
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    // 1 GB = 1073741824 bytes
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
  });

  it('respects custom decimals param', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB');
  });
});

describe('formatBitrate', () => {
  it('returns "0 bps" for zero', () => {
    expect(formatBitrate(0)).toBe('0 bps');
  });

  it('formats bps', () => {
    expect(formatBitrate(500)).toBe('500.0 bps');
  });

  it('formats Kbps', () => {
    expect(formatBitrate(1000)).toBe('1.0 Kbps');
  });

  it('formats Mbps', () => {
    expect(formatBitrate(1_000_000)).toBe('1.0 Mbps');
  });

  it('formats Gbps', () => {
    expect(formatBitrate(1_000_000_000)).toBe('1.0 Gbps');
  });
});

describe('formatDuration', () => {
  it('shows seconds only for < 60s', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('shows minutes and seconds for < 1h', () => {
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('shows hours and minutes for >= 1h', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(7325)).toBe('2h 2m');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('formatTimer', () => {
  it('formats zero as 00:00:00', () => {
    expect(formatTimer(0)).toBe('00:00:00');
  });

  it('formats seconds only', () => {
    expect(formatTimer(5)).toBe('00:00:05');
    expect(formatTimer(59)).toBe('00:00:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatTimer(65)).toBe('00:01:05');
    expect(formatTimer(3599)).toBe('00:59:59');
  });

  it('formats hours', () => {
    expect(formatTimer(3600)).toBe('01:00:00');
    expect(formatTimer(3661)).toBe('01:01:01');
    expect(formatTimer(86399)).toBe('23:59:59');
  });
});

describe('formatPing', () => {
  it('appends " ms" to the number', () => {
    expect(formatPing(24)).toBe('24 ms');
    expect(formatPing(0)).toBe('0 ms');
    expect(formatPing(200)).toBe('200 ms');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns "just now" for < 60s ago', () => {
    const now = new Date();
    jest.setSystemTime(now.getTime() + 30_000);
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns "Xm ago" for < 1h ago', () => {
    const past = new Date();
    jest.setSystemTime(past.getTime() + 5 * 60_000);
    expect(formatRelativeTime(past)).toBe('5m ago');
  });

  it('returns "Xh ago" for < 24h ago', () => {
    const past = new Date();
    jest.setSystemTime(past.getTime() + 3 * 3_600_000);
    expect(formatRelativeTime(past)).toBe('3h ago');
  });

  it('accepts string input', () => {
    const past = new Date();
    jest.setSystemTime(past.getTime() + 5 * 60_000);
    expect(formatRelativeTime(past.toISOString())).toBe('5m ago');
  });
});
