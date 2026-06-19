import { buildDiagnosticsReport } from '../services/diagnosticsExport';

// BUG-3, Issue 2: the Export Diagnostic Report button must produce a report.
describe('buildDiagnosticsReport', () => {
  const base = {
    appVersion: '0.9.34', appBuild: '51', deviceId: 'dev-abc',
    platform: 'android', osVersion: 34, tunnelStatus: 'connected',
    exitIp: '203.0.113.7', dnsStatus: 'Healthy',
    healthChecks: [
      { label: 'DNS Resolution', status: 'ok' as const,   detail: 'DNS OK' },
      { label: 'TLS Certificate', status: 'warn' as const, detail: 'expiring soon' },
    ],
    routeHops: [
      { hop: 1, ip: '10.0.0.1', rtt: '1ms', label: 'Local Gateway' },
      { hop: 2, ip: '104.26.12.55', rtt: '14ms', label: 'CDN Edge' },
    ],
    connection: {
      protocol: 'VLESS + Reality', transport: 'TCP', serverSni: 'www.cloudflare.com',
      destination: '1.2.3.4:443', tlsVersion: 'TLS 1.3', cipher: 'AES_256', alpn: 'h2',
    },
    timestamp: Date.parse('2026-06-15T10:00:00Z'),
  };

  it('produces a non-empty report containing all required fields', () => {
    const out = buildDiagnosticsReport(base);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('Realink Diagnostic Report');
    expect(out).toContain('0.9.34 (build 51)');
    expect(out).toContain('dev-abc');
    expect(out).toContain('android 34');
    expect(out).toContain('connected');
    expect(out).toContain('203.0.113.7');
    expect(out).toContain('DNS status:    Healthy');
    expect(out).toContain('2026-06-15T10:00:00');
  });

  it('renders health checks with mapped status labels', () => {
    const out = buildDiagnosticsReport(base);
    expect(out).toContain('[HEALTHY] DNS Resolution');
    expect(out).toContain('[DEGRADED] TLS Certificate');
  });

  it('lists every route hop', () => {
    const out = buildDiagnosticsReport(base);
    expect(out).toContain('Local Gateway');
    expect(out).toContain('CDN Edge');
  });

  it('tolerates missing exit IP and connection', () => {
    const out = buildDiagnosticsReport({ ...base, exitIp: null, connection: null });
    expect(out).toContain('Exit IP:       —');
    expect(out).not.toContain('Server SNI');
  });
});
