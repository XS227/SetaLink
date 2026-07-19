/**
 * Tap-stream analytics (B-24) — batches UI taps client-side and flushes
 * periodically, instead of one HTTP call per tap like analytics.ts's
 * trackEvent. Same best-effort posture: never throws, never blocks UI,
 * silently drops on failure.
 */

import { APP_VERSION } from '../utils/version';

const BASE_URL      = 'https://setalink.no/api.php';
const TOKEN         = 'setalink-mobile-diag-v1';
const TIMEOUT        = 10_000;
const FLUSH_INTERVAL_MS = 15_000;
const MAX_BATCH_SIZE    = 30; // flush early if the buffer fills up between timers

type Tap = { screen: string; element: string; ts: number };

let buffer: Tap[] = [];
let deviceId: string | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/** Call once at app start (same place trackEvent's deviceId is known). Safe to call again (e.g. after account switch) — resets the flush timer. */
export function initTapAnalytics(id: string): void {
  deviceId = id;
  if (timer) clearInterval(timer);
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
}

/** Record a tap — cheap, synchronous, never touches the network directly. */
export function recordTap(screen: string, element: string): void {
  buffer.push({ screen, element, ts: Date.now() });
  if (buffer.length >= MAX_BATCH_SIZE) flush();
}

function flush(): void {
  if (buffer.length === 0) return;
  const taps = buffer;
  buffer = [];
  try {
    const form = new FormData();
    form.append('_token', TOKEN);
    if (deviceId) form.append('device_id', deviceId);
    form.append('app_version', APP_VERSION);
    form.append('taps', JSON.stringify(taps));
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
    fetch(`${BASE_URL}?mobile=1&action=track-taps-batch`, { method: 'POST', body: form, signal: ctrl.signal })
      .catch(() => {})
      .finally(() => clearTimeout(tid));
  } catch {
    /* never let analytics break the UI */
  }
}

/** Flush immediately — call on app background/unmount so the tail isn't lost. */
export function flushTapAnalytics(): void {
  flush();
}
