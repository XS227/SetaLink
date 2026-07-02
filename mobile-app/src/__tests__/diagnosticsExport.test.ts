import { buildDiagnosticsReport } from '../services/diagnosticsExport';

// BUG-3, Issue 2: the Export Diagnostic Report button must produce a report.
// 2026-07-02: illustrative health checks + fake route trace removed from the
// report — only live Self Test results are included now.
describe('buildDiagnosticsReport', () => {
  const base = {
    appVersion: '0.9.34', appBuild: '51', deviceId: 'dev-abc',
    platform: 'android', osVersion: 34, tunnelStatus: 'connected',
    exitIp: '203.0.113.7', dnsStatus: 'Healthy',
    selfTest: [
      { test: 'dns',       label: 'DNS through tunnel', ok: true,  detail: 'resolved i.instagram.com' },
      { test: 'instagram', label: 'Instagram reach',    ok: false, detail: 'timeout after 8s' },
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

  it('renders live self test results with PASS/FAIL labels', () => {
    const out = buildDiagnosticsReport(base);
    expect(out).toContain('[PASS] DNS through tunnel — resolved i.instagram.com');
    expect(out).toContain('[FAIL] Instagram reach — timeout after 8s');
  });

  it('contains no illustrative/simulated sections', () => {
    const out = buildDiagnosticsReport(base);
    expect(out).not.toContain('illustrative');
    expect(out).not.toContain('Route Trace');
    expect(out).not.toContain('Simulated');
  });

  it('prompts the user to run the self test when results are missing', () => {
    const out = buildDiagnosticsReport({ ...base, selfTest: null });
    expect(out).toContain('not run — open the Self Test tab');
  });

  it('tolerates missing exit IP and connection', () => {
    const out = buildDiagnosticsReport({ ...base, exitIp: null, connection: null });
    expect(out).toContain('(run internet test to detect)');
    expect(out).not.toContain('Server SNI');
  });

  it('marks DNS unknown when the tunnel is down', () => {
    const out = buildDiagnosticsReport({ ...base, tunnelStatus: 'disconnected' });
    expect(out).toContain('DNS status:    Unknown (tunnel not connected)');
    expect(out).toContain('N/A — tunnel not connected');
  });
});
