/**
 * Session-level connect telemetry — covers MANUAL connects.
 *
 * Before this existed, only the smart-connect scanner (autoConnector) and the
 * QUIC evidence probe uploaded connect telemetry, so a user who picked a node
 * and tapped Connect never produced a row — the learned-routing loop was
 * learning from testers only. This reports the OUTCOME of every session
 * attempt (connected / gave up after all fallbacks).
 *
 * Dedup: when smart-connect drove the attempt, autoConnector has already
 * reported per-profile results seconds earlier — the session report is
 * skipped inside a short window so one connection never counts twice.
 */

import { Platform } from 'react-native';
import { uploadConnectTelemetry } from './api/telemetry.api';
import type { ConnectTelemetryPayload } from './api/telemetry.api';
import { APP_VERSION, APP_BUILD_CODE } from '../utils/version';
import type { FailureCategory } from './failureClassifier';

type WireCategory = NonNullable<ConnectTelemetryPayload['error_category']>;

/** Classifier categories → the telemetry wire enum. */
function toWireCategory(c?: FailureCategory | string): WireCategory {
  switch (c) {
    case 'dns-blocked':        return 'dns_failed';
    case 'timeout':
    case 'server-unreachable': return 'server_unreachable';
    case 'config-error':       return 'config_error';
    case 'tls-blocked':
    case 'sni-blocked':
    case 'reality-failed':
    case 'ws-path-blocked':
    case 'no-traffic':         return 'routing_failed';
    default:                   return 'unknown';
  }
}

const AUTO_REPORT_DEDUP_MS = 60_000;

let lastAutoReportAt = 0;

/** autoConnector calls this whenever it uploads its own telemetry. */
export function noteAutoConnectorReport(): void {
  lastAutoReportAt = Date.now();
}

export interface SessionOutcome {
  ok:        boolean;
  nodeId:    string;
  sni?:      string;
  protocol?: string;
  latencyMs?: number;
  /** Only for failures — classifier category of the final error. */
  errorCategory?: FailureCategory | string;
}

export function reportSessionOutcome(o: SessionOutcome): void {
  if (Date.now() - lastAutoReportAt < AUTO_REPORT_DEDUP_MS) return;

  let carrier: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCachedCarrier } = require('./deviceIdentityService');
    carrier = getCachedCarrier() || undefined;
  } catch {}

  uploadConnectTelemetry({
    event:          o.ok ? 'connect_ok' : 'connect_fail',
    node_id:        o.nodeId || 'primary',
    sni:            o.sni,
    protocol:       o.protocol,
    carrier_name:   carrier,
    platform:       Platform.OS as 'android' | 'ios',
    app_version:    APP_VERSION,
    build_number:   APP_BUILD_CODE,
    latency_ms:     o.latencyMs,
    ...(o.ok ? {} : {
      failure_stage:  'session',
      error_category: toWireCategory(o.errorCategory),
    }),
  });
}
