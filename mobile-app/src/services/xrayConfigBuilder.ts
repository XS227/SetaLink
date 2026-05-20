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
  sniffing?: { enabled: boolean; destOverride: string[] };
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
    port?:        string;
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
  // Use ?? for flow: preserve empty string from the imported VLESS URI.
  // Empty string → omit flow key entirely (server doesn't use XTLS Vision).
  // Forcing 'xtls-rprx-vision' on a non-Vision server injects Vision bytes the
  // server doesn't expect, silently breaking all traffic even when CONNECTED.
  const flow        = creds?.flow        ?? '';
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
        // spiderX is required by many Reality server configs; empty string is the safe default.
        spiderX:     '',
      },
    },
  };
}

function buildVlessWsOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  // WebSocket goes through the nginx edge proxy, not directly to the Reality port.
  const edgeHost = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.net`;
  const edgePort = creds?.edgePort ?? 443;
  const wsPath   = creds?.wsPath   ?? '/ws';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeHost,
        port:    edgePort,
        users: [{
          id:         creds?.uuid ?? PLACEHOLDER_UUID,
          encryption: 'none',
        }],
      }],
    },
    streamSettings: {
      network:     'ws',
      security:    'tls',
      wsSettings:  { path: wsPath },
      // Force HTTP/1.1 ALPN — WebSocket upgrade (RFC 6455) requires HTTP/1.1.
      // Without this, Xray may negotiate h2, causing nginx to reject the
      // Connection: Upgrade header with 400 Bad Request (forbidden in HTTP/2).
      tlsSettings: { serverName: edgeHost, allowInsecure: false, alpn: ['http/1.1'] },
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

function buildVlessXhttpOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const edgeHost  = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.net`;
  const edgePort  = creds?.edgePort  ?? 443;
  const xhttpPath = creds?.xhttpPath ?? '/xhttp';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeHost,
        port:    edgePort,
        users:   [{ id: creds?.uuid ?? PLACEHOLDER_UUID, encryption: 'none' }],
      }],
    },
    streamSettings: {
      network:       'xhttp',
      security:      'tls',
      xhttpSettings: { path: xhttpPath, mode: 'auto' },
      tlsSettings:   { serverName: edgeHost, allowInsecure: false },
    },
  };
}

function buildVlessHttpUpgradeOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const edgeHost   = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.net`;
  const edgePort   = creds?.edgePort   ?? 443;
  const httpupPath = creds?.httpupPath ?? '/httpup';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeHost,
        port:    edgePort,
        users:   [{ id: creds?.uuid ?? PLACEHOLDER_UUID, encryption: 'none' }],
      }],
    },
    streamSettings: {
      network:             'httpupgrade',
      security:            'tls',
      httpupgradeSettings: { path: httpupPath, host: edgeHost },
      // Force HTTP/1.1 ALPN — HTTPUpgrade requires HTTP/1.1 upgrade handshake.
      tlsSettings:         { serverName: edgeHost, allowInsecure: false, alpn: ['http/1.1'] },
    },
  };
}

function buildProxyOutbound(server: VpnServer, protocol: string, creds?: ServerCredentials): XrayOutbound {
  if (protocol.includes('Reality') || server.protocol === 'Reality') {
    return buildVlessRealityOutbound(server, creds);
  }
  // Check XHTTP/HTTPUpgrade before WebSocket — all contain 'HTTP'
  if (protocol.includes('XHTTP') || protocol.includes('xhttp')) {
    return buildVlessXhttpOutbound(server, creds);
  }
  if (protocol.includes('HTTPUpgrade') || protocol.includes('httpupgrade')) {
    return buildVlessHttpUpgradeOutbound(server, creds);
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
  debugMode: boolean = true,
  creds?:    ServerCredentials,
): XrayConfig {
  const dns = DNS_PROFILES[dnsMode] ?? DNS_PROFILES['Cloudflare (DoH)']!;

  return {
    // Always debug so Reality handshake errors appear in xray.log for diagnostics.
    log: { loglevel: debugMode ? 'debug' : 'info' },

    dns,

    inbounds: [
      {
        tag:      'socks-in',
        port:     10808,
        listen:   '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        // Sniffing extracts the destination domain from TLS SNI / HTTP Host so
        // routing rules can match by domain name even when tun2socks sends raw IPs.
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
    ],

    outbounds: [
      buildProxyOutbound(server, protocol, creds),
      { tag: 'direct', protocol: 'freedom', settings: {} },
      // dns-out: Xray's internal DNS resolver handles port-53 traffic directly,
      // avoiding the UDP ASSOCIATE path in SOCKS5 which is fragile on some devices.
      { tag: 'dns-out', protocol: 'dns', settings: {} },
      // blackhole: fast-fails IPv6 connections that reach SOCKS5 from tun2socks.
      // Without this, IPv6 traffic through a proxy chain that lacks IPv6 support
      // hangs indefinitely, blocking Happy Eyeballs from falling back to IPv4.
      { tag: 'blackhole', protocol: 'blackhole', settings: {} },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        // Private IPv4 + IPv6 LAN ranges always go direct.
        {
          type: 'field',
          ip:   [
            '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
            '::1/128', 'fc00::/7', 'fe80::/10',
          ],
          outboundTag: 'direct',
        },
        // Port 53 → Xray internal DNS resolver (reliable, no UDP ASSOCIATE needed).
        {
          type: 'field',
          port: '53',
          outboundTag: 'dns-out',
        },
        // All IPv6 → blackhole. Gives apps an immediate connection-refused so
        // Happy Eyeballs retries on IPv4 without waiting for a timeout.
        // TUN routes do not include ::/0 (native service excludes IPv6 from TUN),
        // so this rule is a safety net for any IPv6 that enters via tun2socks.
        {
          type: 'field',
          ip:   ['::/0'],
          outboundTag: 'blackhole',
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
  return JSON.stringify(buildXrayConfig(server, protocol, dnsMode, true, creds));
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
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
    ],

    outbounds: [
      buildProxyOutbound(server, protocol, creds),
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'dns-out', protocol: 'dns', settings: {} },
      { tag: 'blackhole', protocol: 'blackhole', settings: {} },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', port: '53', outboundTag: 'dns-out' },
        // Fast-fail all IPv6 so Happy Eyeballs immediately retries on IPv4.
        { type: 'field', ip: ['::/0'], outboundTag: 'blackhole' },
      ],
    },
  };

  return JSON.stringify(cfg);
}
