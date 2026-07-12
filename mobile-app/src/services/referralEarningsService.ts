/**
 * Referral earnings (ambassador model): the user earns a fixed % of each
 * person they invited's usage, ongoing. Read-only — the panel computes it so
 * the profile can visualize "how much comes in from each invitee".
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface Invitee {
  label:        string;
  used_bytes:   number;
  earned_bytes: number;
}
export interface ReferralEarnings {
  pct:                number;
  count:              number;
  total_earned_bytes: number;
  invitees:           Invitee[];
}

export async function getReferralEarnings(deviceId: string): Promise<ReferralEarnings> {
  const qs = new URLSearchParams({ mobile: '1', action: 'referral-earnings', _token: TOKEN, device_id: deviceId });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: ReferralEarnings; error?: string };
    if (!json.ok || !json.data) throw new Error(json.error ?? 'earnings error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}
