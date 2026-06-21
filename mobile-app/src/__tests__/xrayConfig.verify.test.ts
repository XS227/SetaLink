/**
 * Verification tests for DNS + logging fixes (pre-APK build gate).
 *
 * Checks:
 *   1. No DoH URLs in any DNS profile
 *   2. loglevel is 'warning', not 'debug', in normal (non-emergency) config
 *   3. DNS IPs match port-53 routing rule → go direct, not through proxy
 *   4. Emergency config still uses 'debug' (diagnostic intent preserved)
 *   5. Auto-select: existing selectedId is preserved in fetchServers logic
 *   6. Auto-select: new user (no selectedId) gets lowest-ping server
 */

import {
  buildXrayConfig,
  buildXrayConfigJson,
  buildEmergencyXrayConfigJson,
} from '../services/xrayConfigBuilder';

const MOCK_SERVER: any = {
  id: 'primary', country: 'Germany', city: 'Hetzner', flag: '🇩🇪',
  protocol: 'Reality', transport: 'TCP', ping: 37, load: 20, premium: false,
};

const MOCK_CREDS: any = {
  uuid: 'fd709d48-0000-0000-0000-000000000001',
  address: '178.104.77.231', port: 443,
  publicKey: 'TEST_KEY', shortId: 'b3a824bd',
  sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
  edgeAddress: 'edge.setalink.no', edgePort: 443,
  wsPath: '/ws', xhttpPath: '/xhttp/', httpupPath: '/httpup',
};

// ── Helper ────────────────────────────────────────────────────────────────────

function allDnsServers(cfg: ReturnType<typeof buildXrayConfig>): string[] {
  return cfg.dns.servers.map((s) => (typeof s === 'string' ? s : (s as any).address ?? ''));
}

// ── 1. No DoH URLs ────────────────────────────────────────────────────────────

describe('DNS: no DoH URLs', () => {
  const modes = ['Cloudflare (DoH)', 'Google (DoH)', 'System'];

  test.each(modes)('profile "%s" contains no https:// entries', (mode) => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', mode, false, MOCK_CREDS);
    const servers = allDnsServers(cfg);
    for (const s of servers) {
      expect(s).not.toMatch(/^https?:\/\//);
    }
  });

  test('buildXrayConfigJson (Cloudflare) has no DoH', () => {
    const raw = buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS);
    expect(raw).not.toContain('dns-query');
    expect(raw).not.toContain('https://');
  });
});

// ── 2. loglevel is 'warning' in production config ────────────────────────────

describe('Log level', () => {
  test('buildXrayConfigJson produces loglevel=warning', () => {
    const raw = buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS);
    const cfg = JSON.parse(raw);
    expect(cfg.log.loglevel).toBe('warning');
  });

  test('buildXrayConfig(debugMode=false) produces warning', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    expect(cfg.log.loglevel).toBe('warning');
  });

  test('buildXrayConfig(debugMode=true) still produces debug', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', true, MOCK_CREDS);
    expect(cfg.log.loglevel).toBe('debug');
  });

  test('emergency config retains debug (diagnostic intent)', () => {
    const raw = buildEmergencyXrayConfigJson(MOCK_SERVER, 'Reality', MOCK_CREDS);
    const cfg = JSON.parse(raw);
    expect(cfg.log.loglevel).toBe('debug');
  });
});

// ── 3. DNS IPs are plain — routable via port-53 rule ────────────────────────

describe('DNS servers are plain IPs routable via port-53 → dns-out (direct)', () => {
  test('Cloudflare profile contains 1.1.1.1 and 1.0.0.1', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const servers = allDnsServers(cfg);
    expect(servers).toContain('1.1.1.1');
    expect(servers).toContain('1.0.0.1');
  });

  test('Google profile contains 8.8.8.8 and 8.8.4.4', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Google (DoH)', false, MOCK_CREDS);
    const servers = allDnsServers(cfg);
    expect(servers).toContain('8.8.8.8');
    expect(servers).toContain('8.8.4.4');
  });

  test('routing has port-53 → dns-out rule', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const dnsRule = cfg.routing.rules.find((r) => r.port === '53');
    expect(dnsRule).toBeDefined();
    expect(dnsRule?.outboundTag).toBe('dns-out');
  });
});

// ── 4. Reality outbound structure unchanged ───────────────────────────────────

describe('Reality outbound structure', () => {
  test('flow, fingerprint, sni, publicKey preserved', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const proxy = cfg.outbounds.find((o) => o.tag === 'proxy')!;
    const user = (proxy.settings as any).vnext[0].users[0];
    expect(user.flow).toBe('xtls-rprx-vision');
    const rs = (proxy.streamSettings as any).realitySettings;
    expect(rs.fingerprint).toBe('chrome');
    expect(rs.serverName).toBe('www.cloudflare.com');
    expect(rs.publicKey).toBe('TEST_KEY');
  });

  test('no mux or sockopt on Reality outbound', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const proxy = cfg.outbounds.find((o) => o.tag === 'proxy')!;
    expect((proxy.streamSettings as any).sockopt).toBeUndefined();
    expect((proxy as any).mux).toBeUndefined();
  });
});

// ── 5 & 6. Auto-select logic (serverStore) ───────────────────────────────────

// ── 5 & 6. Auto-select logic (serverStore) ───────────────────────────────────
// Tested by calling fetchServers on the store directly with a mocked API.

jest.mock('../services/api/servers.api', () => ({
  ServersAPI: {
    list: jest.fn().mockResolvedValue([
      { id: 'primary', country: 'Germany', city: 'Hetzner', flag: '🇩🇪', ping: 37, load: 20, protocol: 'Reality' },
      { id: 'fi-hel',  country: 'Finland', city: 'Helsinki', flag: '🇫🇮', ping: 21, load: 10, protocol: 'Reality' },
    ]),
    getConfig: jest.fn().mockImplementation((id: string) =>
      Promise.resolve({
        uuid: `uuid-${id}`, publicKey: `pk-${id}`, shortId: 'aa',
        address: id === 'fi-hel' ? '65.109.183.7' : '178.104.77.231',
        port: 443, sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
      })
    ),
  },
}));

jest.mock('../stores/vpnStore', () => ({
  useVpnStore: { getState: () => ({ setSelectedServer: jest.fn() }) },
}));

jest.mock('../storage/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import { useServerStore } from '../stores/serverStore';

describe('Auto-select fastest server', () => {
  test('existing user with valid selectedId keeps their choice', async () => {
    useServerStore.setState({
      servers:       [{ id: 'primary', country: 'Germany', city: 'Hetzner', flag: '🇩🇪', ping: 37, load: 20, protocol: 'Reality' }],
      selectedId:    'primary',
      importedCreds: {},
    } as any);

    await useServerStore.getState().fetchServers('device-test-token');

    expect(useServerStore.getState().selectedId).toBe('primary');
  });

  test('new user (no selectedId) gets lowest-ping server (Finland)', async () => {
    useServerStore.setState({ servers: [], selectedId: '', importedCreds: {} } as any);

    await useServerStore.getState().fetchServers('device-test-token');

    expect(useServerStore.getState().selectedId).toBe('fi-hel');
  });

  test('user whose previously selected server no longer exists gets lowest-ping fallback', async () => {
    useServerStore.setState({ servers: [], selectedId: 'old-removed-server', importedCreds: {} } as any);

    await useServerStore.getState().fetchServers('device-test-token');

    expect(useServerStore.getState().selectedId).toBe('fi-hel');
  });
});
