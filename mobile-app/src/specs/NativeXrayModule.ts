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
}

export default TurboModuleRegistry.getEnforcing<Spec>('XrayModule');
