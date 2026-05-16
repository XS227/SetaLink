/**
 * Builds a valid Xray-core JSON config from the selected server + protocol.
 *
 * The output is passed to XrayModule.start(config) to launch the tunnel.
 * Server-side credentials (uuid, publicKey, shortId, host) are placeholders —
 * replace with real values fetched from the SetaLink API.
 */

import type { VpnServer } from '../stores/vpnStore';

export interface XrayConfig {
  log:       XrayLog;
  dns:       XrayDns;
  inbounds:  XrayInbound[];
  outbounds: XrayOutbound[];
  routing:   XrayRouting;
}

interface XrayLog {
  loglevel: 'none' | 'error' | 'warning' | 'info' | 'debug';
}

interface XrayDns {
  servers: Array<string | { address: string; domains?: string[]; port?: number }>;
}

interface XrayInbound {
  tag:      string;
  port:     number;
  listen:   string;
  protocol: string;
  settings: Record<string, unknown>;
}

interface XrayOutbound {
  tag:            string;
  protocol:       string;
  settings:       Record<string, unknown>;
  streamSettings?: Record<string, unknown>;
}

interface XrayRouting {
  domainStrategy: string;
  rules: Array<{
    type:         string;
    ip?:          string[];
    domain?:      string[];
    outboundTag:  string;
  }>;
}

// DNS profiles keyed by settingsStore.dnsMode
const DNS_PROFILES: Record<string, XrayDns> = {
  'Cloudflare (DoH)': {
    servers: [
      { address: 'https://1.1.1.1/dns-query', domains: ['geosite:geolocation-!cn'] },
      '8.8.8.8',
    ],
  },
  'Google (DoH)': {
    servers: [
      { address: 'https://dns.google/dns-query', domains: ['geosite:geolocation-!cn'] },
      '8.8.4.4',
    ],
  },
  'System': {
    servers: ['localhost'],
  },
};

function buildVlessRealityOutbound(server: VpnServer): XrayOutbound {
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: `${server.id}.setalink.net`,  // placeholder — replace with real server address
        port:    443,
        users: [{
          id:         '00000000-0000-0000-0000-000000000001',  // placeholder UUID
          encryption: 'none',
          flow:       'xtls-rprx-vision',
        }],
      }],
    },
    streamSettings: {
      network:  'tcp',
      security: 'reality',
      realitySettings: {
        fingerprint: 'chrome',
        serverName:  'www.microsoft.com',
        publicKey:   'PLACEHOLDER_PUBLIC_KEY',   // from server provisioning API
        shortId:     'PLACEHOLDER_SHORT_ID',
      },
    },
  };
}

function buildVlessWsOutbound(server: VpnServer): XrayOutbound {
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: `${server.id}.setalink.net`,
        port:    443,
        users: [{
          id:         '00000000-0000-0000-0000-000000000001',
          encryption: 'none',
        }],
      }],
    },
    streamSettings: {
      network:     'ws',
      security:    'tls',
      wsSettings:  { path: '/vpn' },
      tlsSettings: { serverName: `${server.id}.setalink.net`, allowInsecure: false },
    },
  };
}

function buildVmessWsOutbound(server: VpnServer): XrayOutbound {
  return {
    tag:      'proxy',
    protocol: 'vmess',
    settings: {
      vnext: [{
        address: `${server.id}.setalink.net`,
        port:    443,
        users: [{
          id:       '00000000-0000-0000-0000-000000000001',
          alterId:  0,
          security: 'auto',
        }],
      }],
    },
    streamSettings: {
      network:     'ws',
      security:    'tls',
      wsSettings:  { path: '/vmess' },
      tlsSettings: { serverName: `${server.id}.setalink.net`, allowInsecure: false },
    },
  };
}

function buildProxyOutbound(server: VpnServer, protocol: string): XrayOutbound {
  if (protocol.includes('Reality') || server.protocol === 'Reality') {
    return buildVlessRealityOutbound(server);
  }
  if (protocol.includes('WebSocket') || server.protocol === 'WebSocket') {
    return buildVlessWsOutbound(server);
  }
  if (protocol.includes('VMess')) {
    return buildVmessWsOutbound(server);
  }
  // Default: VLESS+Reality
  return buildVlessRealityOutbound(server);
}

export function buildXrayConfig(
  server:    VpnServer,
  protocol:  string,
  dnsMode:   string = 'Cloudflare (DoH)',
  debugMode: boolean = false,
): XrayConfig {
  const dns = DNS_PROFILES[dnsMode] ?? DNS_PROFILES['Cloudflare (DoH)']!;

  return {
    log: { loglevel: debugMode ? 'info' : 'warning' },

    dns,

    inbounds: [
      {
        tag:      'socks-in',
        port:     10808,
        listen:   '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      },
      {
        tag:      'http-in',
        port:     10809,
        listen:   '127.0.0.1',
        protocol: 'http',
        settings: { allowTransparent: false },
      },
    ],

    outbounds: [
      buildProxyOutbound(server, protocol),
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block',  protocol: 'blackhole', settings: { response: { type: 'http' } } },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        // Bypass LAN + loopback
        { type: 'field', ip: ['geoip:private', '127.0.0.1/32'], outboundTag: 'direct' },
        // Block ads
        { type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' },
        // Iran bypass (direct for local services) — only when Iran mode active
        ...(protocol.includes('Iran') ? [
          { type: 'field', domain: ['geosite:ir'], outboundTag: 'direct' },
          { type: 'field', ip:     ['geoip:ir'],   outboundTag: 'direct' },
        ] : []),
      ],
    },
  };
}

export function buildXrayConfigJson(
  server:   VpnServer,
  protocol: string,
  dnsMode:  string,
): string {
  return JSON.stringify(buildXrayConfig(server, protocol, dnsMode));
}
