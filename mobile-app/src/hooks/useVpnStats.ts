import { useEffect, useRef, useState } from 'react';
import { useVpnStore } from '../stores/vpnStore';
import { getAdapter }  from '../services/vpnBridge';

export interface VpnStatsResult {
  uploadMbps:   number;
  downloadMbps: number;
  pingMs:       number;
}

const POLL_MS = 3000;

/**
 * Polls the VPN adapter for live stats while connected.
 * Side-effects: pushes cumulative bytes to vpnStore and live rates to diagnosticsStore.
 */
export function useVpnStats(): VpnStatsResult {
  const connectionState = useVpnStore((s) => s.connectionState);
  const setSessionBytes = useVpnStore((s) => s.setSessionBytes);

  const [stats, setStats] = useState<VpnStatsResult>({ uploadMbps: 0, downloadMbps: 0, pingMs: 0 });

  const prevBytesRef = useRef<{ upload: number; download: number; time: number } | null>(null);

  useEffect(() => {
    if (connectionState !== 'connected') {
      prevBytesRef.current = null;
      setStats({ uploadMbps: 0, downloadMbps: 0, pingMs: 0 });
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const s   = await getAdapter().getStats();
        if (cancelled) return;

        setSessionBytes({ sent: s.uploadBytes, received: s.downloadBytes });

        const now = Date.now();
        let uploadMbps   = 0;
        let downloadMbps = 0;

        if (prevBytesRef.current) {
          const dt       = (now - prevBytesRef.current.time) / 1000;
          const upDelta  = Math.max(0, s.uploadBytes   - prevBytesRef.current.upload);
          const dnDelta  = Math.max(0, s.downloadBytes - prevBytesRef.current.download);
          uploadMbps   = dt > 0 ? (upDelta / dt) / 1_000_000 : 0;
          downloadMbps = dt > 0 ? (dnDelta / dt) / 1_000_000 : 0;
        }

        prevBytesRef.current = { upload: s.uploadBytes, download: s.downloadBytes, time: now };

        setStats({
          uploadMbps:   Math.round(uploadMbps   * 10) / 10,
          downloadMbps: Math.round(downloadMbps * 10) / 10,
          pingMs:       s.pingMs,
        });

        // Push live metrics to diagnosticsStore so DiagnosticsScreen stays in sync
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useDiagnosticsStore } = require('../stores/diagnosticsStore');
          useDiagnosticsStore.getState().pushLiveStats({
            ping:         s.pingMs,
            uploadMbps:   Math.round(uploadMbps   * 10) / 10,
            downloadMbps: Math.round(downloadMbps * 10) / 10,
          });
        } catch {}
      } catch {}
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connectionState]);

  return stats;
}
