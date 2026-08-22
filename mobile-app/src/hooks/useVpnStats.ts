import { useEffect, useRef, useState } from 'react';
import { useVpnStore } from '../stores/vpnStore';
import { useAuthStore } from '../stores/authStore';
import { getAdapter }  from '../services/vpnBridge';

export interface VpnStatsResult {
  uploadMbps:   number;
  downloadMbps: number;
  pingMs:       number;
}

const POLL_MS = 3000;

// Consecutive zero-byte-delta polls before treating the tunnel as a "zombie"
// (native reports connected, but no traffic has crossed the TUN interface).
// 20 * 3s = 60s — matches the native traffic_stall watchdog's own tiering
// (30s/60s.../480s in XrayVpnService.kt) without waiting the full 8 minutes
// that watchdog can silently sit at before this fix, since nothing consumed
// its broadcast.
const STALL_POLL_THRESHOLD = 20;

/**
 * Polls the VPN adapter for live stats while connected.
 * Side-effects: pushes cumulative bytes to vpnStore and live rates to diagnosticsStore.
 */
export function useVpnStats(): VpnStatsResult {
  const connectionState = useVpnStore((s) => s.connectionState);
  const setSessionBytes = useVpnStore((s) => s.setSessionBytes);
  const disconnect      = useVpnStore((s) => s.disconnect);
  const user = useAuthStore((s) => s.user);

  const [stats, setStats] = useState<VpnStatsResult>({ uploadMbps: 0, downloadMbps: 0, pingMs: 0 });

  const prevBytesRef = useRef<{ upload: number; download: number; time: number } | null>(null);
  const reportTrafficStall = useVpnStore((s) => s.reportTrafficStall);

  useEffect(() => {
    if (connectionState !== 'connected') {
      prevBytesRef.current = null;
      setStats({ uploadMbps: 0, downloadMbps: 0, pingMs: 0 });
      // Clear stale throughput from diagnosticsStore. Without this the Diagnostics
      // screen keeps showing the last MB/s values after disconnect, while
      // connectionState is already 'idle' — causing the throughput widget and the
      // Self Test / Real Internet Test guards to disagree about VPN state.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useDiagnosticsStore } = require('../stores/diagnosticsStore');
        useDiagnosticsStore.getState().clearLiveStats();
      } catch {}
      return;
    }

    let cancelled = false;
    let stalledPolls = 0;

    const poll = async () => {
      try {
        const s   = await getAdapter().getStats();
        if (cancelled) return;

        setSessionBytes({ sent: s.uploadBytes, received: s.downloadBytes });

        // Quota enforcement: auto-disconnect when free plan exhausts quota.
        if (user && user.plan === 'free') {
          const totalUsed = (user.quotaBytesUsed ?? 0) + s.uploadBytes + s.downloadBytes;
          if (totalUsed >= (user.quotaBytesTotal ?? 0) && user.quotaBytesTotal > 0) {
            disconnect();
            return;
          }
        }

        const now = Date.now();
        let uploadMbps   = 0;
        let downloadMbps = 0;

        if (prevBytesRef.current) {
          const dt       = (now - prevBytesRef.current.time) / 1000;
          const upDelta  = Math.max(0, s.uploadBytes   - prevBytesRef.current.upload);
          const dnDelta  = Math.max(0, s.downloadBytes - prevBytesRef.current.download);
          // NB despite the field name, this is MB/s (bytes/1e6), not true
          // Mbps (bits/1e6) — DiagnosticsScreen already displays this same
          // value labeled "MB/s" with pct bars calibrated to that scale
          // (/10, /30). Keeping the existing convention here; HomeScreen was
          // the one place mislabeling it "Mbps" — fixed there instead of
          // reconverting units and breaking Diagnostics' calibration.
          uploadMbps   = dt > 0 ? (upDelta / dt) / 1_000_000 : 0;
          downloadMbps = dt > 0 ? (dnDelta / dt) / 1_000_000 : 0;

          if (upDelta === 0 && dnDelta === 0) {
            stalledPolls++;
            if (stalledPolls === STALL_POLL_THRESHOLD) {
              reportTrafficStall();
            }
          } else {
            stalledPolls = 0;
          }
        }

        prevBytesRef.current = { upload: s.uploadBytes, download: s.downloadBytes, time: now };

        setStats({
          uploadMbps:   Math.round(uploadMbps   * 10) / 10,
          downloadMbps: Math.round(downloadMbps * 10) / 10,
          pingMs:       s.pingMs,
        });

        // Keep last latency sample in the store so the session record can
        // capture it at disconnect time (Activity log shows per-session ping).
        if (s.pingMs > 0) useVpnStore.getState().setLastPingMs(s.pingMs);

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
