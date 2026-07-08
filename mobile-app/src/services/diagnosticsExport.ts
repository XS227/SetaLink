// Diagnostics report builder (BUG-3, Issue 2). Pure/serializable so it can be
// unit-tested and reused by the share-sheet / copy-to-clipboard actions on the
// Diagnostics screen. No PII beyond the device's own ID is included, and the
// caller decides where the text goes (share intent, clipboard, file).
//
// 2026-07-02: the illustrative Health Checks and fake Route Trace sections were
// removed — simulated values in exported reports repeatedly derailed real
// debugging sessions. The report now carries ONLY live measurements: the Self
// Test results (real probes through the tunnel) and the VPN-verified exit IP.

import type { ConnectionInfo } from './diagnosticsEngine';
import type { SelfTestResult } from './vpnBridge';

export interface DiagnosticsReportInput {
  appVersion:   string;
  appBuild:     string;
  deviceId:     string;
  platform:     string;        // e.g. 'android'
  osVersion:    string | number;
  tunnelStatus: string;        // connectionState
  exitIp:       string | null; // VPN-verified only (trace test), never direct-network
  dnsStatus:    string;        // 'Healthy' | 'Degraded' | 'Failed' | 'Unknown'
  selfTest?:    SelfTestResult[] | null;  // live probe results from the Self Test tab
  connection?:  ConnectionInfo | null;
  timestamp?:   number;        // defaults to now
  /** Smart Mode / Iran Bypass: 'smart' (Iranian destinations bypass the
   *  tunnel) or 'full' (everything through the VPN). */
  routingMode?:     'smart' | 'full';
  /** Active domain bypass rules when routingMode is 'smart'. */
  bypassRuleCount?: number;
  /** Android only: apps excluded from the VPN entirely. */
  bypassAppCount?:  number;
  /** Build 77 — authoritative observability facts, kept separate from the
   *  illustrative health-check section so a reader can trust them. */
  observability?: {
    osTunnelEstablished: boolean;         // OS accepted the tunnel (completionHandler)
    internetProbePassed: boolean | null;  // real external fetch result (null = pending)
    probeLatencyMs?:     number;
    probeDetail?:        string;          // e.g. 'cp.cloudflare.com 204 in 120ms'
    nodeIdentity?:       string;          // actual connected node, e.g. 'Finland · Helsinki (65.109.183.7)'
    quicVerdict?:        string;          // 'QUIC_BLACKHOLE_LIKELY' | 'QUIC_OK' | …
    quicEvidence?:       string;          // raw 'TCP=… QUIC=… ⇒ VERDICT [app-path]'
    /** Build 80 — the extension's direct-path control measurement. From Iran
     *  this legitimately reads BOTH_FAIL (domestic blocking) while the
     *  app-path evidence above shows the tunnel verdict users experience. */
    quicEvidenceDirect?: string;
  };
}

/** Build a human-readable, shareable diagnostic report. Always returns a string. */
export function buildDiagnosticsReport(i: DiagnosticsReportInput): string {
  const ts = new Date(i.timestamp ?? Date.now()).toISOString();
  const L: string[] = [];
  L.push('Realink Diagnostic Report');
  L.push('==========================');
  L.push(`Timestamp:     ${ts}`);
  L.push(`App version:   ${i.appVersion} (build ${i.appBuild})`);
  L.push(`Device ID:     ${i.deviceId || 'unknown'}`);
  L.push(`Platform:      ${i.platform} ${i.osVersion}`);
  L.push(`Tunnel status: ${i.tunnelStatus}`);
  // Exit IP is only valid when the tunnel is connected and a trace test confirmed
  // the route. Never filled from a direct-network IP fetch, and never shown at all
  // when the tunnel is down — a stale value would be misleading.
  L.push(`Exit IP:       ${i.tunnelStatus !== 'connected' ? 'N/A — tunnel not connected' : (i.exitIp || '(run internet test to detect)')}`);
  L.push(`DNS status:    ${i.tunnelStatus === 'connected' ? i.dnsStatus : 'Unknown (tunnel not connected)'}`);
  if (i.routingMode) {
    const smart = i.routingMode === 'smart';
    const apps  = i.bypassAppCount ? `, ${i.bypassAppCount} bypassed app(s)` : '';
    L.push(`Routing mode:  ${smart
      ? `Smart (Iran bypass) — ${i.bypassRuleCount ?? 0} domain rule(s)${apps}`
      : 'Full tunnel — all traffic through VPN'}`);
  }

  // Build 77 — authoritative, measured facts. Unlike the illustrative section
  // below, every line here is a real observation, clearly separated so testers
  // and support can trust it at a glance.
  if (i.observability) {
    const o = i.observability;
    const yn = (b: boolean | null | undefined) =>
      b === true ? 'YES' : b === false ? 'NO' : 'PENDING';
    L.push('');
    L.push('Observability (measured — not simulated)');
    L.push('----------------------------------------');
    L.push(`  OS tunnel established:  ${yn(o.osTunnelEstablished)}`);
    L.push(`  Internet probe passed:  ${yn(o.internetProbePassed)}`
      + (o.probeLatencyMs != null ? ` (${o.probeLatencyMs}ms)` : '')
      + (o.probeDetail ? ` — ${o.probeDetail}` : ''));
    L.push(`  Actual node identity:   ${o.nodeIdentity || 'unknown'}`);
    L.push(`  QUIC evidence verdict:  ${o.quicVerdict || 'not collected'}`);
    if (o.quicEvidence) L.push(`    ${o.quicEvidence}`);
    // Direct-path control: measured OUTSIDE the tunnel by the extension. From
    // Iran BOTH_FAIL here is expected (domestic blocking) and proves the
    // app-path line above really measured the tunnel.
    if (o.quicEvidenceDirect) L.push(`  Direct-path control:    ${o.quicEvidenceDirect}`);
    // Plain-language state derived from the two facts above.
    const state = !o.osTunnelEstablished ? 'NOT CONNECTED'
      : o.internetProbePassed === true  ? 'CONNECTED (internet verified)'
      : o.internetProbePassed === false ? 'DEGRADED (tunnel up, no internet)'
      : 'VERIFYING…';
    L.push(`  → Effective state:      ${state}`);
  }

  if (i.connection) {
    L.push('');
    L.push('Protocol');
    L.push('--------');
    L.push(`  Protocol:    ${i.connection.protocol}`);
    L.push(`  Transport:   ${i.connection.transport}`);
    L.push(`  Server SNI:  ${i.connection.serverSni}`);
    L.push(`  TLS:         ${i.connection.tlsVersion} · ${i.connection.cipher}`);
  }

  L.push('');
  L.push('Self Test (live probes through the tunnel)');
  L.push('-------------------------------------------');
  const st = i.selfTest ?? [];
  if (st.length === 0) {
    L.push('  (not run — open the Self Test tab and run it before exporting');
    L.push('   so this report carries real measurements)');
  } else {
    for (const r of st) {
      L.push(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }

  L.push('');
  L.push('— Generated by Realink VPN');
  return L.join('\n');
}
