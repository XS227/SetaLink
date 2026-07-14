/**
 * Builds a valid Xray-core JSON config from the selected server + protocol.
 *
 * The output is passed to XrayModule.start(config) to launch the tunnel.
 * Server-side credentials (uuid, publicKey, shortId, host) are placeholders —
 * replace with real values fetched from the Realink API.
 */

import { Platform } from 'react-native';
import type { VpnServer }        from '../stores/vpnStore';
import type { ServerCredentials } from './serverConfigService';
import { getBypassDomains } from './iranBypassRules';
import { getAiRoutingDomains } from './aiRoutingRules';

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

interface DnsServer {
  address: string;
  domains?: string[];
  port?: number;
  queryStrategy?: string;
}

interface XrayDns {
  servers: Array<string | DnsServer>;
  queryStrategy?: string;
  hosts?: Record<string, string>;
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
    network?:     string;
    outboundTag:  string;
  }>;
}

// DNS profiles keyed by settingsStore.dnsMode.
// Plain UDP DNS (port 53) — routed via the dns-out rule, which resolves directly
// without an extra proxy hop. DoH (https://…) was removed because it uses port 443
// and is routed through the proxy outbound, adding a full VPN round-trip to every
// cold DNS lookup and measurably increasing page-load latency.
// queryStrategy: 'UseIPv4' prevents IPv6 DNS leaks on devices with no IPv6 routing.
const DNS_PROFILES: Record<string, XrayDns> = {
  'Cloudflare (DoH)': {
    queryStrategy: 'UseIPv4',
    servers: ['1.1.1.1', '1.0.0.1', '8.8.8.8'],
  },
  'Google (DoH)': {
    queryStrategy: 'UseIPv4',
    servers: ['8.8.8.8', '8.8.4.4', '1.1.1.1'],
  },
  'System': {
    servers: ['localhost'],
  },
};

const PLACEHOLDER_UUID       = '00000000-0000-0000-0000-000000000001';
const PLACEHOLDER_PUBLIC_KEY = 'PLACEHOLDER_PUBLIC_KEY';
const PLACEHOLDER_SHORT_ID   = 'PLACEHOLDER_SHORT_ID';
const PLACEHOLDER_SNI        = 'www.cloudflare.com';

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
        address: creds?.address ?? `${server.id}.setalink.no`,
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

// Cloudflare anycast edge IP used to DIAL a CDN-fronted (Stealth) node.
//
// Why dial an IP and not the hostname: on iOS the packet tunnel resolves DNS
// *through* the tunnel it is still trying to build. A direct Reality node has a
// literal IP address, so it needs no DNS to connect; a CDN node's address is a
// hostname (alanya-turist.no), so xray must resolve it first — but that lookup
// is trapped inside the not-yet-established tunnel → deadlock, the WS handshake
// never leaves the device, 0 /cfws reach origin. (Android never hits this: xray
// runs as an app-UID excluded from the VPN and resolves directly.) Dialling a
// literal Cloudflare IP removes the DNS dependency entirely; Cloudflare routes to
// our origin by the TLS SNI (still the real domain), not by which anycast IP was
// dialled, so any published edge IP works — and it is immune to Iran poisoning
// the domain's DNS. The literal IP also gets excluded from the TUN as a precise
// /32 (existing isIPv4 path), so there is no routing loop either.
const CLOUDFLARE_EDGE_IP = '104.21.61.220';

// Literal address to dial for a CDN edge: catalog/bundled edgeIp when supplied
// (backend can rotate without an app build), else the stable anycast fallback.
function edgeConnectAddress(creds?: ServerCredentials): string {
  return creds?.edgeIp ?? CLOUDFLARE_EDGE_IP;
}

function buildVlessWsOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  // WebSocket goes through the nginx edge proxy, not directly to the Reality port.
  const edgeHost = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.no`;
  const edgeAddr = edgeConnectAddress(creds);   // literal Cloudflare IP — see note above
  const edgePort = creds?.edgePort ?? 443;
  const wsPath   = creds?.wsPath   ?? '/ws';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeAddr,
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
      // Host header is required for nginx vhost routing — without it nginx
      // does not recognise the WebSocket Upgrade request and rejects with
      // "the client is not using the websocket protocol" / "'websocket' token
      // not found in 'Upgrade' header".
      wsSettings:  { path: wsPath, headers: { Host: edgeHost } },
      // Force HTTP/1.1 ALPN — WebSocket upgrade (RFC 6455) requires HTTP/1.1.
      // Without this, Xray may negotiate h2, causing nginx to reject the
      // Connection: Upgrade header with 400 Bad Request (forbidden in HTTP/2).
      tlsSettings: { serverName: edgeHost, allowInsecure: false, alpn: ['http/1.1'] },
      // NO TLS fragmentation on CDN-fronted nodes. Cloudflare must read a clean
      // ClientHello SNI (edgeHost) to route to our origin; a fragmented ClientHello
      // breaks that routing — the handshake never reaches origin (0 /cfws upgrades
      // observed from Iran 2026-07-09, while plain Safari HTTPS to the same domain
      // reached origin fine). CDN fronting already hides us in legitimate Cloudflare
      // traffic on a benign domain, so DPI-evasion fragmentation is both unnecessary
      // and harmful here. (Direct Reality nodes above intentionally carry no fragment.)
    },
  };
}

function buildVmessWsOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const host = creds?.address ?? `${server.id}.setalink.no`;
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
  const edgeHost  = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.no`;
  const edgeAddr  = edgeConnectAddress(creds);   // literal Cloudflare IP — see buildVlessWsOutbound note
  const edgePort  = creds?.edgePort  ?? 443;
  // Ensure trailing slash — Xray server config uses /xhttp/ (with slash).
  // Without it Xray rejects with "failed to validate path, request:/xhttp, config:/xhttp/".
  const rawPath   = creds?.xhttpPath ?? '/xhttp/';
  const xhttpPath = rawPath.endsWith('/') ? rawPath : rawPath + '/';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeAddr,
        port:    edgePort,
        users:   [{ id: creds?.uuid ?? PLACEHOLDER_UUID, encryption: 'none' }],
      }],
    },
    streamSettings: {
      network:       'xhttp',
      security:      'tls',
      // mode: 'stream-one' — one HTTP/1.1 request per XHTTP session, most
      // compatible with nginx reverse proxies and Iranian DPI — avoids the
      // multiplexed chunked-transfer pattern that can be fingerprinted.
      // host: edgeHost — we now dial a literal Cloudflare IP (edgeAddr), so the
      // real domain must travel in the HTTP Host header for nginx vhost routing;
      // without it xray would send the IP as Host and origin would 404.
      xhttpSettings: { path: xhttpPath, mode: 'stream-one', host: edgeHost },
      // Force HTTP/1.1 ALPN — XHTTP requires HTTP/1.1 chunked transfer.
      // Without this Xray may negotiate h2, causing nginx to reject the connection.
      tlsSettings:   { serverName: edgeHost, allowInsecure: false, alpn: ['http/1.1'] },
      // No TLS fragmentation on CDN-fronted nodes — Cloudflare needs a clean
      // ClientHello SNI to route to origin (see buildVlessWsOutbound note).
    },
  };
}

function buildVlessHttpUpgradeOutbound(server: VpnServer, creds?: ServerCredentials): XrayOutbound {
  const edgeHost   = creds?.edgeAddress ?? creds?.address ?? `${server.id}.setalink.no`;
  const edgeAddr   = edgeConnectAddress(creds);   // literal Cloudflare IP — see buildVlessWsOutbound note
  const edgePort   = creds?.edgePort   ?? 443;
  const httpupPath = creds?.httpupPath ?? '/httpup';
  return {
    tag:      'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{
        address: edgeAddr,
        port:    edgePort,
        users:   [{ id: creds?.uuid ?? PLACEHOLDER_UUID, encryption: 'none' }],
      }],
    },
    streamSettings: {
      network:             'httpupgrade',
      security:            'tls',
      // host field sets the HTTP/1.1 Host header — required for nginx vhost routing.
      httpupgradeSettings: { path: httpupPath, host: edgeHost },
      // Force HTTP/1.1 ALPN — HTTPUpgrade requires HTTP/1.1 upgrade handshake.
      tlsSettings:         { serverName: edgeHost, allowInsecure: false, alpn: ['http/1.1'] },
      // No TLS fragmentation on CDN-fronted nodes — Cloudflare needs a clean
      // ClientHello SNI to route to origin (see buildVlessWsOutbound note).
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

/**
 * QUIC needs a flow-less copy of the proxy outbound.
 *
 * xray-core hard-rejects UDP/443 on any VLESS outbound whose user has
 * flow=xtls-rprx-vision ("XTLS rejected UDP/443 traffic") — a built-in
 * anti-QUIC rule from the days when QUIC had to be forced onto TCP. So on
 * Vision servers (Finland) the build-78 "UDP/443 → proxy" rule still drops
 * every QUIC datagram inside the client, and Meta's mvfst apps (Instagram,
 * WhatsApp) hang exactly as they did under the old blackhole rule.
 *
 * Vision only applies to raw TCP; UDP rides XUDP, and the server accepts
 * XUDP from a flow-less connection of the same user (verified end-to-end
 * against the Finland node 2026-07-07: udp:443 traversed and egressed).
 * Returns null when the proxy outbound has no flow — the UDP/443 rule can
 * keep pointing at 'proxy' (Germany flow="", WS/XHTTP/VMess have no flow).
 */
function buildQuicProxyOutbound(proxy: XrayOutbound): XrayOutbound | null {
  const vnext = proxy.settings['vnext'] as Array<{ users?: Array<{ flow?: string }> }> | undefined;
  const user  = vnext?.[0]?.users?.[0];
  if (!user?.flow) return null;
  const clone = JSON.parse(JSON.stringify(proxy)) as XrayOutbound;
  const clonedUser = (clone.settings['vnext'] as Array<{ users: Array<{ flow?: string }> }>)[0]!.users[0]!;
  delete clonedUser.flow;
  clone.tag = 'proxy-quic';
  return clone;
}

export interface BuildOptions {
  /** Smart Mode / Iran Bypass: route Iranian destinations direct (outside the
   *  tunnel) while everything else keeps going through the VPN. */
  smartBypass?: boolean;
  /** iOS per-app bypass: extra 'domain:…'/'full:…' entries (from the curated
   *  app catalog) routed direct. Applied even when Smart Mode is OFF —
   *  mirrors Android, where VpnService excludes the selected apps from the
   *  TUN regardless of the Smart Mode toggle. */
  extraBypassDomains?: string[];
  /** AI clean-exit scaffold: an optional secondary node that AI-provider
   *  traffic (Claude / Gemini / OpenAI — see aiRoutingRules.ts) should egress
   *  through, because those providers block our Hetzner/VPN exit IPs. When
   *  absent, AI traffic uses the default proxy exactly as before (no change). */
  aiExit?: { server: VpnServer; protocol: string; creds?: ServerCredentials };
}

/**
 * AI-provider routing rules (Claude / Gemini / OpenAI — see aiRoutingRules.ts).
 * Domain-matched via sniffed SNI/Host, so they work for browser and app traffic
 * alike. Emits up to two rules, and MUST sit before the generic UDP/443 rule:
 *
 *  1. QUIC → blackhole (ALWAYS ON). Forces AI-provider HTTP/3 (UDP/443) to fail
 *     fast so the client retries over HTTP/2 on TCP — the exact path Claude
 *     already succeeds on. This is the fix for Gemini hanging forever on
 *     "loading": Google's Cronet stack cleanly falls back from a fast-rejected
 *     QUIC to TCP, unlike Meta's mvfst (which is why blackholing UDP/443 broke
 *     Instagram/WhatsApp but is safe here — it only touches AI hostnames).
 *  2. TCP → 'ai-out' (only when a clean exit is configured). Pins AI traffic to
 *     a non-datacenter node the providers accept. Absent → AI TCP falls through
 *     to the default 'proxy', unchanged.
 */
function buildAiRoutingRules(hasAiExit: boolean): XrayRouting['rules'] {
  const domains = getAiRoutingDomains();
  if (domains.length === 0) return [];
  const rules: XrayRouting['rules'] = [
    { type: 'field', domain: domains, network: 'udp', port: '443', outboundTag: 'blackhole' },
  ];
  if (hasAiExit) {
    rules.push({ type: 'field', domain: domains, outboundTag: 'ai-out' });
  }
  return rules;
}

/**
 * Smart Mode routing rule: Iranian destinations → 'direct' outbound.
 * Placed AFTER the port-53/dns-out rule (DNS interception must win) and
 * BEFORE the UDP/443 blackhole (so QUIC to bypassed sites goes direct
 * instead of being fast-rejected). Domain matching uses the sniffed
 * SNI/Host (sniffing is enabled on both inbounds), so it works for both
 * browser and app traffic. On both platforms the 'direct' freedom outbound
 * egresses via the physical interface, not back into the TUN: Android
 * excludes our own UID from the VPN (addDisallowedApplication) and iOS
 * exempts the packet-tunnel provider's own sockets from its tunnel routes —
 * the same mechanism the existing dns-out path already relies on.
 */
function buildSmartBypassRules(smartOn: boolean, extraDomains: string[] = []): XrayRouting['rules'] {
  const domains = [
    ...(smartOn ? getBypassDomains(Platform.OS === 'ios' ? 'ios' : 'android') : []),
    // iOS per-app bypass entries — already validated by getAppBypassDomains,
    // and applied regardless of the Smart Mode toggle (Android parity).
    ...(Array.isArray(extraDomains) ? extraDomains : []),
  ];
  if (domains.length === 0) return []; // empty/malformed list → no rule, no crash
  return [{ type: 'field', domain: domains, outboundTag: 'direct' }];
}

export function buildXrayConfig(
  server:    VpnServer,
  protocol:  string,
  dnsMode:   string = 'Cloudflare (DoH)',
  debugMode: boolean = true,
  creds?:    ServerCredentials,
  opts?:     BuildOptions,
): XrayConfig {
  const dns = DNS_PROFILES[dnsMode] ?? DNS_PROFILES['Cloudflare (DoH)']!;

  const proxy     = buildProxyOutbound(server, protocol, creds);
  const quicProxy = buildQuicProxyOutbound(proxy);

  // AI clean-exit outbound — built only when infra supplies a clean node.
  // Without it, aiOut is null → no 'ai-out' outbound and no AI routing rule,
  // so the config is byte-for-byte what it is today.
  const aiOut = opts?.aiExit
    ? (() => {
        const o = buildProxyOutbound(opts.aiExit!.server, opts.aiExit!.protocol, opts.aiExit!.creds);
        o.tag = 'ai-out';
        return o;
      })()
    : null;

  return {
    log: { loglevel: debugMode ? 'debug' : 'warning' },

    dns,

    inbounds: [
      {
        tag:      'socks-in',
        port:     10808,
        listen:   '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
      // HTTP proxy inbound — used by iOS PacketTunnelProvider via NEProxySettings.
      // iOS routes all HTTPS/HTTP app traffic to this port; no tun2socks required.
      {
        tag:      'http-in',
        port:     10809,
        listen:   '127.0.0.1',
        protocol: 'http',
        settings: {},
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
    ],

    outbounds: [
      proxy,
      // proxy-quic (only on Vision servers): flow-less twin of 'proxy' that
      // carries UDP/443 — Vision outbounds reject QUIC (see buildQuicProxyOutbound).
      ...(quicProxy ? [quicProxy] : []),
      // ai-out (only when a clean exit is configured): dedicated egress for
      // Claude/Gemini/OpenAI, which block our default Hetzner exit IP.
      ...(aiOut ? [aiOut] : []),
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
        // Smart Mode / Iran Bypass: Iranian destinations go direct so banks,
        // Snapp, Digikala, .ir sites etc. work while the VPN stays connected.
        // Everything that does not match continues to the rules below and,
        // when nothing matches, to the default 'proxy' outbound — unchanged.
        ...buildSmartBypassRules(opts?.smartBypass === true, opts?.extraBypassDomains),
        // AI-provider rules (Claude/Gemini/OpenAI): force their QUIC to fall
        // back to TCP (fixes Gemini's endless "loading"), and — when a clean
        // exit is configured — pin their TCP to it (datacenter-IP block fix).
        // Must precede the generic UDP/443 rule below. Iranian-bypass rules
        // above still win first.
        ...buildAiRoutingRules(!!aiOut),
        // UDP/443 (QUIC / HTTP-3) → proxy, so it tunnels through VLESS like every
        // other flow. Build 72 gave the tunnel real UDP support (HEV udp:'udp' +
        // socks-in udp:true) and the node's Xray forwards UDP over VLESS, so QUIC
        // now works end-to-end — this is exactly how Android runs, where Instagram
        // and WhatsApp work. The old rule blackholed UDP/443 to force a TCP
        // fallback, but iOS Meta apps (mvfst QUIC) do NOT fall back cleanly: they
        // keep retrying the dropped QUIC and hang, which is why Instagram/WhatsApp
        // never loaded on iOS. Tunnelling QUIC fixes them. (Bypassed Smart-Mode
        // domains already went direct above, so their QUIC is unaffected.)
        // On Vision servers this must target 'proxy-quic' — the Vision outbound
        // itself rejects UDP/443 (see buildQuicProxyOutbound).
        {
          type:        'field',
          network:     'udp',
          port:        '443',
          outboundTag: quicProxy ? 'proxy-quic' : 'proxy',
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
  opts?:    BuildOptions,
): string {
  return JSON.stringify(buildXrayConfig(server, protocol, dnsMode, false, creds, opts));
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
  const proxy     = buildProxyOutbound(server, protocol, creds);
  const quicProxy = buildQuicProxyOutbound(proxy);

  const cfg: XrayConfig = {
    log: { loglevel: 'debug' },

    dns: {
      queryStrategy: 'UseIPv4',
      servers: ['1.1.1.1', '8.8.8.8', '9.9.9.9'],
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
      {
        tag:      'http-in',
        port:     10809,
        listen:   '127.0.0.1',
        protocol: 'http',
        settings: {},
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
    ],

    outbounds: [
      proxy,
      ...(quicProxy ? [quicProxy] : []),
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'dns-out', protocol: 'dns', settings: {} },
      { tag: 'blackhole', protocol: 'blackhole', settings: {} },
    ],

    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', port: '53', outboundTag: 'dns-out' },
        // UDP/443 (QUIC) → tunnel it (build 72+ UDP path). Fixes iOS
        // Instagram/WhatsApp, which hang on a blackholed QUIC instead of
        // falling back to TCP the way browsers do. Vision outbounds reject
        // UDP/443, so those need the flow-less 'proxy-quic' twin.
        { type: 'field', network: 'udp', port: '443', outboundTag: quicProxy ? 'proxy-quic' : 'proxy' },
        // Fast-fail all IPv6 so Happy Eyeballs immediately retries on IPv4.
        { type: 'field', ip: ['::/0'], outboundTag: 'blackhole' },
      ],
    },
  };

  return JSON.stringify(cfg);
}
