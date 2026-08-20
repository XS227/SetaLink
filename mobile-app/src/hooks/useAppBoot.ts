import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useVpnStore }      from '../stores/vpnStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore }     from '../stores/authStore';
import { getAdapter }       from '../services/vpnBridge';
import { Logger }           from '../utils/logger';
import { prefetchBundle }   from '../services/profileBundleService';
import { initAds, preloadInterstitial, showInterstitialOnConnect } from '../services/adsService';

// Registers AppState listeners that enforce VPN policy on app lifecycle events.
// Mount this once at the root of the Main navigator shell.
export function useAppBoot(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // On mount: prefetch profile bundle and sync native VPN state
    prefetchBundle();
    _syncNativeState();
    _showOpenAdIfDue('cold_start');

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
        _showOpenAdIfDue('foreground');
      }
    });

    return () => sub.remove();
  }, []);
}

// Ad gate mirrors HomeScreen's userShowsAds: plan==='free' OR the backend has
// flagged this device testMode (devices.test_mode) — never shown to a real
// premium user. Best-effort only: shows a preloaded interstitial if one is
// ready, otherwise just kicks off a preload for next time — app open/foreground
// must never be delayed by an ad. Rate-limited so quickly switching apps back
// and forth doesn't spam an interstitial on every foreground.
const OPEN_AD_MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes
let _lastOpenAdAt = 0;

function _showOpenAdIfDue(trigger: 'cold_start' | 'foreground'): void {
  const user = useAuthStore.getState().user;
  const showsAds = user?.plan === 'free' || !!user?.testMode;
  if (!showsAds) return;

  const now = Date.now();
  if (now - _lastOpenAdAt < OPEN_AD_MIN_GAP_MS) return;

  // Skip while disconnected: in markets where Google is only reachable through
  // the tunnel (Iran), a preload attempted here has nothing to load through and
  // just hangs/fails. HomeScreen's connect-transition effect fires a fresh,
  // tunnel-side load as soon as the user actually connects, so this open/
  // foreground trigger only needs to cover the case where the tunnel is
  // already up (e.g. reopening the app while still connected).
  if (useVpnStore.getState().connectionState !== 'connected') return;

  initAds().then(() => {
    if (showInterstitialOnConnect()) {
      _lastOpenAdAt = now;
      Logger.info('AppBoot', `Ad shown on ${trigger}`);
    } else {
      preloadInterstitial();
    }
  }).catch(() => {});
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
//
// Khabat, 2026-08-20: "ads kommer, klarer ikke laste den ned, lukker den, VPN
// klarer ikke fortsette tilkoblingen, må koble av og på igjen" — reported while
// CONNECTING, not disconnecting. Root cause: showing the Connect-time
// interstitial (adsService.ts's gateActionWithAd, fired in parallel with
// connect() from HomeScreen's handlePower) backgrounds the host Activity like
// any full-screen ad does, so this same active→background→active cycle fires
// mid-handshake. This function used to only handle 'connected' and 'failed' on
// the way back to foreground — a stall in 'connecting' fell through untouched.
// That state has no self-CONNECT transition (connectionMachine.ts's
// TRANSITIONS — only 'idle' and 'failed' accept CONNECT), so tapping Connect
// again silently did nothing; only disconnect() can move it out of
// 'connecting', which is exactly the manual toggle this was forcing.
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
    } else if (connectionState === 'connecting') {
      const running = await getAdapter().isRunning();
      if (running) {
        // Handshake actually finished while backgrounded (e.g. behind the ad) —
        // sync the store the same way _syncNativeState does on cold start.
        Logger.info('AppBoot', 'Tunnel came up in background — syncing to connected');
        useVpnStore.setState({ connectionState: 'connected', sessionStartedAt: Date.now() });
      } else {
        // Orphaned attempt — unwind it via the real disconnect() action (not a
        // raw setState) so the underlying ConnectionMachine's own internal
        // state, not just the store's mirror of it, actually reaches 'idle';
        // otherwise the next CONNECT send would still be silently ignored.
        Logger.info('AppBoot', 'Connect attempt orphaned in background — resetting');
        useVpnStore.getState().disconnect();
        for (let i = 0; i < 25 && useVpnStore.getState().connectionState !== 'idle'; i++) {
          await new Promise<void>((r) => setTimeout(r, 200));
        }
        if (useVpnStore.getState().connectionState === 'idle') {
          Logger.info('AppBoot', 'Reset complete — retrying connect');
          connect();
        }
      }
    }
  } catch (e) {
    Logger.warn('AppBoot', `Tunnel health check failed: ${e}`);
  }
}
