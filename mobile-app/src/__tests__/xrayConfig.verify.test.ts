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
      // CDN-fronted WebSocket node — served with publicKey:'' (no Reality key)
      { id: 'cf-edge', country: 'Cloudflare', city: 'CDN Edge', flag: '☁️', ping: 99, load: 5, protocol: 'WebSocket' },
      // Reality node with a broken (empty-key) config — must still be rejected
      { id: 'broken-reality', country: 'Nowhere', city: 'X', flag: '❓', ping: 88, load: 5, protocol: 'Reality' },
    ]),
    getConfig: jest.fn().mockImplementation((id: string) => {
      if (id === 'cf-edge') {
        return Promise.resolve({
          uuid: 'uuid-cf-edge', publicKey: '', shortId: '',
          address: 'cf.setalink.no', edgeAddress: 'cf.setalink.no', wsPath: '/cfws',
          port: 443, sni: 'cf.setalink.no', flow: '', fingerprint: 'chrome',
        });
      }
      if (id === 'broken-reality') {
        return Promise.resolve({ uuid: 'uuid-broken', publicKey: '', address: '1.2.3.4', port: 443 });
      }
      return Promise.resolve({
        uuid: `uuid-${id}`, publicKey: `pk-${id}`, shortId: 'aa',
        address: id === 'fi-hel' ? '65.109.183.7' : '178.104.77.231',
        port: 443, sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
      });
    }),
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

// ── 7. QUIC (UDP/443) must not ride a Vision outbound ───────────────────────
// xray-core rejects UDP/443 on VLESS outbounds with flow=xtls-rprx-vision
// ("XTLS rejected UDP/443 traffic"), so Vision servers need a flow-less
// 'proxy-quic' twin and the UDP/443 rule must target it.

describe('QUIC outbound: Vision servers get a flow-less proxy-quic twin', () => {
  // The catch-all QUIC rule carries no domain; the AI-provider QUIC rule does.
  const udp443Rule = (cfg: any) =>
    cfg.routing.rules.find((r: any) => r.network === 'udp' && r.port === '443' && !r.domain);

  test('Vision creds → proxy-quic outbound exists, flow-less, same creds', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const quic = cfg.outbounds.find((o: any) => o.tag === 'proxy-quic');
    expect(quic).toBeDefined();
    const quicUser = quic.settings.vnext[0].users[0];
    expect(quicUser.flow).toBeUndefined();
    expect(quicUser.id).toBe(MOCK_CREDS.uuid);
    expect(quic.settings.vnext[0].address).toBe(MOCK_CREDS.address);
    expect(quic.streamSettings.security).toBe('reality');
    // main proxy outbound keeps its Vision flow untouched
    const proxy = cfg.outbounds.find((o: any) => o.tag === 'proxy');
    expect(proxy.settings.vnext[0].users[0].flow).toBe('xtls-rprx-vision');
  });

  test('Vision creds → UDP/443 rule targets proxy-quic', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    expect(udp443Rule(cfg).outboundTag).toBe('proxy-quic');
  });

  test('flow-less creds (Germany) → no proxy-quic, UDP/443 stays on proxy', () => {
    const creds = { ...MOCK_CREDS, flow: '' };
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, creds);
    expect(cfg.outbounds.find((o: any) => o.tag === 'proxy-quic')).toBeUndefined();
    expect(udp443Rule(cfg).outboundTag).toBe('proxy');
  });

  test('WebSocket protocol (never has flow) → no proxy-quic', () => {
    const cfg: any = buildXrayConfig(
      { ...MOCK_SERVER, protocol: 'WebSocket' }, 'WebSocket', 'Cloudflare (DoH)', false, MOCK_CREDS,
    );
    expect(cfg.outbounds.find((o: any) => o.tag === 'proxy-quic')).toBeUndefined();
    expect(udp443Rule(cfg).outboundTag).toBe('proxy');
  });

  // build 86 (Iran Stealth): CDN-fronted outbounds must DIAL a literal Cloudflare
  // IP, not the hostname. On iOS the tunnel resolves DNS through itself, so a
  // hostname edge address deadlocks the handshake (0 /cfws reached origin on
  // b84/b85). The domain must survive only in the TLS SNI + Host header so
  // Cloudflare still routes to origin by SNI.
  test('WebSocket/CDN dials literal edge IP; domain stays in SNI + Host', () => {
    const wsCreds = { ...MOCK_CREDS, edgeAddress: 'alanya-turist.no', edgeIp: '104.21.61.220', flow: '' };
    const cfg: any = buildXrayConfig(
      { ...MOCK_SERVER, protocol: 'WebSocket' }, 'WebSocket', 'Cloudflare (DoH)', false, wsCreds,
    );
    const proxy = cfg.outbounds.find((o: any) => o.tag === 'proxy');
    // Dial the IP — no DNS needed, so no resolve-through-tunnel deadlock.
    expect(proxy.settings.vnext[0].address).toBe('104.21.61.220');
    // SNI + Host carry the real domain so Cloudflare routes to origin.
    expect(proxy.streamSettings.tlsSettings.serverName).toBe('alanya-turist.no');
    expect(proxy.streamSettings.wsSettings.headers.Host).toBe('alanya-turist.no');
  });

  test('CDN edge IP falls back to a Cloudflare anycast IP when creds omit edgeIp', () => {
    const wsCreds = { ...MOCK_CREDS, edgeAddress: 'alanya-turist.no', flow: '' };
    delete (wsCreds as any).edgeIp;
    const cfg: any = buildXrayConfig(
      { ...MOCK_SERVER, protocol: 'WebSocket' }, 'WebSocket', 'Cloudflare (DoH)', false, wsCreds,
    );
    const proxy = cfg.outbounds.find((o: any) => o.tag === 'proxy');
    // A literal IPv4, never the hostname (that would re-introduce the deadlock).
    expect(proxy.settings.vnext[0].address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(proxy.streamSettings.tlsSettings.serverName).toBe('alanya-turist.no');
  });

  test('emergency config mirrors the same behavior', () => {
    const vision: any = JSON.parse(buildEmergencyXrayConfigJson(MOCK_SERVER, 'Reality', MOCK_CREDS));
    expect(vision.outbounds.find((o: any) => o.tag === 'proxy-quic')).toBeDefined();
    expect(udp443Rule(vision).outboundTag).toBe('proxy-quic');

    const noflow: any = JSON.parse(
      buildEmergencyXrayConfigJson(MOCK_SERVER, 'Reality', { ...MOCK_CREDS, flow: '' }),
    );
    expect(noflow.outbounds.find((o: any) => o.tag === 'proxy-quic')).toBeUndefined();
    expect(udp443Rule(noflow).outboundTag).toBe('proxy');
  });
});

// ── 8. Catalog creds: WS/CDN nodes have no Reality publicKey ─────────────────
// cf-edge is served with publicKey:"" — the old filter required a truthy key
// for every node, so its creds were discarded, selecting it could never
// connect, and the failover bounced the user back to the primary node.

describe('fetchServers keeps creds for non-Reality nodes without publicKey', () => {
  test('cf-edge (WebSocket, empty publicKey) creds are kept', async () => {
    useServerStore.setState({ servers: [], selectedId: 'primary', importedCreds: {} } as any);
    await useServerStore.getState().fetchServers('device-test-token');
    const creds = useServerStore.getState().importedCreds['cf-edge'];
    expect(creds).toBeDefined();
    expect(creds.uuid).toBe('uuid-cf-edge');
    expect(creds.wsPath).toBe('/cfws');
  });

  test('Reality node with empty publicKey is still rejected', async () => {
    useServerStore.setState({ servers: [], selectedId: 'primary', importedCreds: {} } as any);
    await useServerStore.getState().fetchServers('device-test-token');
    expect(useServerStore.getState().importedCreds['broken-reality']).toBeUndefined();
    // sanity: Reality nodes with real keys still work
    expect(useServerStore.getState().importedCreds['fi-hel']).toBeDefined();
  });
});

// ── AI-provider routing: Gemini QUIC fix + clean-exit scaffold ────────────────

describe('AI routing rules (Claude/Gemini/OpenAI)', () => {
  const aiRule = (cfg: any, tag: string) =>
    cfg.routing.rules.find((r: any) => r.outboundTag === tag && Array.isArray(r.domain) &&
      r.domain.some((d: string) => d.includes('gemini') || d.includes('anthropic')));

  test('AI-provider QUIC (UDP/443) is blackholed so it falls back to TCP — always on', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const rule = cfg.routing.rules.find((r: any) =>
      r.network === 'udp' && r.port === '443' && Array.isArray(r.domain));
    expect(rule).toBeDefined();
    expect(rule.outboundTag).toBe('blackhole');
    expect(rule.domain).toEqual(expect.arrayContaining(['domain:gemini.google.com', 'domain:anthropic.com']));
  });

  test('AI QUIC blackhole rule precedes the catch-all UDP/443 rule', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    const aiQuic  = cfg.routing.rules.findIndex((r: any) => r.network === 'udp' && r.port === '443' && r.domain);
    const generic = cfg.routing.rules.findIndex((r: any) => r.network === 'udp' && r.port === '443' && !r.domain);
    expect(aiQuic).toBeGreaterThanOrEqual(0);
    expect(generic).toBeGreaterThan(aiQuic);
  });

  test('no clean exit configured → no ai-out outbound and no TCP pin (unchanged proxy path)', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS);
    expect(cfg.outbounds.find((o: any) => o.tag === 'ai-out')).toBeUndefined();
    expect(aiRule(cfg, 'ai-out')).toBeUndefined();
  });

  test('clean exit configured → ai-out outbound + AI TCP pinned to it', () => {
    const cfg: any = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, MOCK_CREDS,
      { aiExit: { server: MOCK_SERVER, protocol: 'Reality', creds: MOCK_CREDS } });
    expect(cfg.outbounds.find((o: any) => o.tag === 'ai-out')).toBeDefined();
    expect(aiRule(cfg, 'ai-out')).toBeDefined();
  });
});
