// Mock diagnostics engine — generates realistic, time-varying VPN metrics.
// Future integration point: replace snapshot() with a live Xray stats poll.

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

export function snapshot(): DiagnosticsSnapshot {
  const ping         = vary(BASE_PING, 5, 0);
  const jitter       = vary(BASE_JITTER, 1.5);
  const packetLoss   = Math.random() < 0.95 ? 0 : vary(0.25, 0.25);
  const uploadMbps   = vary(BASE_UPLOAD, 1.5);
  const downloadMbps = vary(BASE_DOWNLOAD, 4);

  // Quality: 100 minus weighted penalties
  const quality = Math.min(100, Math.max(0, Math.round(
    100 - ping * 0.4 - jitter * 2 - packetLoss * 25
  )));

  return {
    timestamp: Date.now(),
    ping,
    jitter,
    packetLoss,
    uploadMbps,
    downloadMbps,
    quality,
    connection:   STATIC_CONNECTION,
    healthChecks: STATIC_HEALTH,
    routeHops:    STATIC_HOPS,
  };
}
