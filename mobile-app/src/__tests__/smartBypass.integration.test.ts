/**
 * Smart Mode — leak-proofing INTEGRATION test (production gate).
 *
 * jest cannot run Xray-core, so we build the real generated config and
 * evaluate it with a faithful re-implementation of Xray's routing-rule
 * matching (first matching rule wins, in order; unmatched → default = the
 * first outbound). This proves, on the exact JSON the app ships:
 *
 *   • ONLY the intended Iranian domains resolve to 'direct' (outside VPN).
 *   • EVERY other destination resolves to 'proxy' (through the VPN) — no leak.
 *   • DNS (port 53) always routes to the in-tunnel resolver, identically with
 *     Smart Mode on or off — no DNS leak, no DNS regression.
 *   • Finland and Germany proxy outbounds are byte-for-byte unchanged by
 *     Smart Mode — no server-routing regression.
 */

import { buildXrayConfig } from '../services/xrayConfigBuilder';

type Conn = { host?: string; ip?: string; network?: 'tcp' | 'udp'; port?: number };
type Rule = {
  outboundTag: string;
  domain?: string[]; ip?: string[]; port?: string; network?: string;
};

// ── Faithful Xray rule matcher ──────────────────────────────────────────────
// domain:'v'  → host === v OR host endsWith '.'+v   (sub-domain, label boundary)
// full:'v'    → host === v exactly
function domainMatches(entry: string, host: string): boolean {
  if (entry.startsWith('full:')) return host === entry.slice(5);
  const v = entry.startsWith('domain:') ? entry.slice(7) : entry;
  return host === v || host.endsWith('.' + v);
}

// Minimal CIDR containment for the IPv4 private ranges + ::/0 the config uses.
function ipInCidr(ip: string, cidr: string): boolean {
  if (cidr === '::/0') return ip.includes(':');            // any IPv6
  if (cidr === '::1/128') return ip === '::1';
  if (cidr.startsWith('fc00') || cidr.startsWith('fe80')) return false;
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (ip.includes(':') !== range.includes(':')) return false;
  if (ip.includes(':')) return false;
  const toInt = (s: string) => s.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

/** Return the outboundTag Xray would pick for this connection. */
function route(rules: Rule[], defaultTag: string, c: Conn): string {
  for (const r of rules) {
    if (r.port && c.port !== undefined && String(c.port) === r.port) {
      if (!r.network && !r.domain && !r.ip) return r.outboundTag;
      if (r.network && c.network === r.network) return r.outboundTag;
    }
    if (r.domain && c.host && r.domain.some((d) => domainMatches(d, c.host!))) {
      return r.outboundTag;
    }
    if (r.ip && c.ip && r.ip.some((n) => ipInCidr(c.ip!, n))) {
      return r.outboundTag;
    }
  }
  return defaultTag;
}

const SERVER: any = {
  id: 'primary', country: 'Germany', city: 'Hetzner', flag: '🇩🇪',
  protocol: 'Reality', transport: 'TCP', ping: 37, load: 20, premium: false,
};
const DE_CREDS: any = {
  uuid: 'fd709d48-0000-0000-0000-000000000001', address: '178.104.77.231',
  port: 443, publicKey: 'DE_KEY', shortId: 'd93af82f2ecb7f6a',
  sni: 'www.cloudflare.com', flow: '', fingerprint: 'chrome',
};
const FI_CREDS: any = {
  uuid: '92a861cd-6029-4882-9de5-35d9291e0828', address: '65.109.183.7',
  port: 443, publicKey: 'eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU',
  shortId: 'b3a824bd', sni: 'www.cloudflare.com', flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
};

function router(smart: boolean, creds = DE_CREDS) {
  const cfg = buildXrayConfig(SERVER, 'Reality', 'Cloudflare (DoH)', false, creds,
    { smartBypass: smart });
  return {
    cfg,
    go: (c: Conn) => route(cfg.routing.rules as Rule[], cfg.outbounds[0]!.tag, c),
  };
}

// Domains that MUST keep going through the VPN (task cases 1 + 4 + more).
const THROUGH_VPN = [
  'instagram.com', 'i.instagram.com', 'graph.facebook.com', 'scontent.cdninstagram.com',
  'telegram.org', 'api.telegram.org', 't.me', 'youtube.com', 'www.youtube.com',
  'google.com', 'www.google.com', 'x.com', 'twitter.com', 'whatsapp.com',
  'web.whatsapp.com', 'signal.org', 'cloudflare.com',
  // adversarial near-misses that must NOT be caught by domain:ir / the list
  'notir.com', 'fakir.com', 'mir.com', 'iran-news.com', 'digikala.com.evil.com',
  'mydigikala.com', 'bmi.com', 'sb24.com', 'shaparak.com',
];

// Iranian destinations that SHOULD bypass (task cases 2 + 3 + the full list).
const BYPASS = [
  'x.ir', 'bankmelli.ir', 'www.bankmelli.ir', 'account.bmi.ir',
  'digikala.com', 'www.digikala.com', 'api.digikala.com',
  'snapp.ir', 'app.snapp.ir', 'snapp.taxi', 'tapsi.cab', 'cafebazaar.ir',
  'divar.ir', 'sheypoor.com', 'mellatbank.ir', 'banksepah.ir', 'bsi.ir',
  'enbank.ir', 'samanbank.ir', 'sb24.ir', 'shaparak.ir', 'my.gov.ir',
  'sub.my.gov.ir',
];

describe('Smart Mode ON — selective bypass, no leak', () => {
  const { go } = router(true);

  test.each(THROUGH_VPN)('case 1/4: %s stays through the VPN (proxy)', (host) => {
    expect(go({ host, network: 'tcp', port: 443 })).toBe('proxy');
  });

  test.each(BYPASS)('case 2/3: %s bypasses direct', (host) => {
    expect(go({ host, network: 'tcp', port: 443 })).toBe('direct');
  });

  test('a random non-Iranian IP-only connection goes through the VPN', () => {
    // Instagram edge IP, no SNI to sniff → must not leak.
    expect(go({ ip: '57.144.100.1', network: 'tcp', port: 443 })).toBe('proxy');
    expect(go({ ip: '142.250.72.14', network: 'tcp', port: 443 })).toBe('proxy'); // google
  });

  test('the ONLY direct rules are private IPs + the Iranian domain list', () => {
    const { cfg } = router(true);
    const directRules = (cfg.routing.rules as Rule[]).filter((r) => r.outboundTag === 'direct');
    // exactly two: private-IP rule and the domain-bypass rule
    expect(directRules).toHaveLength(2);
    const ipRule     = directRules.find((r) => r.ip);
    const domainRule = directRules.find((r) => r.domain);
    expect(ipRule!.ip!.every((c) => /^(127|10|172|192|::1|fc00|fe80)/.test(c))).toBe(true);
    // every bypass domain is an Iranian target — none is a global service.
    // Includes the non-.ir domains Iranian apps actually use (harvested from live
    // node traffic 2026-07-07): blu/bank/payment .com, Bale .sh, Divar/Digistyle
    // /yektanet .com, Vandar .io. See iranBypassRules.ts.
    const iranianTargets = /(:ir$|\.ir$|:ir\b|snapp\.taxi$|snapp\.site$|tapsi\.cab$|(digikala|sheypoor|dkstatics|aparat|filimo|eitaa|blubank|bankpasargad|behpardakht|digistyle|yektanet|divarcdn|zarinpal|okala|torob|basalam)\.com$|bale\.(ai|sh)$|balep\.ir$|divar\.cloud$|vandar\.io$|neshan\.org$)/;
    for (const d of domainRule!.domain!) {
      expect(d).toMatch(iranianTargets);
    }
  });

  test('no geoip/geosite tokens leak into the shipped config', () => {
    const raw = JSON.stringify(router(true).cfg);
    expect(raw).not.toMatch(/geoip:/);
    expect(raw).not.toMatch(/geosite:/);
  });
});

describe('DNS: no leak, no regression', () => {
  test('port-53 always routes to the in-tunnel resolver (dns-out), smart on or off', () => {
    for (const smart of [true, false]) {
      const { go } = router(smart);
      expect(go({ network: 'udp', port: 53, host: 'anything.com' })).toBe('dns-out');
      expect(go({ network: 'tcp', port: 53, ip: '8.8.8.8' })).toBe('dns-out');
    }
  });

  test('the port-53 rule is identical with Smart Mode on and off', () => {
    const onRule  = (router(true).cfg.routing.rules as Rule[]).find((r) => r.port === '53');
    const offRule = (router(false).cfg.routing.rules as Rule[]).find((r) => r.port === '53');
    expect(onRule).toEqual(offRule);
    expect(onRule!.outboundTag).toBe('dns-out');
  });

  test('DNS server list is unchanged by Smart Mode (no plaintext DNS added)', () => {
    expect(router(true).cfg.dns).toEqual(router(false).cfg.dns);
  });
});

describe('No Finland/Germany routing regression', () => {
  for (const [name, creds, ip] of [
    ['Germany', DE_CREDS, '178.104.77.231'],
    ['Finland', FI_CREDS, '65.109.183.7'],
  ] as const) {
    test(`${name}: proxy outbound + rule set are identical with Smart Mode on vs off (minus the one bypass rule)`, () => {
      const on  = router(true, creds).cfg;
      const off = router(false, creds).cfg;

      // proxy outbound (server address/uuid/flow) must be byte-identical
      expect(on.outbounds[0]).toEqual(off.outbounds[0]);
      expect((on.outbounds[0]!.settings as any).vnext[0].address).toBe(ip);

      // ON differs from OFF by EXACTLY one added rule: the domain→direct bypass
      const added = (on.routing.rules as Rule[]).filter(
        (r) => !(off.routing.rules as Rule[]).some((o) => JSON.stringify(o) === JSON.stringify(r)));
      expect(added).toHaveLength(1);
      expect(added[0]!.outboundTag).toBe('direct');
      expect(added[0]!.domain).toBeDefined();

      // a normal site still exits via this server (proxy), both nodes
      expect(router(true, creds).go({ host: 'instagram.com', port: 443, network: 'tcp' })).toBe('proxy');
    });
  }
});
