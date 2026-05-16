jest.mock('../services/api/servers.api', () => ({
  ServersAPI: {
    getConfig: jest.fn(),
  },
}));

import { getServerCredentials, evictServerCache } from '../services/serverConfigService';
import { ServersAPI } from '../services/api/servers.api';

const mockGetConfig = ServersAPI.getConfig as jest.Mock;

const REAL_CREDS = {
  uuid:      'aaaaaaaa-bbbb-4000-8000-cccccccccccc',
  address:   'de1.edge.setalink.net',
  port:      443,
  publicKey: 'LtXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  shortId:   'aabbccdd',
  sni:       'www.microsoft.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  evictServerCache('de1');
  evictServerCache('fi1');
});

describe('getServerCredentials', () => {
  it('returns mock credentials for a mock-token without calling API', async () => {
    const creds = await getServerCredentials('fi1', 'mock-token-12345');
    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(creds).toMatchObject({
      port: 443,
      sni: 'www.microsoft.com',
    });
    expect(typeof creds.uuid).toBe('string');
    expect(typeof creds.publicKey).toBe('string');
  });

  it('calls the API for a real token and returns server creds', async () => {
    mockGetConfig.mockResolvedValueOnce(REAL_CREDS);
    const creds = await getServerCredentials('de1', 'real-bearer-token');
    expect(mockGetConfig).toHaveBeenCalledWith('de1', 'real-bearer-token');
    expect(creds).toEqual(REAL_CREDS);
  });

  it('falls back to mock creds when API returns incomplete data', async () => {
    mockGetConfig.mockResolvedValueOnce({ uuid: 'partial' }); // no publicKey
    const creds = await getServerCredentials('de1', 'real-token');
    // Missing publicKey → falls back to mock
    expect(creds).toMatchObject({ sni: 'www.microsoft.com' });
  });

  it('falls back to mock creds when API throws', async () => {
    mockGetConfig.mockRejectedValueOnce(new Error('network error'));
    const creds = await getServerCredentials('de1', 'real-token');
    expect(creds).toMatchObject({ port: 443 });
  });

  it('caches credentials and skips second API call', async () => {
    mockGetConfig.mockResolvedValueOnce(REAL_CREDS);
    const first  = await getServerCredentials('de1', 'real-token');
    const second = await getServerCredentials('de1', 'real-token');
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // same object reference from cache
  });

  it('re-fetches after evictServerCache clears the entry', async () => {
    mockGetConfig.mockResolvedValue(REAL_CREDS);
    await getServerCredentials('de1', 'real-token');
    evictServerCache('de1');
    await getServerCredentials('de1', 'real-token');
    expect(mockGetConfig).toHaveBeenCalledTimes(2);
  });

  it('mock creds are deterministic for the same serverId', async () => {
    const a = await getServerCredentials('se1', 'mock-token-1');
    evictServerCache('se1');
    const b = await getServerCredentials('se1', 'mock-token-2');
    expect(a.uuid).toBe(b.uuid);
    expect(a.publicKey).toBe(b.publicKey);
  });
});
