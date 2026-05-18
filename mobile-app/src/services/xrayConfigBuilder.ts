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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CredValidation { valid: boolean; error?: string }

export function validateCreds(creds: ServerCredentials): CredValidation {
  if (!creds.uuid || creds.uuid === PLACEHOLDER_UUID) {
    return { valid: false, error: 'Missing UUID — import a real VLESS link in Servers tab' };
  }
  if (!UUID_RE.test(creds.uuid)) {
    return { valid: false, error: `Malformed UUID: ${creds.uuid.slice(0, 20)}…` };
  }
  if (!creds.address || creds.address.length < 2) {
    return { valid: false, error: 'Missing server address' };
  }
  if (!creds.port || creds.port < 1 || creds.port > 65535) {
    return { valid: false, error: `Invalid port: ${creds.port}` };
  }
  if (creds.publicKey === PLACEHOLDER_PUBLIC_KEY) {
    return { valid: false, error: 'Placeholder publicKey — import a real VLESS Reality link' };
  }
  if (creds.shortId === PLACEHOLDER_SHORT_ID) {
    return { valid: false, error: 'Placeholder shortId — import a real VLESS Reality link' };
  }
  return { valid: true };
}

function buildVlessRealityOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  // Use || so empty-string values fall back to the placeholder/default.
  // flow must be omitted (not set to '') when the server doesn't use XTLS Vision.
  const flow        = creds?.flow        || 'xtls-rprx-vision';
  const fingerprint = creds?.fingerprint || 'chrome';
  const sni         = creds?.sni         || PLACEHOLDER_SNI;

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
          // Omit flow key entirely when empty to match server config exactly.
          ...(flow ? { flow } : {}),
        }],
      }],
    },
    streamSettings: {
      network:  'tcp',
      security: 'reality',
      realitySettings: {
        fingerprint,
        serverName:  sni,
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
    ],

    outbounds: [
      buildProxyOutbound(server, protocol, creds),
      { tag: 'direct', protocol: 'freedom', settings: {} },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        {
          type: 'field',
          ip:   ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
          outboundTag: 'direct',
        },
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

/**
 * Emergency config: IPv4 only, DNS 1.1.1.1, debug log, no split-tunnel rules.
 * Useful to isolate packet-flow issues by removing all complexity.
 * The TUN side is controlled by the native service (MTU 1280, no IPv6 routes).
 */
export function buildEmergencyXrayConfigJson(
  server:  VpnServer,
  protocol: string,
  creds?:  ServerCredentials,
): string {
  const cfg: XrayConfig = {
    log: { loglevel: 'debug' },

    dns: {
      servers: ['1.1.1.1'],
    },

    inbounds: [
      {
        tag:      'socks-in',
        port:     10808,
        listen:   '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      },
    ],

    outbounds: [
      buildProxyOutbound(server, protocol, creds),
      { tag: 'direct', protocol: 'freedom', settings: {} },
    ],

    // No private-IP bypass rules — all traffic proxied through VPN server.
    // This removes one possible failure mode where local routing rules block traffic.
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [],
    },
  };

  return JSON.stringify(cfg);
}
