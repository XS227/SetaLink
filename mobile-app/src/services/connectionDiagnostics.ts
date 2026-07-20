/**
 * Connection Diagnostics — real, measured post-connect performance probe.
 *
 * Added 2026-07-20 after a real iOS Starlink-node speed complaint
 * (STARLINK_WINDOWS_HANDOFF.md §32-33) found that every performance column
 * in connect_telemetry (latency_ms, jitter_ms, throughput_kbps, rtt_ms) was
 * schema-ready but NEVER populated — the client simply never measured them.
 * `rtt_ms` was even being *fabricated* as 30% of total connect latency
 * (see the old comment this replaced in autoConnector.ts). This module
 * replaces guessing with real, honestly-labelled measurements.
 *
 * Design constraints:
 *  - Must never slow down or block the connect flow. All probes here run
 *    AFTER a successful connect, on a delay, and report as a separate
 *    trigger='diagnostics' telemetry row (see autoConnector.ts's
 *    scheduleConnectionDiagnostics()) — never inline in the connect path.
 *  - Mobile apps have no raw ICMP without root, so "jitter" and "packet
 *    loss" here are approximated from N sequential small HTTPS requests
 *    (stddev of RTTs, and % that failed/timed out) against the SAME node
 *    the app is connected to (via /v1/speedtest/download?bytes=256) — the
 *    standard achievable approach at this layer, documented as such rather
 *    than presented as true ICMP ping statistics.
 *  - Throughput is a real timed transfer against /v1/speedtest/{down,up}load,
 *    NOT a synthetic estimate.
 *  - Data-usage-aware: the heavier throughput test only runs automatically
 *    on Wi-Fi (see shouldRunThroughputTest) — this product's primary market
 *    (Iran) has real per-MB cellular costs. The lightweight jitter/packet-loss
 *    probe (a few hundred bytes total) always runs.
 */

import { API_BASE } from './api/client';

const PROBE_SAMPLE_COUNT   = 5;
const PROBE_TIMEOUT_MS     = 4_000;
const PROBE_BYTES          = 256;           // smallest useful response — this probe times round trips, not throughput
const DOWNLOAD_TEST_BYTES  = 1_048_576;     // 1 MB
const UPLOAD_TEST_BYTES    = 262_144;       // 256 KB — smaller than download; upload is usually the scarcer/slower direction, don't overspend it on a diagnostic
const THROUGHPUT_TIMEOUT_MS = 12_000;

export interface JitterProbeResult {
  jitterMs?:      number;
  packetLossPct:  number;
}

export interface ThroughputResult {
  throughputDownKbps?: number;
  throughputUpKbps?:   number;
}

async function timedFetch(path: string, init: RequestInit, timeoutMs: number): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    // Drain the body so timing reflects the full transfer, not just headers —
    // matters most for the download test, harmless for the tiny probe/upload responses.
    await res.arrayBuffer().catch(() => undefined);
    return Date.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * N sequential lightweight requests -> jitter (stddev of RTTs, ms) + packet
 * loss (% failed/timed out). Sequential, not parallel, on purpose: parallel
 * requests would measure link concurrency, not per-request variance.
 */
export async function runJitterPacketLossProbe(
  sampleCount: number = PROBE_SAMPLE_COUNT,
): Promise<JitterProbeResult> {
  const samples: number[] = [];
  let failures = 0;
  for (let i = 0; i < sampleCount; i++) {
    const ms = await timedFetch(`/speedtest/download?bytes=${PROBE_BYTES}`, { method: 'GET' }, PROBE_TIMEOUT_MS);
    if (ms === null) failures++;
    else samples.push(ms);
  }
  const packetLossPct = Math.round((failures / sampleCount) * 1000) / 10;
  if (samples.length < 2) return { packetLossPct }; // jitter needs at least 2 samples to have a variance
  const mean     = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return { jitterMs: Math.round(Math.sqrt(variance)), packetLossPct };
}

/** Timed download + upload against the speedtest endpoint — real transfer,
 *  real kbps, not an estimate. Either leg is omitted (not zeroed) on failure
 *  so a timeout doesn't look like "0 kbps measured". */
export async function runThroughputTest(): Promise<ThroughputResult> {
  const downMs = await timedFetch(
    `/speedtest/download?bytes=${DOWNLOAD_TEST_BYTES}`, { method: 'GET' }, THROUGHPUT_TIMEOUT_MS,
  );
  const throughputDownKbps = downMs && downMs > 0
    ? Math.round((DOWNLOAD_TEST_BYTES * 8) / downMs) // bytes*8 bits / ms == kbps
    : undefined;

  // A plain string body, not a typed array / Blob: React Native's fetch has
  // historically had inconsistent ArrayBuffer/Uint8Array body support across
  // versions, while string bodies are the most universally-supported path
  // (same mechanism every JSON POST in this codebase already uses). Content
  // doesn't matter for a timing-only transfer test, and the endpoint doesn't
  // compress or inspect the body — a single repeated character is exactly
  // UPLOAD_TEST_BYTES bytes for any ASCII character.
  const payload = 'x'.repeat(UPLOAD_TEST_BYTES);
  const upMs = await timedFetch(
    '/speedtest/upload', { method: 'POST', body: payload }, THROUGHPUT_TIMEOUT_MS,
  );
  const throughputUpKbps = upMs && upMs > 0
    ? Math.round((UPLOAD_TEST_BYTES * 8) / upMs)
    : undefined;

  return { throughputDownKbps, throughputUpKbps };
}

/** Cellular data isn't free for every tester (primary market: Iran) — only
 *  auto-run the ~1.25 MB throughput test on Wi-Fi. The jitter/packet-loss
 *  probe above is a few hundred bytes total and always safe to run. Admin
 *  can still request an on-demand throughput test regardless of this via a
 *  manual trigger if one gets built later — this only gates the AUTOMATIC
 *  post-connect run. */
export function shouldRunThroughputTest(connectionType: 'wifi' | 'mobile' | 'unknown'): boolean {
  return connectionType === 'wifi';
}
