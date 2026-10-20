jest.mock('../services/vpnBridge', () => {
  const adapter = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getProbeResult: jest.fn().mockResolvedValue(true),
  };
  return { getAdapter: () => adapter, getLastConnectLog: () => [],
    getLastConnectProbeOk: () => true, setDiagnosticContext: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('../services/xrayConfigBuilder', () => ({
  validateCreds: () => ({ valid: true }), buildXrayConfigJson: () => '{}',
}));
jest.mock('../services/sshConfigBuilder', () => ({ buildRealSshConfigJson: () => '{}' }));
jest.mock('../services/vpnMetricsStore', () => ({ appendMetric: jest.fn() }));
jest.mock('../services/remoteConfigService', () => ({
  getCachedConfig: () => ({ failover_max_nodes: 2, nodes_disabled: [] }),
}));
jest.mock('../services/updateService', () => ({ isVpnUpdateBlocked: () => false }));
jest.mock('../services/sessionTelemetry', () => ({ reportSessionOutcome: jest.fn() }));
jest.mock('../stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: null }) } }));
jest.mock('../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
jest.mock('../stores/aiStore', () => ({ useAIStore: { getState: () => ({
  autoConnect: {}, addLogEntry: jest.fn(),
}) } }));
jest.mock('../stores/serverStore', () => {
  const servers = ['a', 'b', 'c'].map((id) => ({ id, country: 'Test', city: id,
    protocol: 'Reality', transport: 'tcp', successScore: 90, available: true }));
  const state = { servers, selectedId: 'a', userSelectedId: '',
    importedCreds: { a: {}, b: {}, c: {} }, getImportedCreds: () => ({}),
    restoreUserSelection: jest.fn(),
    selectServer: jest.fn((id: string) => {
      state.selectedId = id;
      require('../stores/vpnStore').useVpnStore.setState({ selectedServer: servers.find((s) => s.id === id) });
    }),
  };
  return { useServerStore: { getState: () => state } };
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('VPN recovery with the real store and connection machine', () => {
  let store: typeof import('../stores/vpnStore').useVpnStore;
  let adapter: ReturnType<typeof import('../services/vpnBridge').getAdapter>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    store = require('../stores/vpnStore').useVpnStore;
    adapter = require('../services/vpnBridge').getAdapter();
    store.setState({ selectedServer: require('../stores/serverStore').useServerStore.getState().servers[0] });
    store.getState().connect();
    await flush();
    expect(store.getState().connectionState).toBe('connected');
  });
  afterEach(async () => {
    store.getState().disconnect();
    await flush();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function dropAndReconnect() {
    store.getState().reportTrafficStall();
    await flush();
    jest.advanceTimersByTime(700);
    await flush();
  }

  it('retains the first strike across a short reconnect and actually starts the next node on the second drop', async () => {
    await dropAndReconnect();
    expect(store.getState()._unexpectedDropCount).toBe(1);
    expect(store.getState().selectedServer?.id).toBe('a');
    await dropAndReconnect();
    expect(store.getState().selectedServer?.id).toBe('b');
    expect(store.getState().connectionState).toBe('connected');
    expect(store.getState()._triedNodeIds).toEqual(['a']);
    expect(adapter.connect).toHaveBeenCalledTimes(3);
  });

  it('only clears history after 60 seconds with confirmed healthy routing', async () => {
    await dropAndReconnect();
    jest.advanceTimersByTime(59_000);
    await flush();
    expect(store.getState()._unexpectedDropCount).toBe(1);
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(store.getState()._unexpectedDropCount).toBe(0);
    await dropAndReconnect();
    expect(store.getState().selectedServer?.id).toBe('a');
  });

  it('does not reset history when health cannot be confirmed', async () => {
    await dropAndReconnect();
    (adapter.getProbeResult as jest.Mock).mockResolvedValue(false);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(store.getState()._unexpectedDropCount).toBe(1);
  });

  it('manual stop cancels a queued reconnect', async () => {
    store.getState().reportTrafficStall();
    await flush();
    store.getState().disconnect();
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(adapter.connect).toHaveBeenCalledTimes(1);
    expect(store.getState().connectionState).toBe('idle');
  });

  it('exhausts the node budget instead of bouncing back to already failed nodes', async () => {
    for (let i = 0; i < 4; i++) await dropAndReconnect();
    expect(store.getState().connectionState).toBe('idle');
    expect(store.getState().error).toContain('unstable');
    expect(adapter.connect).toHaveBeenCalledTimes(4);
    expect(store.getState()._triedNodeIds).toEqual(['a', 'b']);
  });
});
