jest.mock('../services/vpnBridge', () => ({
  getLastConnectProbeOk: jest.fn(() => true),
  getLastConnectFailureCategory: jest.fn(() => ''),
}));
jest.mock('../services/successHistory', () => ({
  recordSuccess: jest.fn(), recordFailure: jest.fn(),
  sortByHistory: jest.fn((ids: string[]) => ids), getTopProfiles: jest.fn(() => []),
}));
jest.mock('../services/remoteConfigService', () => ({
  getRemoteConfig: jest.fn(), isKillSwitched: jest.fn(() => false), invalidateRemoteConfig: jest.fn(),
}));
jest.mock('../services/profileBundleService', () => ({ prefetchBundle: jest.fn() }));
jest.mock('../services/iranBypassRules', () => ({ getSelectedAppBypassDomains: jest.fn(() => []) }));
jest.mock('../services/api/telemetry.api', () => ({ uploadConnectTelemetry: jest.fn() }));

import { buildAutoProfiles } from '../services/autoConnector';
import type { VpnServer } from '../stores/vpnStore';
import type { ServerCredentials } from '../services/serverConfigService';

const server = { id: 'dk-cph' } as VpnServer;
const creds = {
  uuid: 'u', address: '5.249.255.116', port: 443, publicKey: 'pk', shortId: 'sid',
  sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
  edgeAddress: 'edge.setalink.no',
  altProfiles: [{
    uuid: 'u', address: '5.249.255.116', port: 443, publicKey: 'pk', shortId: 'sid',
    sni: 'static.setai.no', flow: 'xtls-rprx-vision', fingerprint: 'chrome',
  }],
} as unknown as ServerCredentials;
const iranOrder = ['www.cloudflare.com', 'www.microsoft.com', 'www.bing.com', 'www.apple.com'];

describe('buildAutoProfiles ordering', () => {
  it.each(['iran', 'auto'] as const)('%s mode tries the self-steal SNI first, then the node SNI', (mode) => {
    const p = buildAutoProfiles(server, creds, mode, iranOrder);
    expect(p[0]!.sni).toBe('static.setai.no');
    expect(p[0]!.credOverride?.address).toBe('5.249.255.116');
    expect(p[1]!.sni).toBe('www.cloudflare.com');
    expect(p[2]!.protocol).toBe('VLESS+XHTTP');
  });

  it('drops spoof SNIs and caps the extra priority SNIs at two', () => {
    const p = buildAutoProfiles(server, creds, 'iran', iranOrder);
    expect(p.some(x => x.label.startsWith('Stealth'))).toBe(false);
    const extras = p.filter(x => x.id.startsWith('iran-sni'));
    expect(extras.map(x => x.sni)).toEqual(['www.microsoft.com', 'www.bing.com']);
    expect(p.length).toBeLessThanOrEqual(8);
    expect(p[p.length - 1]!.emergency).toBe(true);
  });

  it('keeps profile ids unique', () => {
    const p = buildAutoProfiles(server, creds, 'iran', iranOrder);
    expect(new Set(p.map(x => x.id)).size).toBe(p.length);
  });
});
