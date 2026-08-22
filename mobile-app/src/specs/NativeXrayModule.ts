/**
 * TurboModule spec for the Xray native bridge.
 * React Native Codegen uses this file to auto-generate the C++ JSI glue
 * and the Kotlin/Swift type-safe bridge interface.
 *
 * Run `yarn codegen` (or the RN Gradle task) to regenerate after changes.
 *
 * Future: implement XrayModule.kt against this spec to connect
 * the Zustand ConnectionMachine to the real Xray-core process.
 */

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface XrayStats {
  uploadBytes:   number;
  downloadBytes: number;
  pingMs:        number;
  uptime:        number; // seconds
}

export interface Spec extends TurboModule {
  /** Start the Xray VPN tunnel with a JSON config string. */
  start(config: string): Promise<void>;

  /**
   * Start in emergency test mode: IPv4 only, MTU 1280, DNS 1.1.1.1, debug log.
   * Use buildEmergencyXrayConfigJson() to build the config.
   */
  startEmergency(config: string): Promise<void>;

  /** Stop the running tunnel gracefully. */
  stop(): Promise<void>;

  /** Returns true if the Xray process is running. */
  isRunning(): Promise<boolean>;

  /** Returns live traffic stats from the running tunnel. */
  getStats(): Promise<XrayStats>;

  /**
   * Android only: JSON array of launchable apps
   * '[{"packageName":"com.x","appName":"X"}]'. Resolves '[]' on iOS.
   */
  getInstalledApps(): Promise<string>;

  /**
   * Android only: persist packages to exclude from the VPN
   * (VpnService.addDisallowedApplication on next connect).
   * Accepts a JSON string array. No-op on iOS.
   */
  setBypassApps(packagesJson: string): Promise<void>;

  /** Validate a config string without starting the tunnel. */
  validateConfig(config: string): Promise<boolean>;

  /** Returns the last error message from the VPN service, or null if none. */
  getLastError(): Promise<string | null>;

  /** Returns true if the last tunnel validation included a successful HTTP/HTTPS probe (not just TCP). */
  getLastProbeResult(): Promise<boolean>;

  /** Returns ordered step log from the most recent tunnel setup attempt. */
  getConnectionLog(): Promise<string[]>;

  /** Returns the tail of the xray process stdout/stderr log file. */
  getXrayLog(): Promise<string>;

  /** Returns the tail of the tun2socks stdout/stderr log file. */
  getTun2socksLog(): Promise<string>;

  /** Returns the full content of the generated xray.json for debug comparison. */
  getGeneratedConfig(): Promise<string>;

  /** Returns device hardware/OS info for telemetry enrichment. */
  getDeviceInfo(): Promise<{
    model: string;
    manufacturer: string;
    brand: string;
    androidSdk: number;
    androidRelease: string;
  }>;

  /** Stub — telemetry is sent from JS via fetch(). */
  reportTelemetry(payload: string): Promise<void>;

  /**
   * Write device_id and country to the App Group before each connect so the
   * PacketTunnelProvider can include them in the diagnostic upload payload.
   */
  setDiagnosticContext(deviceId: string, country: string): Promise<void>;

  /**
   * Probe https://1.1.1.1/cdn-cgi/trace through the active VPN network.
   * Returns ok=true + routedIp when traffic flows through TUN correctly.
   */
  runTraceTest(): Promise<{
    ok: boolean;
    statusCode?: number;
    routedIp?: string;
    body?: string;
    bytesIn?: number;
    error?: string;
  }>;

  /**
   * Returns the last tunnel_state written by PacketTunnelProvider to the App Group.
   * "connected_verified" means all probes (incl. SOCKS5 relay) passed before iOS
   * reported the tunnel as connected. iOS-only; Android returns "n/a".
   */
  getTunnelState(): Promise<string>;

  /**
   * Build 77 — real internet-probe + QUIC/UDP evidence (no simulated values).
   * tunnelState: connecting|connected_probing|connected_verified|degraded|failed.
   * quicEvidence: "TCP=… QUIC=… ⇒ VERDICT" from the dual-transport diagnostic.
   * iOS-only; Android returns zeros/empty.
   */
  getProbeDiagnostics(): Promise<{
    tunnelState:  string;
    probeOk:      boolean;
    probeMs:      number;
    probeAt:      number;
    probeDetail:  string;
    quicEvidence: string;
    /** Build 80 — the extension's direct-path control measurement. */
    quicEvidenceDirect: string;
  }>;

  /**
   * Build 80 — QUIC/UDP evidence measured from the APP process (traverses the
   * TUN, unlike the extension's direct-path probe). TCP vs forced-H3 to the
   * same host; verdict: QUIC_OK | QUIC_BLACKHOLE_LIKELY | BOTH_FAIL |
   * TCP_FAIL_QUIC_OK. iOS-only; absent on Android.
   */
  runQuicProbe(): Promise<{
    verdict:    string;
    line:       string;
    tcpOk:      boolean;
    tcpMs:      number;
    tcpDetail:  string;
    quicOk:     boolean;
    quicMs:     number;
    quicDetail: string;
  }>;

  /**
   * 4-test in-app self-test suite. Runs while tunnel is active — URLSession traffic
   * is automatically routed through the TUN on iOS, exercising the real HEV path.
   *   dns      — hostname resolves via tunnel DNS
   *   https    — IP-direct HTTPS through tunnel (no DNS needed)
   *   route    — tunnel_state == connected_verified in App Group
   *   exit_ip  — traffic exits through VPN server (shows exit IP)
   */
  runSelfTest(): Promise<Array<{
    test:   string;
    label:  string;
    ok:     boolean;
    detail: string;
  }>>;

  /**
   * REAL SSH (transport 'real_ssh') — generates (once, on-device, Android
   * Keystore-backed) or returns the existing Ed25519 identity used to
   * authenticate to the realgram-tunnel account. Returns ONLY the OpenSSH
   * public key string; the private key never leaves native storage and is
   * never exposed to JS. Android only.
   */
  getOrCreateRealSshIdentity(): Promise<{ publicKey: string } | null>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('XrayModule');
