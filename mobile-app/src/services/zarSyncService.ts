/**
 * ZAR sync — makes the server the single source of truth for the tap & earn
 * button's ZAR balance (contract §8, REALGRAM_UNIFIED_PLATFORM.md §B,
 * Khabat 2026-07-19).
 *
 * zarStore.tap() still increments locally, instantly, for tap-feel — no
 * visible lag. This service buffers those taps and flushes them to
 * Shahnameh (via the panel's tap-sync proxy — the app never talks to
 * Shahnameh directly or holds real_api_key, same posture as every other
 * ecosystem call) on an interval. Every successful flush OVERWRITES local
 * balance with the server's authoritative total — never adds to it — which
 * is the actual fix for "different ZAR on different devices": any device
 * that flushes converges to the one number the server holds.
 *
 * A failed flush gives its taps back to the buffer rather than losing them
 * — earned ZAR is never silently dropped on a network blip, it just waits
 * for the next successful flush.
 */

import { initTapAnalytics, recordTap } from './tapAnalytics';
import { useVpnStore } from '../stores/vpnStore';
import { useZarStore } from '../stores/zarStore';

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;
const FLUSH_INTERVAL_MS = 12_000;
const MAX_BATCH_TAPS    = 100; // mirrors contract §8's server-side clamp

let pendingTaps = 0;
let deviceId: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let flushing = false;

/** Call once at app start (same place trackEvent's/tapAnalytics' deviceId is
 * known). Also activates tapAnalytics' own periodic flush (B-24 infra,
 * previously built but never initialized from anywhere) — piggybacking
 * here rather than adding a second, separate app-root wiring point. */
export function initZarSync(id: string): void {
  deviceId = id;
  initTapAnalytics(id);
  if (timer) clearInterval(timer);
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
}

/**
 * Call on every coin tap, alongside (not instead of) zarStore.getState().tap()
 * — that call already did the instant local increment. This only buffers
 * the server sync and records the anonymous connection-quality signal
 * (protocol/node, only when actually VPN-connected).
 */
export function recordZarTap(): void {
  pendingTaps += 1;
  const { connectionState, selectedServer } = useVpnStore.getState();
  const connected = connectionState === 'connected';
  recordTap(
    'game_hub', 'tap_coin',
    connected ? selectedServer?.protocol : undefined,
    connected ? selectedServer?.id       : undefined,
  );
  if (pendingTaps >= MAX_BATCH_TAPS) flush();
}

async function flush(): Promise<void> {
  if (pendingTaps === 0 || flushing || !deviceId) return;
  const taps = pendingTaps;
  pendingTaps = 0;
  flushing = true;
  try {
    const form = new FormData();
    form.append('_token', TOKEN);
    form.append('device_id', deviceId);
    form.append('taps', String(taps));
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
    let json: { ok?: boolean; data?: { zar?: number } } | null = null;
    try {
      const res = await fetch(`${BASE_URL}?mobile=1&action=tap-sync`, {
        method: 'POST', body: form, signal: ctrl.signal,
      });
      json = await res.json();
    } finally {
      clearTimeout(tid);
    }
    if (json?.ok && typeof json.data?.zar === 'number') {
      useZarStore.getState().reconcileFromServer(json.data.zar);
    } else {
      pendingTaps += taps; // sync failed — retry these taps next flush
    }
  } catch {
    pendingTaps += taps;
  } finally {
    flushing = false;
  }
}

/** Flush immediately — call on app background/unmount so the tail isn't lost. */
export function flushZarSync(): Promise<void> {
  return flush();
}
