/**
 * Activity timeline — §5.10.3's unified feed across RealGram/VPN/Wallet/
 * Shahnameh. Backed by public/api.php's `activity-timeline` action, which
 * mirrors the merge already built for the admin panel's user-profile
 * timeline, scoped to the calling device.
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface ActivityEvent {
  ts:     string;
  type:   'vpn' | 'referral' | 'quota' | 'app' | 'transfer' | 'redemption' | 'milestone';
  icon:   string;
  label:  string;
  detail: string;
}

export interface ActivityTimeline {
  timeline: ActivityEvent[];
  total:    number;
  offset:   number;
  limit:    number;
}

export async function getActivityTimeline(
  deviceId: string, limit = 5, offset = 0,
): Promise<ActivityTimeline> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const qs = new URLSearchParams({
      mobile: '1', action: 'activity-timeline', _token: TOKEN,
      device_id: deviceId, limit: String(limit), offset: String(offset),
    });
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: ActivityTimeline; error?: string };
    if (!json.ok || !json.data) throw new Error(json.error ?? 'API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}
