/**
 * Bundled cf-edge fallback (2026-07-07).
 *
 * A tester on a hostile network got stranded on the slow Finland direct node
 * because the /v1/servers catalog fetch failed and the Cloudflare-fronted
 * cf-edge node only ever came from that catalog. The bundled fallback must
 * guarantee cf-edge is always present + connectable, whether the fetch fails
 * or succeeds without listing it.
 */
import {
  SERVER_CATALOG,
  BUNDLED_CF_EDGE,
  BUNDLED_CF_EDGE_CREDS,
  CF_EDGE_ID,
  compareForAutoSelect,
  useServerStore,
} from '../stores/serverStore';

const mockList      = jest.fn();
const mockGetConfig  = jest.fn();
jest.mock('../services/api/servers.api', () => ({
  ServersAPI: {
    list:      (...a: any[]) => mockList(...a),
    getConfig: (...a: any[]) => mockGetConfig(...a),
  },
}));

const reset = () => useServerStore.setState({
  servers:       SERVER_CATALOG,
  selectedId:    '',
  importedCreds: { [CF_EDGE_ID]: BUNDLED_CF_EDGE_CREDS },
  isLoading:     false,
  loadError:     null,
});

beforeEach(() => { jest.clearAllMocks(); reset(); });

describe('bundled cf-edge fallback', () => {
  it('cf-edge is in the bundled catalog and is a keyless WebSocket node', () => {
    expect(SERVER_CATALOG.some((s) => s.id === CF_EDGE_ID)).toBe(true);
    expect(BUNDLED_CF_EDGE.protocol).toBe('WebSocket');
    expect(BUNDLED_CF_EDGE_CREDS.publicKey).toBe('');       // WS — no Reality key
    expect(BUNDLED_CF_EDGE_CREDS.wsPath).toBe('/cfws');
    expect(BUNDLED_CF_EDGE_CREDS.edgeAddress).toBe('alanya-turist.no');
  });

  it('default store state ships cf-edge creds (connectable before any fetch)', () => {
    expect(useServerStore.getState().importedCreds[CF_EDGE_ID]).toBeDefined();
  });

  it('SURVIVES a blocked catalog fetch — cf-edge stays in the list + creds', async () => {
    mockList.mockRejectedValue(new Error('network blocked'));
    await useServerStore.getState().fetchServers('anon-token-1');
    const st = useServerStore.getState();
    expect(st.servers.some((s) => s.id === CF_EDGE_ID)).toBe(true);
    expect(st.importedCreds[CF_EDGE_ID]?.wsPath).toBe('/cfws');
    expect(st.loadError).toBe('Using saved server list');
  });

  it('a catalog that OMITS cf-edge still gets it merged back', async () => {
    mockList.mockResolvedValue([
      { id: 'fi-hel', country: 'Finland', city: 'Helsinki', flag: '🇫🇮',
        ping: 20, load: 10, protocol: 'Reality' },
    ]);
    mockGetConfig.mockResolvedValue({
      uuid: 'u', address: '65.109.183.7', port: 443, publicKey: 'k',
      shortId: 's', sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
    });
    await useServerStore.getState().fetchServers('anon-token-2');
    const st = useServerStore.getState();
    expect(st.servers.some((s) => s.id === 'fi-hel')).toBe(true);
    expect(st.servers.some((s) => s.id === CF_EDGE_ID)).toBe(true); // merged back
    expect(st.importedCreds[CF_EDGE_ID]).toBeDefined();
  });

  it('auto-select prefers real success rate, then stealth, over raw ping', () => {
    const r = (o: any) => ({ country: '', city: '', flag: '', load: 0, protocol: 'Reality', ...o });
    // 1. successScore wins even when a rival has much lower ping.
    expect([
      r({ id: 'fast-blocked', ping: 10, successScore: 40 }),
      r({ id: 'reliable',     ping: 90, successScore: 95 }),
    ].sort(compareForAutoSelect)[0].id).toBe('reliable');
    // 2. No telemetry (fresh install): the Stealth/Recommended cf-edge beats a
    //    lower-ping direct node — a censored user lands on a node that works.
    expect([
      r({ id: 'fi',  ping: 20 }),
      r({ id: CF_EDGE_ID, ping: 60, tags: ['Recommended', 'Stealth'] }),
    ].sort(compareForAutoSelect)[0].id).toBe(CF_EDGE_ID);
    // 3. All else equal, lowest ping is the final tiebreak.
    expect([
      r({ id: 'slow', ping: 80 }),
      r({ id: 'quick', ping: 15 }),
    ].sort(compareForAutoSelect)[0].id).toBe('quick');
  });

  it('does not clobber fresher cf-edge creds returned by the catalog', async () => {
    mockList.mockResolvedValue([
      { id: CF_EDGE_ID, country: 'Cloudflare', city: 'Edge', flag: '☁️',
        ping: 55, load: 5, protocol: 'WebSocket' },
    ]);
    mockGetConfig.mockResolvedValue({
      uuid: 'fresh-uuid', address: 'cf.setalink.no', port: 443, publicKey: '',
      shortId: '', sni: 'cf.setalink.no', flow: '', fingerprint: 'chrome', wsPath: '/cfws',
    });
    await useServerStore.getState().fetchServers('anon-token-3');
    expect(useServerStore.getState().importedCreds[CF_EDGE_ID]?.uuid).toBe('fresh-uuid');
  });
});

describe('user node preference vs failover (2026-07-11)', () => {
  const twoNodes = () => useServerStore.setState({
    servers: [
      { id: 'finland', country: 'Finland', city: 'Helsinki', flag: '🇫🇮', ping: 40, load: 5, protocol: 'Reality' } as any,
      { id: CF_EDGE_ID, country: 'Cloudflare', city: 'Edge', flag: '☁️', ping: 60, load: 5, protocol: 'WebSocket', tags: ['Stealth'] } as any,
    ],
    importedCreds: {
      finland:      { uuid: 'fi', address: '1.2.3.4', port: 443, publicKey: 'k', shortId: 's', sni: 'x', flow: 'xtls-rprx-vision', fingerprint: 'chrome' } as any,
      [CF_EDGE_ID]: BUNDLED_CF_EDGE_CREDS,
    },
    selectedId: '', userSelectedId: '',
  });

  it('a manual selection sets the sticky user preference', () => {
    twoNodes();
    useServerStore.getState().selectServer('finland');
    expect(useServerStore.getState().selectedId).toBe('finland');
    expect(useServerStore.getState().userSelectedId).toBe('finland');
  });

  it('failover (isUser=false) moves the active node but keeps the preference', () => {
    twoNodes();
    useServerStore.getState().selectServer('finland');           // user picks Finland
    useServerStore.getState().selectServer(CF_EDGE_ID, false);   // failover to stealth
    expect(useServerStore.getState().selectedId).toBe(CF_EDGE_ID);   // active moved
    expect(useServerStore.getState().userSelectedId).toBe('finland'); // preference intact
  });

  it('restoreUserSelection brings the active node back to the user preference', () => {
    twoNodes();
    useServerStore.getState().selectServer('finland');
    useServerStore.getState().selectServer(CF_EDGE_ID, false);   // failover
    useServerStore.getState().restoreUserSelection();            // fresh connect
    expect(useServerStore.getState().selectedId).toBe('finland');
  });

  it('restoreUserSelection is a no-op when the preference node lost its creds', () => {
    twoNodes();
    useServerStore.getState().selectServer('finland');
    useServerStore.getState().selectServer(CF_EDGE_ID, false);
    useServerStore.setState({ importedCreds: { [CF_EDGE_ID]: BUNDLED_CF_EDGE_CREDS } }); // finland creds gone
    useServerStore.getState().restoreUserSelection();
    expect(useServerStore.getState().selectedId).toBe(CF_EDGE_ID); // stays on failover node
  });
});
