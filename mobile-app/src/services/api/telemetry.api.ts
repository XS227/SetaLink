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
  | 'probe_fail'
  /** Build 80 — app-process QUIC evidence (verdict carried in tunnel_mode,
   *  matching the build 77-79 extension rows so admin queries stay uniform). */
  | 'quic_probe';

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
  /** Probe results: did the app reach this service through the tunnel? */
  probe_google?:          boolean;
  probe_apple?:           boolean;
  probe_telegram?:        boolean;
  probe_cloudflare?:      boolean;
  probe_instagram?:       boolean;
  /** Why the session ended: 'user_stop', 'watchdog_died', 'no_internet', 'kill_switch', etc. */
  disconnect_reason?:     string;
  /** Total session duration in seconds. */
  session_duration_secs?: number;
  /** Bytes sent through tunnel (0 for iOS proxy architecture). */
  bytes_sent?:            number;
  /** Bytes received through tunnel (0 for iOS proxy architecture). */
  bytes_recv?:            number;
  /** Whether DNS resolution worked through tunnel. */
  dns_ok?:                boolean;
  /** Time from connect start to first successful tunnel byte (ms). */
  time_to_connect_ms?:    number;
  /** Error category for failures. */
  error_category?:        'config_error' | 'xray_failed' | 'proxy_not_ready' | 'routing_failed' | 'server_unreachable' | 'dns_failed' | 'captive_portal' | 'app_blocked' | 'unknown';
  /** Carrier/operator name (truncated to 30 chars server-side). */
  carrier_name?:          string;
  /** NAT type detected: 'full_cone', 'symmetric', 'port_restricted', 'unknown' */
  nat_type?:         'full_cone' | 'symmetric' | 'port_restricted' | 'unknown';
  /** IP version used to reach the server: 'ipv4', 'ipv6', 'dual', 'unknown' */
  ip_version?:       'ipv4' | 'ipv6' | 'dual' | 'unknown';
  /** Round-trip time to the VPN server in ms (TCP connect time to server host:port). */
  rtt_ms?:           number;
  /** Whether the user's network type changed during the session (WiFi<->mobile). */
  network_switched?: boolean;
  /** quic_probe rows: the verdict (QUIC_OK | QUIC_BLACKHOLE_LIKELY | …) — same
   *  column the packet-tunnel extension used, so old and new rows line up. */
  tunnel_mode?: string;
  /** Probe latency in ms (quic_probe: the QUIC leg). */
  probe_ms?: number;
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
