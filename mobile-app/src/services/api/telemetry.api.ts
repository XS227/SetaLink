/**
 * Anonymous connect telemetry — fire-and-forget.
 *
 * Uploads a single connect outcome to POST /v1/telemetry/connect.
 * Never throws: a telemetry failure must never interrupt the user.
 *
 * Privacy rules (enforced server-side too):
 *  - No phone number, no email, no device_id, no real IP stored.
 *  - ISP and carrier names are SHA-256-hashed on the server before storage.
 *  - Country is geo-derived from the request IP on the server (not sent by client).
 */

import { apiPost } from './client';

export type TelemetryEvent =
  | 'connect_ok'
  | 'connect_fail'
  | 'internet_fail'
  | 'probe_fail';

export interface ConnectTelemetryPayload {
  /** Outcome of the connect attempt. */
  event: TelemetryEvent;
  /** Node ID from the /v1/servers list, e.g. 'primary' or 'fi-hel'. */
  node_id: string;
  /** Profile within the node: 'primary', 'alt-0', 'alt-1', etc. */
  profile_id?: string;
  /** SNI used for this attempt. */
  sni?: string;
  /** Protocol: 'reality', 'ws', 'xhttp', 'httpup'. */
  protocol?: string;
  /** Platform: 'android' or 'ios'. */
  platform: 'android' | 'ios';
  /** App version string, e.g. '0.9.42'. */
  app_version?: string;
  /** Numeric build number. */
  build_number?: number;
  /** Connection type: 'wifi' or 'mobile'. */
  network_type?: 'wifi' | 'mobile';
  /** ISP name — hashed server-side, never stored raw. */
  isp?: string;
  /** Carrier/operator name — hashed server-side, never stored raw. */
  carrier?: string;
  /** Where the connection failed: 'tcp', 'tls', 'reality', 'internet', 'probe'. */
  failure_stage?: string;
  /** Round-trip latency in ms from connect initiation to first tunnel byte. */
  latency_ms?: number;
  /** Whether internet traffic was confirmed (HTTP/HTTPS data received). */
  internet_ok?: boolean;
  /** Whether exit-IP check confirmed the VPN IP as the exit. */
  exit_ip_ok?: boolean;
}

/**
 * Upload a connect telemetry event.
 *
 * This call is fire-and-forget: errors are silently swallowed so a telemetry
 * failure never interrupts the user's VPN session.
 */
export function uploadConnectTelemetry(
  payload: ConnectTelemetryPayload,
  token?: string | null,
): void {
  apiPost<{ ok: boolean }>('/telemetry/connect', payload, token).catch(() => {
    // Intentionally swallowed — telemetry must not affect UX
  });
}
