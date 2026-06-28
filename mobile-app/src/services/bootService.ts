// App boot orchestration — runs once on Splash screen completion.
// Determines auth status, resets stale connection state, signals auto-connect.
// Future: add subscription check, device fingerprint, feature flag fetch.

import { Logger } from '../utils/logger';

export type BootStatus = 'auth_required' | 'ready';

export interface BootResult {
  status:            BootStatus;
  shouldAutoConnect: boolean;
}

// Reports the outcome of a previously started OTA update (success, or
// failure when the app still runs the old build) to the install
// diagnostics endpoint. Fire-and-forget — never blocks boot.
function reportPendingInstallOutcome(): void {
  (async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolvePendingInstall } = require('./updateService');
    const pending = resolvePendingInstall();
    if (!pending) return;
    Logger.info('Boot', `OTA outcome: ${pending.outcome} (${pending.fromVersion} → ${pending.targetVersion})`);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { reportInstallEvent } = require('./entitlementService');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getStableDeviceId, getDeviceFingerprint } = require('./deviceIdentityService');
    const [deviceId, fingerprint] = await Promise.all([getStableDeviceId(), getDeviceFingerprint()]);
    await reportInstallEvent({
      event:          pending.outcome,
      deviceId,
      currentVersion: pending.fromVersion,
      targetVersion:  pending.targetVersion,
      fingerprint,
    });
  })().catch(() => {});
}

export async function runBootSequence(): Promise<BootResult> {
  Logger.info('Boot', 'Starting boot sequence');

  reportPendingInstallOutcome();

  // Stores are synchronously hydrated from MMKV persist before this runs.
  // Lazy-require to avoid circular module graph at declaration time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAuthStore }     = require('../stores/authStore');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useSettingsStore } = require('../stores/settingsStore');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useVpnStore }      = require('../stores/vpnStore');

  const { isAuthenticated }  = useAuthStore.getState();
  const { autoConnect }      = useSettingsStore.getState();
  const { connectionState, resetSession } = useVpnStore.getState();

  if (!isAuthenticated) {
    Logger.info('Boot', 'Auth required — routing to auth screen');
    return { status: 'auth_required', shouldAutoConnect: false };
  }

  // Any persisted non-idle connection state is stale at boot — native VPN
  // process doesn't survive app restarts in this phase.
  if (connectionState !== 'idle') {
    Logger.info('Boot', 'Resetting stale connection state');
    resetSession();
  }

  // Persist the device_id into the App Group at boot so the PacketTunnel extension
  // always has it for diagnostic uploads — including the auto-fallback connect path
  // (autoConnector calls adapter.connect directly and never sets the diag context),
  // which is why earlier tunnel logs showed device_id="unknown".
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setDiagnosticContext } = require('./vpnBridge');
    const user = useAuthStore.getState().user;
    if (user?.deviceId) {
      setDiagnosticContext(user.deviceId, '').catch(() => {});
    }
  } catch {}

  Logger.info('Boot', `Ready (autoConnect=${autoConnect})`);
  return { status: 'ready', shouldAutoConnect: autoConnect };
}
