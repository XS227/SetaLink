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

// Build 77 — observability section must distinguish the four facts clearly.
import { buildDiagnosticsReport as buildReport77 } from '../services/diagnosticsExport';
describe('diagnostics observability section (build 77)', () => {
  const base77 = {
    appVersion: '0.9.50', appBuild: '77', deviceId: 'sl-test', platform: 'ios',
    osVersion: '18.5', tunnelStatus: 'connected', exitIp: null, dnsStatus: 'Unknown',
    healthChecks: [], routeHops: [],
  };
  it('shows degraded when tunnel up but internet probe failed', () => {
    const out = buildReport77({ ...base77, observability: {
      osTunnelEstablished: true, internetProbePassed: false, probeLatencyMs: 8000,
      probeDetail: 'no internet: timeout', nodeIdentity: 'Finland · Helsinki (65.109.183.7)',
      quicVerdict: 'QUIC_BLACKHOLE_LIKELY',
    }});
    expect(out).toContain('OS tunnel established:  YES');
    expect(out).toContain('Internet probe passed:  NO');
    expect(out).toContain('Finland · Helsinki');
    expect(out).toContain('QUIC_BLACKHOLE_LIKELY');
    expect(out).toContain('DEGRADED (tunnel up, no internet)');
  });
  it('shows verified-connected when both facts are true', () => {
    const out = buildReport77({ ...base77, observability: {
      osTunnelEstablished: true, internetProbePassed: true, probeLatencyMs: 120,
      nodeIdentity: 'Finland · Helsinki (65.109.183.7)', quicVerdict: 'QUIC_OK',
    }});
    expect(out).toContain('CONNECTED (internet verified)');
    // Node identity is a fact, never a hardcoded Germany guess.
    expect(out).not.toContain('Germany');
  });
});

// Build 80 — app-path vs direct-path QUIC evidence must be distinguishable in
// the export, so a BOTH_FAIL direct-path control (expected from Iran) can never
// be misread as a broken tunnel.
describe('diagnostics observability (build 80: app-path + direct-path control)', () => {
  const base80 = {
    appVersion: '0.9.53', appBuild: '80', deviceId: 'sl-test', platform: 'ios',
    osVersion: '18.5', tunnelStatus: 'connected', exitIp: null, dnsStatus: 'Unknown',
    healthChecks: [], routeHops: [],
  };
  it('renders both evidence lines with their path labels', () => {
    const out = buildReport77({ ...base80, observability: {
      osTunnelEstablished: true, internetProbePassed: true, probeLatencyMs: 130,
      nodeIdentity: 'Finland · Helsinki (65.109.183.7)',
      quicVerdict: 'QUIC_OK',
      quicEvidence: 'TCP=ok(200ms,HTTP 200) QUIC=ok(220ms,HTTP 200) ⇒ QUIC_OK [app-path]',
      quicEvidenceDirect: 'TCP=fail(6500ms,timeout) QUIC=fail(6500ms,timeout) ⇒ BOTH_FAIL [direct-path]',
    }});
    expect(out).toContain('QUIC evidence verdict:  QUIC_OK');
    expect(out).toContain('[app-path]');
    expect(out).toContain('Direct-path control:');
    expect(out).toContain('[direct-path]');
    // The direct-path BOTH_FAIL must not override the app-path verdict line.
    expect(out).toContain('⇒ QUIC_OK');
  });
  it('omits the direct-path line when the control was never collected', () => {
    const out = buildReport77({ ...base80, observability: {
      osTunnelEstablished: true, internetProbePassed: true,
      quicVerdict: 'QUIC_OK',
      quicEvidence: 'TCP=ok QUIC=ok ⇒ QUIC_OK [app-path]',
    }});
    expect(out).not.toContain('Direct-path control:');
  });
});
