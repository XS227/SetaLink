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

  /** Stop the running tunnel gracefully. */
  stop(): Promise<void>;

  /** Returns true if the Xray process is running. */
  isRunning(): Promise<boolean>;

  /** Returns live traffic stats from the running tunnel. */
  getStats(): Promise<XrayStats>;

  /** Validate a config string without starting the tunnel. */
  validateConfig(config: string): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('XrayModule');
