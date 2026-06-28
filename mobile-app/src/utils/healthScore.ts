/**
 * Composite connection health score (0–100).
 *
 * Replaces the old ping-only formula that showed "Poor 0%" on healthy
 * connections: ping is often unknown (0) right after connect, and a single
 * factor can't represent route health. Score combines:
 *   - connected state        (base)
 *   - probe result           (real HTTP/HTTPS data through the tunnel = route OK)
 *   - DNS resolution         (hostname lookups through the tunnel)
 *   - latency                (unknown ping is NEUTRAL, never a penalty)
 *   - observed throughput    (small bonus when traffic actually flows)
 */

export interface HealthInputs {
  connected:     boolean;
  probeOk:       boolean;          // HTTP/HTTPS confirmed through the tunnel
  dnsOk:         boolean | null;   // null = not yet known
  pingMs:        number;           // 0 = unknown
  downloadMbps?: number;
  uploadMbps?:   number;
}

export function computeHealthScore(i: HealthInputs): number {
  if (!i.connected) return 0;

  let score = 35;                          // tunnel up + system VPN active

  if (i.probeOk) score += 25;              // internet verified end-to-end

  if (i.dnsOk === true)       score += 10;
  else if (i.dnsOk === null)  score += 5;  // unknown — neutral, not a failure

  const ping = i.pingMs;
  if (ping <= 0)        score += 15;       // unknown ping — neutral midpoint
  else if (ping <= 60)  score += 25;
  else if (ping <= 120) score += 18;
  else if (ping <= 250) score += 10;
  else if (ping <= 400) score += 5;
  // > 400ms: no latency points

  const throughput = (i.downloadMbps ?? 0) + (i.uploadMbps ?? 0);
  if (throughput > 0.05) score += 5;       // live traffic moving

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Derives the DNS state from the native connect step log.
 *
 * Two log dialects exist:
 *   • Android service: "✓ dns_check: …" / "✗ dns_resolve: …"
 *   • iOS PacketTunnelProvider: "Probe RX[2]: DNS+proxy OK|FAIL …",
 *     "DNS: resolution OK", "DNS: FAILED …"
 * The iOS wording was previously unrecognised, so a working iOS tunnel reported
 * dns_ok=null → surfaced as a false "DNS red" in admin even with internet OK.
 * Scans newest-first so the latest verdict wins.
 */
export function dnsOkFromConnectionLog(log: string[]): boolean | null {
  for (let k = log.length - 1; k >= 0; k--) {
    const line = log[k]!;
    // Android native steps
    if (line.includes('dns_check') || line.includes('dns_resolve')) {
      return line.startsWith('✓');
    }
    // iOS PacketTunnelProvider wording
    if (line.includes('DNS+proxy OK') || line.includes('DNS: resolution OK')) {
      return true;
    }
    if (line.includes('DNS+proxy FAIL') || line.includes('DNS: FAILED')) {
      return false;
    }
  }
  return null;
}
