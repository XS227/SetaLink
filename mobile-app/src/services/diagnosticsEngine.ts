// Mock diagnostics engine — generates realistic, time-varying VPN metrics.
// snapshot() accepts an optional server hint so metrics reflect the selected server.
// Future integration point: replace snapshot() with a live Xray stats poll.

export interface ServerHint {
  id:       string;
  ping:     number;
  protocol: string;
  city:     string;
  country:  string;
}

export interface DiagnosticsSnapshot {
  timestamp:    number;
  ping:         number;   // ms
  jitter:       number;   // ms
  packetLoss:   number;   // % (0–100)
  uploadMbps:   number;
  downloadMbps: number;
  quality:      number;   // 0–100 composite score
  connection:   ConnectionInfo;
  healthChecks: HealthCheck[];
  routeHops:    RouteHop[];
}

export interface ConnectionInfo {
  protocol:    string;
  transport:   string;
  serverSni:   string;
  destination: string;
  tlsVersion:  string;
  cipher:      string;
  alpn:        string;
}

export interface HealthCheck {
  label:  string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface RouteHop {
  hop:   number;
  ip:    string;
  rtt:   string;
  label: string;
}

const BASE_PING       = 24;
const BASE_UPLOAD     = 4.2;
const BASE_DOWNLOAD   = 18.7;
const BASE_JITTER     = 2.1;

// Country-code prefix for server labels
function countryCode(country: string): string {
  const MAP: Record<string, string> = {
    Germany: 'DE', Netherlands: 'NL', Finland: 'FI', France: 'FR',
    'United States': 'US', Singapore: 'SG', Japan: 'JP',
    'United Kingdom': 'UK', Switzerland: 'CH', Turkey: 'TR', Sweden: 'SE',
  };
  return MAP[country] ?? country.slice(0, 2).toUpperCase();
}

function vary(base: number, range: number, dp = 1): number {
  const raw = base + (Math.random() - 0.5) * range * 2;
  const factor = 10 ** dp;
  return Math.round(Math.max(1, raw) * factor) / factor;
}

const STATIC_HEALTH: HealthCheck[] = [
  { label: 'TLS Certificate', status: 'ok',   detail: 'Valid · Expires 2027-03-01' },
  { label: 'CDN Edge (DE)',    status: 'ok',   detail: 'Cloudflare · 104.26.12.55' },
  { label: 'SNI Consistency',  status: 'ok',   detail: 'cdn.setalink.net ↔ cert match' },
  { label: 'Domain Health',    status: 'ok',   detail: 'setalink.net · A record live' },
  { label: 'Fallback Domain',  status: 'warn', detail: 'alt.setalink.io · slow response' },
  { label: 'DNS Resolution',   status: 'ok',   detail: 'Cloudflare DoH · 1ms' },
];

const STATIC_HOPS: RouteHop[] = [
  { hop: 1, ip: '10.0.0.1',       rtt: '1ms',  label: 'Local Gateway' },
  { hop: 2, ip: '185.220.101.34', rtt: '8ms',  label: 'ISP Transit' },
  { hop: 3, ip: '104.26.12.55',   rtt: '14ms', label: 'CDN Edge (CF)' },
  { hop: 4, ip: '5.180.62.12',    rtt: '22ms', label: 'SetaLink DE·01' },
  { hop: 5, ip: '0.0.0.0',        rtt: '—',    label: 'Destination (hidden)' },
];

const STATIC_CONNECTION: ConnectionInfo = {
  protocol:    'VLESS + Reality',
  transport:   'TCP (XHTTP)',
  serverSni:   'cdn.setalink.net',
  destination: '5.180.62.12:443',
  tlsVersion:  'TLS 1.3',
  cipher:      'TLS_AES_256_GCM_SHA384',
  alpn:        'h2, http/1.1',
};

export function snapshot(server?: ServerHint): DiagnosticsSnapshot {
  const basePing     = server?.ping ?? BASE_PING;
  const ping         = vary(basePing, Math.min(5, basePing * 0.12), 0);
  const jitter       = vary(BASE_JITTER + basePing * 0.02, 1.5);
  const packetLoss   = Math.random() < 0.95 ? 0 : vary(0.25, 0.25);
  const uploadMbps   = vary(BASE_UPLOAD, 1.5);
  const downloadMbps = vary(BASE_DOWNLOAD, 4);

  // Quality: 100 minus weighted penalties
  const quality = Math.min(100, Math.max(0, Math.round(
    100 - ping * 0.4 - jitter * 2 - packetLoss * 25
  )));

  const connection: ConnectionInfo = server ? {
    protocol:    server.protocol === 'Reality' ? 'VLESS + Reality' : `${server.protocol} + TLS`,
    transport:   server.protocol === 'Reality' ? 'TCP (XHTTP)' : 'WebSocket',
    serverSni:   'cdn.setalink.net',
    destination: '5.180.62.12:443',
    tlsVersion:  'TLS 1.3',
    cipher:      'TLS_AES_256_GCM_SHA384',
    alpn:        'h2, http/1.1',
  } : STATIC_CONNECTION;

  const edgeRtt  = Math.round(basePing * 0.45);
  const nodeRtt  = basePing;
  const cc       = server ? countryCode(server.country) : 'DE';
  const nodeNum  = server?.id.replace(/[^0-9]/g, '') ?? '01';
  const routeHops: RouteHop[] = [
    { hop: 1, ip: '10.0.0.1',       rtt: '1ms',        label: 'Local Gateway' },
    { hop: 2, ip: '185.220.101.34', rtt: '8ms',        label: 'ISP Transit' },
    { hop: 3, ip: '104.26.12.55',   rtt: `${edgeRtt}ms`, label: 'CDN Edge (CF)' },
    { hop: 4, ip: '5.180.62.12',    rtt: `${nodeRtt}ms`, label: `SetaLink ${cc}·0${nodeNum}` },
    { hop: 5, ip: '0.0.0.0',        rtt: '—',          label: 'Destination (hidden)' },
  ];

  return {
    timestamp: Date.now(),
    ping,
    jitter,
    packetLoss,
    uploadMbps,
    downloadMbps,
    quality,
    connection,
    healthChecks: STATIC_HEALTH,
    routeHops,
  };
}
