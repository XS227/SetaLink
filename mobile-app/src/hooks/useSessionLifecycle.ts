import { useEffect, useRef } from 'react';
import { useVpnStore } from '../stores/vpnStore';

// Simulates incremental traffic bytes while connected.
// Interval: every 5 s at ~4 MB/s up, ~18 MB/s down.
// Future: replace with real Xray stats polling via native bridge.
const SAMPLE_INTERVAL_MS = 5000;

export function useSessionLifecycle(): void {
  const connectionState  = useVpnStore((s) => s.connectionState);
  const addSessionBytes  = useVpnStore((s) => s.addSessionBytes);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (connectionState === 'connected') {
      intervalRef.current = setInterval(() => {
        // bytes per 5 s window at simulated rates
        const sent     = Math.round((3.5 + Math.random())      * SAMPLE_INTERVAL_MS / 1000 * 1024 * 1024 / 8);
        const received = Math.round((15  + Math.random() * 6)  * SAMPLE_INTERVAL_MS / 1000 * 1024 * 1024 / 8);
        addSessionBytes(sent, received);
      }, SAMPLE_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connectionState]);
}
