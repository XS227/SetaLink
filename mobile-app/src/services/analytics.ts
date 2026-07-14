/**
 * Lightweight client analytics — fire-and-forget event logging.
 *
 * Best-effort only: never throws, never blocks UI, silently drops on failure.
 * Posts to the existing mobile API (api.php?action=track-event). Not authoritative
 * — purely for product insight (e.g. the Premium/payments funnel).
 */

import { APP_VERSION } from '../utils/version';

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';

/** Canonical event names (keep in sync with what the screens emit). */
export const Events = {
  PREMIUM_SCREEN_OPENED:    'PREMIUM_SCREEN_OPENED',
  PREMIUM_PACKAGE_SELECTED: 'PREMIUM_PACKAGE_SELECTED',
  PAYMENT_INTENT_CREATED:   'PAYMENT_INTENT_CREATED',
  PAYMENT_CONFIRMED_REAL:   'PAYMENT_CONFIRMED_REAL',
  PAYMENT_CONFIRMED_USDT:   'PAYMENT_CONFIRMED_USDT',
  PAYMENT_FAILED:           'PAYMENT_FAILED',
  TONKEEPER_OPENED:         'TONKEEPER_OPENED',
  ECOSYSTEM_BANNER_CLICK:   'ecosystem_banner_click',
} as const;

export type EventName = typeof Events[keyof typeof Events] | string;

export function trackEvent(
  event: EventName,
  deviceId?: string,
  props?: Record<string, unknown>,
): void {
  try {
    if (__DEV__) console.log('[event]', event, props ?? '');
    const form = new FormData();
    form.append('_token', TOKEN);
    form.append('event', String(event));
    form.append('app_version', APP_VERSION);
    if (deviceId) form.append('device_id', deviceId);
    if (props)    form.append('props', JSON.stringify(props));
    // Fire-and-forget: do not await, swallow all errors.
    fetch(`${BASE_URL}?mobile=1&action=track-event`, { method: 'POST', body: form })
      .catch(() => {});
  } catch {
    /* never let analytics break the UI */
  }
}
