import { act } from 'react-test-renderer';

// Pull the raw creator so we can instantiate a fresh store per test
// without polluting the singleton used by components
jest.mock('react-native-mmkv', () => ({}), { virtual: true });
jest.mock('../storage/storage', () => ({
  storage: {
    getItem:    () => null,
    setItem:    () => {},
    removeItem: () => {},
  },
}));

// Zustand persist requires storage; use the mock above
let useSessionStore: ReturnType<typeof import('../stores/sessionStore')['useSessionStore']>;

beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useSessionStore = require('../stores/sessionStore').useSessionStore;
  // Clear all sessions before each test
  act(() => { useSessionStore.getState().clearHistory(); });
});

function makeSession(overrides: Partial<import('../stores/sessionStore').SessionRecord> = {}) {
  const now = Date.now();
  return {
    serverId:   'de1',
    serverName: 'Frankfurt, Germany',
    serverFlag: '🇩🇪',
    protocol:   'VLESS',
    startedAt:  now - 60_000,
    endedAt:    now,
    duration:   60,
    sentBytes:  1_000_000,
    recvBytes:  5_000_000,
    status:     'success' as const,
    ...overrides,
  };
}

describe('sessionStore', () => {
  it('starts empty', () => {
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it('addSession prepends and assigns id', () => {
    act(() => { useSessionStore.getState().addSession(makeSession()); });
    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(typeof sessions[0]!.id).toBe('string');
  });

  it('caps at 100 sessions', () => {
    act(() => {
      for (let i = 0; i < 110; i++) {
        useSessionStore.getState().addSession(makeSession());
      }
    });
    expect(useSessionStore.getState().sessions).toHaveLength(100);
  });

  it('sessionsToday returns only today sessions', () => {
    const yesterday = Date.now() - 90_000_000; // ~25 hours ago
    act(() => {
      useSessionStore.getState().addSession(makeSession()); // today
      useSessionStore.getState().addSession(makeSession({ startedAt: yesterday, endedAt: yesterday + 60_000 }));
    });
    expect(useSessionStore.getState().sessionsToday()).toHaveLength(1);
  });

  it('totalBytesToday sums sent + received for today', () => {
    act(() => {
      useSessionStore.getState().addSession(makeSession({ sentBytes: 1_000, recvBytes: 4_000 }));
      useSessionStore.getState().addSession(makeSession({ sentBytes: 2_000, recvBytes: 3_000 }));
    });
    expect(useSessionStore.getState().totalBytesToday()).toBe(10_000);
  });

  it('totalDurationToday sums durations for today', () => {
    act(() => {
      useSessionStore.getState().addSession(makeSession({ duration: 120 }));
      useSessionStore.getState().addSession(makeSession({ duration: 300 }));
    });
    expect(useSessionStore.getState().totalDurationToday()).toBe(420);
  });

  it('hourlyDownload returns 24-element array', () => {
    act(() => { useSessionStore.getState().addSession(makeSession()); });
    const bins = useSessionStore.getState().hourlyDownload();
    expect(bins).toHaveLength(24);
    expect(bins.some((b) => b > 0)).toBe(true);
  });

  it('clearHistory empties sessions', () => {
    act(() => { useSessionStore.getState().addSession(makeSession()); });
    act(() => { useSessionStore.getState().clearHistory(); });
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });
});
