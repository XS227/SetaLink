import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useVpnStore }      from '../stores/vpnStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Logger }           from '../utils/logger';

// Registers AppState listeners that enforce VPN policy on app lifecycle events.
// Mount this once at the root of the Main navigator shell.
export function useAppBoot(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
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
        Logger.info('AppBoot', 'App foregrounded');
        // Future: trigger smart reconnect if was connected + autoConnect
      }
    });

    return () => sub.remove();
  }, []);
}
