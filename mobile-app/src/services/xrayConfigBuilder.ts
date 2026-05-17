/**
 * Builds a valid Xray-core JSON config from the selected server + protocol.
 *
 * The output is passed to XrayModule.start(config) to launch the tunnel.
 * Server-side credentials (uuid, publicKey, shortId, host) are placeholders —
 * replace with real values fetched from the SetaLink API.
 */

import type { VpnServer }        from '../stores/vpnStore';
import type { ServerCredentials } from './serverConfigService';

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
// NOTE: No geosite/geoip refs — those require data files not bundled in the APK.
const DNS_PROFILES: Record<string, XrayDns> = {
  'Cloudflare (DoH)': {
    servers: ['1.1.1.1', '1.0.0.1'],
  },
  'Google (DoH)': {
    servers: ['8.8.8.8', '8.8.4.4'],
  },
  'System': {
    servers: ['localhost'],
  },
};

const PLACEHOLDER_UUID       = '00000000-0000-0000-0000-000000000001';
const PLACEHOLDER_PUBLIC_KEY = 'PLACEHOLDER_PUBLIC_KEY';
const PLACEHOLDER_SHORT_ID   = 'PLACEHOLDER_SHORT_ID';
const PLACEHOLDER_SNI        = 'www.microsoft.com';

function buildVlessRealityOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: creds?.address ?? `${server.id}.setalink.net`,
        port:    creds?.port    ?? 443,
        users: [{
          id:         creds?.uuid      ?? PLACEHOLDER_UUID,
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
        serverName:  creds?.sni       ?? PLACEHOLDER_SNI,
        publicKey:   creds?.publicKey ?? PLACEHOLDER_PUBLIC_KEY,
        shortId:     creds?.shortId   ?? PLACEHOLDER_SHORT_ID,
      },
    },
  };
}

function buildVlessWsOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const host = creds?.address ?? `${server.id}.setalink.net`;
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: host,
        port:    creds?.port ?? 443,
        users: [{
          id:         creds?.uuid ?? PLACEHOLDER_UUID,
          encryption: 'none',
        }],
      }],
    },
    streamSettings: {
      network:     'ws',
      security:    'tls',
      wsSettings:  { path: '/vpn' },
      tlsSettings: { serverName: host, allowInsecure: false },
    },
  };
}

function buildVmessWsOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const host = creds?.address ?? `${server.id}.setalink.net`;
  return {
    tag:      'proxy',
    protocol: 'vmess',
    settings: {
      vnext: [{
        address: host,
        port:    creds?.port ?? 443,
        users: [{
          id:       creds?.uuid ?? PLACEHOLDER_UUID,
          alterId:  0,
          security: 'auto',
        }],
      }],
    },
    streamSettings: {
      network:     'ws',
      security:    'tls',
      wsSettings:  { path: '/vmess' },
      tlsSettings: { serverName: host, allowInsecure: false },
    },
  };
}

function buildProxyOutbound(server: VpnServer, protocol: string, creds?: ServerCredentials): XrayOutbound {
  if (protocol.includes('Reality') || server.protocol === 'Reality') {
    return buildVlessRealityOutbound(server, creds);
  }
  if (protocol.includes('WebSocket') || server.protocol === 'WebSocket') {
    return buildVlessWsOutbound(server, creds);
  }
  if (protocol.includes('VMess')) {
    return buildVmessWsOutbound(server, creds);
  }
  return buildVlessRealityOutbound(server, creds);
}

export function buildXrayConfig(
  server:    VpnServer,
  protocol:  string,
  dnsMode:   string = 'Cloudflare (DoH)',
  debugMode: boolean = false,
  creds?:    ServerCredentials,
): XrayConfig {
  const dns = DNS_PROFILES[dnsMode] ?? DNS_PROFILES['Cloudflare (DoH)']!;

  return {
    log: { loglevel: debugMode ? 'debug' : 'info' },

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
      buildProxyOutbound(server, protocol, creds),
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block',  protocol: 'blackhole', settings: { response: { type: 'http' } } },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', ip: ['geoip:private', '127.0.0.1/32'], outboundTag: 'direct' },
        { type: 'field', domain: ['geosite:category-ads-all'],  outboundTag: 'block'  },
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
  creds?:   ServerCredentials,
): string {
  return JSON.stringify(buildXrayConfig(server, protocol, dnsMode, false, creds));
}
