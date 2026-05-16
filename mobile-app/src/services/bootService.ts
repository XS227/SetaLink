// App boot orchestration — runs once on Splash screen completion.
// Determines auth status, resets stale connection state, signals auto-connect.
// Future: add subscription check, device fingerprint, feature flag fetch.

import { Logger } from '../utils/logger';

export type BootStatus = 'auth_required' | 'ready';

export interface BootResult {
  status:            BootStatus;
  shouldAutoConnect: boolean;
}

export async function runBootSequence(): Promise<BootResult> {
  Logger.info('Boot', 'Starting boot sequence');

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

  Logger.info('Boot', `Ready (autoConnect=${autoConnect})`);
  return { status: 'ready', shouldAutoConnect: autoConnect };
}
