/**
 * Smart Mode / Iran Bypass — safety test cases (task phase 6).
 *
 *   1. instagram.com is NOT in any bypass rule → still goes through VPN.
 *   2. .ir suffix rule is present when Smart Mode is ON.
 *   3. digikala.com is bypassed when Smart Mode is ON.
 *   4. telegram.org is NOT bypassed → still through VPN.
 *   6. Smart Mode OFF → config is byte-identical to the pre-feature config.
 *   7. Rule ordering: dns-out wins before bypass; bypass wins before the
 *      UDP/443 tunnelled (QUIC via proxy); default proxy fallback untouched.
 *   9. Malformed/empty rule list → no crash, no rule emitted.
 */

import { buildXrayConfig, buildXrayConfigJson } from '../services/xrayConfigBuilder';
import {
  DEFAULT_BYPASS_RULES,
  getBypassDomains,
  getActiveBypassRuleCount,
  getAppBypassDomains,
  getSelectedAppBypassDomains,
  IOS_APP_BYPASS_CATALOG,
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

  test('case 7: rule order — dns-out before bypass, bypass before udp443 (QUIC) rule', () => {
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

// Regression (build 76 investigation): Termius / SSH / dev apps and Meta must
// NEVER be auto-classified into the Iran bypass domain list.
describe('bypass list never auto-classifies non-Iranian / dev / Meta', () => {
  const domains = getBypassDomains('android');
  const joined = domains.join(' ');
  test('no Meta/Instagram/facebook/fbcdn domains', () => {
    for (const d of ['instagram', 'facebook', 'fbcdn', 'cdninstagram', 'meta']) {
      expect(joined).not.toContain(d);
    }
  });
  test('no SSH/dev/Termius/git/npm domains', () => {
    for (const d of ['termius', 'server.auditor', 'github', 'npmjs', 'ssh']) {
      expect(joined).not.toContain(d);
    }
  });
  test('no Google-services domains (must not leak unrelated app traffic)', () => {
    for (const d of ['googleapis', 'gstatic', 'play.google', 'gvt1', 'gvt2']) {
      expect(joined).not.toContain(d);
    }
  });
});

// ── iOS per-app bypass (curated domain catalog) ──────────────────────────────
describe('iOS app-bypass catalog → domains', () => {
  test('catalog integrity: unique ids, every domain valid and emitted', () => {
    const ids = IOS_APP_BYPASS_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = getAppBypassDomains(ids);
    const expected = IOS_APP_BYPASS_CATALOG.reduce((n, a) => n + a.domains.length, 0);
    expect(all.length).toBe(expected); // a dropped domain = typo in the catalog
    for (const d of all) expect(d).toMatch(/^domain:[a-z0-9.-]+$/);
  });

  test('selection maps to that app’s domains only', () => {
    const out = getAppBypassDomains(['snapp']);
    expect(out).toContain('domain:snapp.ir');
    expect(out).toContain('domain:snapp.taxi');
    expect(out.join(' ')).not.toContain('digikala');
  });

  test('unknown ids and bad input are safe', () => {
    expect(getAppBypassDomains(['nope', 'also-nope'])).toEqual([]);
    expect(getAppBypassDomains([])).toEqual([]);
    expect(getAppBypassDomains('garbage' as any)).toEqual([]);
    expect(getAppBypassDomains(null as any)).toEqual([]);
  });

  test('getSelectedAppBypassDomains never throws and returns an array', () => {
    expect(() => getSelectedAppBypassDomains()).not.toThrow();
    expect(Array.isArray(getSelectedAppBypassDomains())).toBe(true);
  });
});

describe('builder: extraBypassDomains (iOS per-app bypass)', () => {
  const extras = getAppBypassDomains(['snapp', 'banking']);

  test('applied WITHOUT Smart Mode — Android parity (per-app bypass is independent of the toggle)', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false,
      MOCK_CREDS, { smartBypass: false, extraBypassDomains: extras });
    const rule = bypassRule(cfg);
    expect(rule).toBeDefined();
    expect(rule!.domain).toContain('domain:snapp.ir');
    expect(rule!.domain).toContain('domain:shaparak.ir');
    // Smart Mode is OFF: the general .ir suffix rule must NOT ride along.
    expect(rule!.domain).not.toContain('domain:ir');
  });

  test('merged with the Smart Mode list when the toggle is ON', () => {
    const cfg = buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false,
      MOCK_CREDS, { smartBypass: true, extraBypassDomains: extras });
    const rule = bypassRule(cfg);
    expect(rule!.domain).toContain('domain:ir');        // Smart Mode list
    expect(rule!.domain).toContain('domain:snapp.taxi'); // per-app extras
  });

  test('empty / malformed extras change nothing', () => {
    const off = buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS);
    expect(buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS,
      { smartBypass: false, extraBypassDomains: [] })).toBe(off);
    expect(buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', MOCK_CREDS,
      { smartBypass: false, extraBypassDomains: 'garbage' as any })).toBe(off);
  });
});

// ── Platform parity ──────────────────────────────────────────────────────────
// The Xray config is built by SHARED code: routing (proxy-quic/Vision, DNS-out,
// UDP/443 → tunnel, IPv6 blackhole) must be byte-identical on both platforms.
// The ONLY intended platform differences are (a) getBypassDomains' platform
// filter on the rule list and (b) per-app bypass mechanics: Android excludes
// packages natively in VpnService, iOS routes catalog domains via
// getSelectedAppBypassDomains. If this test fails, a platform fork crept into
// the builder — that must be a conscious decision, not an accident.
describe('platform parity — shared config builder', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Platform } = require('react-native');

  const onPlatform = <T,>(os: 'ios' | 'android', fn: () => T): T => {
    const restore = jest.replaceProperty(Platform, 'OS', os);
    try { return fn(); } finally { restore.restore(); }
  };

  const VISION_CREDS: any = { ...MOCK_CREDS, flow: 'xtls-rprx-vision' };

  test('Android and iOS build identical configs (smart off, smart on, vision)', () => {
    const cases: Array<[any, any]> = [
      [MOCK_CREDS, undefined],
      [MOCK_CREDS, { smartBypass: true }],
      [VISION_CREDS, { smartBypass: true }],
    ];
    for (const [creds, opts] of cases) {
      const ios     = onPlatform('ios',     () => buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', creds, opts));
      const android = onPlatform('android', () => buildXrayConfigJson(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', creds, opts));
      expect(android).toBe(ios);
    }
  });

  test('Vision QUIC fix on BOTH platforms: proxy-quic twin exists and carries UDP/443', () => {
    for (const os of ['ios', 'android'] as const) {
      const cfg = onPlatform(os, () =>
        buildXrayConfig(MOCK_SERVER, 'Reality', 'Cloudflare (DoH)', false, VISION_CREDS));
      const quicOut = cfg.outbounds.find((o) => o.tag === 'proxy-quic');
      expect(quicOut).toBeDefined();
      // The catch-all QUIC rule has no domain (the AI-provider QUIC rule does).
      const udp443 = cfg.routing.rules.find((r) => r.network === 'udp' && r.port === '443' && !r.domain);
      expect(udp443!.outboundTag).toBe('proxy-quic');
    }
  });

  test('per-app bypass platform semantics: domains on iOS, [] on Android', () => {
    expect(onPlatform('android', () => getSelectedAppBypassDomains())).toEqual([]);
    // iOS reads the settings store; result depends on stored selection but the
    // call must be safe and produce only validated 'domain:' entries.
    const ios = onPlatform('ios', () => getSelectedAppBypassDomains());
    expect(Array.isArray(ios)).toBe(true);
    for (const d of ios) expect(d).toMatch(/^domain:/);
  });
});
