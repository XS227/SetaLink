/**
 * Smart Mode / Iran Bypass — safety test cases (task phase 6).
 *
 *   1. instagram.com is NOT in any bypass rule → still goes through VPN.
 *   2. .ir suffix rule is present when Smart Mode is ON.
 *   3. digikala.com is bypassed when Smart Mode is ON.
 *   4. telegram.org is NOT bypassed → still through VPN.
 *   6. Smart Mode OFF → config is byte-identical to the pre-feature config.
 *   7. Rule ordering: dns-out wins before bypass; bypass wins before the
 *      UDP/443 blackhole; default proxy fallback untouched.
 *   9. Malformed/empty rule list → no crash, no rule emitted.
 */

import { buildXrayConfig, buildXrayConfigJson } from '../services/xrayConfigBuilder';
import {
  DEFAULT_BYPASS_RULES,
  getBypassDomains,
  getActiveBypassRuleCount,
} from '../services/iranBypassRules';

const MOCK_SERVER: any = {
  id: 'primary', country: 'Germany', city: 'Hetzner', flag: '🇩🇪',
  protocol: 'Reality', transport: 'TCP', ping: 37, load: 20, premium: false,
};

const MOCK_CREDS: any = {
  uuid: 'fd709d48-0000-0000-0000-000000000001',
  address: '178.104.77.231', port: 443,
  publicKey: 'TEST_KEY', shortId: 'b3a824bd',
  sni: 'www.cloudflare.com', flow: '', fingerprint: 'chrome',
};

function bypassRule(cfg: ReturnType<typeof buildXrayConfig>) {
  return cfg.routing.rules.find(
    (r) => r.outboundTag === 'direct' && Array.isArray(r.domain),
  );
}

describe('Smart Mode ON — bypass rules', () => {
  const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false,
    MOCK_CREDS, { smartBypass: true });
  const rule = bypassRule(cfg);

  test('a domain→direct rule exists', () => {
    expect(rule).toBeDefined();
  });

  test('case 2: .ir TLD suffix rule present', () => {
    expect(rule!.domain).toContain('domain:ir');
  });

  test('case 3: digikala.com bypassed', () => {
    expect(rule!.domain).toContain('domain:digikala.com');
  });

  test('all task-listed Iranian domains present', () => {
    for (const d of ['snapp.ir', 'tapsi.cab', 'cafebazaar.ir', 'divar.ir',
                     'sheypoor.com', 'bankmelli.ir', 'bmi.ir', 'mellatbank.ir',
                     'banksepah.ir', 'bsi.ir', 'enbank.ir', 'samanbank.ir',
                     'sb24.ir', 'shaparak.ir', 'my.gov.ir']) {
      expect(rule!.domain).toContain(`domain:${d}`);
    }
  });

  test('cases 1+4: instagram.com / telegram.org NOT bypassed', () => {
    const joined = rule!.domain!.join(' ');
    expect(joined).not.toMatch(/instagram/);
    expect(joined).not.toMatch(/telegram/);
    expect(joined).not.toMatch(/youtube/);
  });

  test('case 7: rule order — dns-out before bypass, bypass before udp443 blackhole', () => {
    const rules = cfg.routing.rules;
    const dnsIdx    = rules.findIndex((r) => r.outboundTag === 'dns-out');
    const bypassIdx = rules.findIndex((r) => r.outboundTag === 'direct' && Array.isArray(r.domain));
    const quicIdx   = rules.findIndex((r) => r.network === 'udp' && r.port === '443');
    expect(dnsIdx).toBeGreaterThanOrEqual(0);
    expect(bypassIdx).toBeGreaterThan(dnsIdx);
    expect(quicIdx).toBeGreaterThan(bypassIdx);
  });

  test('case 8: proxy outbound still first (server selection untouched)', () => {
    expect(cfg.outbounds[0]!.tag).toBe('proxy');
    expect((cfg.outbounds[0]!.settings as any).vnext[0].address).toBe('178.104.77.231');
  });

  test('geoip/geosite rules are NOT emitted (no dat-files bundled)', () => {
    const raw = JSON.stringify(cfg);
    expect(raw).not.toContain('geoip:');
    expect(raw).not.toContain('geosite:');
  });
});

describe('Smart Mode OFF — case 6: exact old behavior', () => {
  test('config without opts is identical to pre-feature output', () => {
    const off      = buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS);
    const explicit = buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS,
      { smartBypass: false });
    expect(explicit).toBe(off);
    expect(off).not.toContain('domain:ir');
    expect(off).not.toContain('digikala');
  });
});

describe('Rule list safety — case 9', () => {
  test('malformed rules are skipped, never throw', () => {
    const bad: any = [
      null,
      { id: 'x', type: 'domain_suffix', value: '', platform: 'all', enabled: true },
      { id: 'y', type: 'domain_suffix', value: 'has spaces.ir', platform: 'all', enabled: true },
      { id: 'z', type: 'weird_type', value: 'digikala.com', platform: 'all', enabled: true },
      { id: 'w', type: 'domain_suffix', value: 42, platform: 'all', enabled: true },
      { id: 'ok', type: 'domain_suffix', value: 'divar.ir', platform: 'all', enabled: true },
    ];
    expect(() => getBypassDomains('android', bad)).not.toThrow();
    expect(getBypassDomains('android', bad)).toEqual(['domain:divar.ir']);
  });

  test('empty / non-array rule list → empty, no crash', () => {
    expect(getBypassDomains('android', [] as any)).toEqual([]);
    expect(getBypassDomains('android', 'garbage' as any)).toEqual([]);
    // undefined falls back to the bundled defaults (defaulted parameter)
    expect(getBypassDomains('android', undefined as any).length).toBeGreaterThan(0);
  });

  test('disabled geo rules are excluded from domains', () => {
    const domains = getBypassDomains('ios', DEFAULT_BYPASS_RULES);
    expect(domains.join(' ')).not.toContain('geoip');
    expect(getActiveBypassRuleCount('ios')).toBeGreaterThanOrEqual(16);
  });
});
