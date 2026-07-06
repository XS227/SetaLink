// Diagnostics report builder (BUG-3, Issue 2). Pure/serializable so it can be
// unit-tested and reused by the share-sheet / copy-to-clipboard actions on the
// Diagnostics screen. No PII beyond the device's own ID is included, and the
// caller decides where the text goes (share intent, clipboard, file).

import type { HealthCheck, RouteHop, ConnectionInfo } from './diagnosticsEngine';

export interface DiagnosticsReportInput {
  appVersion:   string;
  appBuild:     string;
  deviceId:     string;
  platform:     string;        // e.g. 'android'
  osVersion:    string | number;
  tunnelStatus: string;        // connectionState
  exitIp:       string | null;
  dnsStatus:    string;        // 'Healthy' | 'Degraded' | 'Failed' | 'Unknown'
  healthChecks: HealthCheck[];
  routeHops:    RouteHop[];
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
    quicEvidence?:       string;          // raw 'TCP=… QUIC=… ⇒ VERDICT'
  };
}

const STATUS_LABEL: Record<string, string> = { ok: 'Healthy', warn: 'Degraded', fail: 'Failed' };

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
  // the route. Never filled from a direct-network IP fetch.
  L.push(`Exit IP:       ${i.exitIp || (i.tunnelStatus === 'connected' ? '(run internet test to detect)' : 'N/A — tunnel not connected')}`);
  // DNS status comes from the in-app diagnostic engine; when disconnected it is
  // unknown because no real DNS verification is performed.
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
  // Health checks and route trace are generated by the in-app diagnostic engine,
  // which is currently simulated (not based on live packet measurements).
  L.push('Health Checks (illustrative — use Self Test tab for live measurements)');
  L.push('----------------------------------------------------------------------');
  for (const h of i.healthChecks) {
    L.push(`  [${(STATUS_LABEL[h.status] ?? h.status).toUpperCase()}] ${h.label} — ${h.detail}`);
  }
  if (i.healthChecks.length === 0) L.push('  (none)');

  L.push('');
  L.push('Route Trace (illustrative — not a real traceroute)');
  L.push('---------------------------------------------------');
  for (const r of i.routeHops) {
    L.push(`  ${r.hop}. ${r.ip.padEnd(16)} ${String(r.rtt).padEnd(6)} ${r.label}`);
  }
  if (i.routeHops.length === 0) L.push('  (none)');

  L.push('');
  L.push('— Generated by Realink VPN');
  return L.join('\n');
}
