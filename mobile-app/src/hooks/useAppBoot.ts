import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useVpnStore }      from '../stores/vpnStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getAdapter }       from '../services/vpnBridge';
import { Logger }           from '../utils/logger';

// Registers AppState listeners that enforce VPN policy on app lifecycle events.
// Mount this once at the root of the Main navigator shell.
export function useAppBoot(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // On mount: sync native VPN state to JS store in case the app was restarted
    // while the VPN service was already running.
    _syncNativeState();

    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (prev === 'active' && next === 'background') {
        const { killSwitch } = useSettingsStore.getState();
        const { connectionState, disconnect } = useVpnStore.getState();

        if (killSwitch && connectionState === 'connected') {
          Logger.info('AppBoot', 'Kill switch: disconnecting on background');
          disconnect();
        }
      }

      if (next === 'active' && prev === 'background') {
        Logger.info('AppBoot', 'App foregrounded — checking tunnel health');
        _checkTunnelOnForeground();
      }
    });

    return () => sub.remove();
  }, []);
}

// On app mount, if the native service is running but JS thinks idle (app was restarted
// while VPN was active), force-sync the connected state so the user can disconnect.
async function _syncNativeState(): Promise<void> {
  try {
    const { connectionState, setConnectionState } = useVpnStore.getState();
    if (connectionState !== 'idle') return;            // already in a non-idle state
    const running = await getAdapter().isRunning();
    if (running) {
      Logger.info('AppBoot', 'Native VPN running on mount — restoring connected state');
      setConnectionState('connected');
      useVpnStore.setState({ sessionStartedAt: Date.now() });
    }
  } catch (e) {
    Logger.warn('AppBoot', `Native state sync failed: ${e}`);
  }
}

// Checks whether the native tunnel is still alive after the app was backgrounded.
// If the store says "connected" but the tunnel dropped (network switch, idle kill),
// trigger a reconnect so the user isn't left silently unprotected.
async function _checkTunnelOnForeground(): Promise<void> {
  try {
    const { connectionState, connect, clearError } = useVpnStore.getState();
    const { autoConnect } = useSettingsStore.getState();

    if (connectionState === 'connected') {
      const running = await getAdapter().isRunning();
      if (!running) {
        Logger.info('AppBoot', 'Tunnel dropped in background — connecting');
        clearError();
        connect();
      }
    } else if (connectionState === 'failed' && autoConnect) {
      Logger.info('AppBoot', 'Error state on foreground + autoConnect — retrying');
      clearError();
      connect();
    }
  } catch (e) {
    Logger.warn('AppBoot', `Tunnel health check failed: ${e}`);
  }
}
