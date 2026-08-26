/**
 * Build 80 — app-process QUIC evidence orchestration.
 *
 * Why: builds 77-79 collected QUIC evidence inside the packet-tunnel
 * EXTENSION, whose own sockets are exempt from the tunnel routes — so the
 * probe measured the DIRECT path. From Iran, instagram.com is blocked
 * directly, which made every verdict BOTH_FAIL even while the tunnel carried
 * Instagram fine (proven 2026-07-07: tester telemetry said BOTH_FAIL while
 * node tcpdump showed two-way QUIC). The APP process' sockets ARE captured by
 * the TUN, so XrayModule.runQuicProbe measures the path users experience.
 *
 * Flow: schedule after the machine reports connected → wait for the extension
 * probe chain to settle → confirm tunnel_state == connected_verified → run the
 * native probe → retry an inconclusive BOTH_FAIL once → post the verdict as a
 * 'quic_probe' telemetry row (verdict in tunnel_mode, same shape as the old
 * extension rows). Every step is defensive: this is diagnostics — it must
 * never disturb or delay the user's session.
 */
import { Platform } from 'react-native';
import { getAdapter } from './vpnBridge';
import { uploadConnectTelemetry, ConnectTelemetryPayload } from './api/telemetry.api';
import { APP_VERSION, APP_BUILD_CODE } from '../utils/version';

// The extension's own verification chain is: connected_verified → 3 s settle →
// direct-path probe (up to 2 × ~13 s). Waiting 12 s keeps us clear of startup
// races (the build 77/78 mistake) without racing the whole chain.
const SETTLE_MS = 12_000;
const RETRY_MS  = 8_000;

let _timer: ReturnType<typeof setTimeout> | null = null;

/** Called from vpnStore.onConnected. iOS-only: Android has no app-path probe.
 *
 *  quicOutboundTag: the Xray outboundTag the current config routes UDP/443
 *  through for this server — 'proxy-quic' on Vision-flow servers (their
 *  outbound rejects UDP/443 directly, see buildQuicProxyOutbound in
 *  xrayConfigBuilder.ts), otherwise 'proxy'. Computed once by the caller
 *  (which already knows the connected server's flow) and reported alongside
 *  the probe result — see the probe_outbound field's doc comment in
 *  telemetry.api.ts for why this is "expected", not "observed". */
export function scheduleQuicEvidenceProbe(
  nodeId: string | undefined,
  isStillConnected: () => boolean,
  quicOutboundTag: string = 'proxy',
): void {
  if (Platform.OS !== 'ios') return;
  cancelQuicEvidenceProbe();
  _timer = setTimeout(() => { void _run(nodeId, isStillConnected, 0, quicOutboundTag); }, SETTLE_MS);
}

/** Called from vpnStore.onDisconnected — a probe of a dead tunnel is noise. */
export function cancelQuicEvidenceProbe(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

async function _run(
  nodeId: string | undefined,
  isStillConnected: () => boolean,
  attempt: number,
  quicOutboundTag: string,
): Promise<void> {
  _timer = null;
  try {
    if (!isStillConnected()) return;
    const adapter = getAdapter();
    // Only measure a verified tunnel — on degraded/probing the verdict would
    // conflate "QUIC broken" with "tunnel broken".
    const state = await adapter.getTunnelState?.();
    if (state !== 'connected_verified') return;
    const res = await adapter.runQuicProbe?.();
    if (!res) return;
    if (res.verdict === 'BOTH_FAIL' && attempt === 0) {
      _timer = setTimeout(() => { void _run(nodeId, isStillConnected, 1, quicOutboundTag); }, RETRY_MS);
      return;
    }
    uploadConnectTelemetry({
      event:               'quic_probe',
      node_id:              nodeId || 'unknown',
      platform:              Platform.OS as 'android' | 'ios',
      app_version:           APP_VERSION,
      build_number:          APP_BUILD_CODE,
      tunnel_mode:           res.verdict,
      internet_ok:           res.tcpOk,
      probe_ms:              res.quicMs,
      // Instagram diagnostics (2026-07-17) — see doc comment on these fields
      // in telemetry.api.ts. error_category carries the QUIC leg (the one
      // implicated by the known blackhole history); the TCP leg travels
      // separately since error_category is one shared column.
      probe_outbound:        quicOutboundTag,
      error_category:        res.quicCategory !== 'ok' ? (res.quicCategory as ConnectTelemetryPayload['error_category']) : undefined,
      probe_tcp_detail:      res.tcpDetail,
      probe_tcp_category:    res.tcpCategory,
      probe_quic_detail:     res.quicDetail,
    });
  } catch {
    // Diagnostics only — swallow everything.
  }
}
