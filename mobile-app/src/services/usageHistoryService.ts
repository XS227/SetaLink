/**
 * Daily VPN data-usage history — the "how much have I actually used" trend
 * behind the Data Usage bar chart, companion to ReferralEarningsDonut. The
 * panel computes it server-side (from vpn_sessions) so the app just renders
 * whatever comes back, zero-filled for every day in the window.
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface UsageDay {
  day:   string; // 'YYYY-MM-DD'
  bytes: number;
}
export interface UsageHistory {
  days: UsageDay[];
}

export async function getUsageHistory(deviceId: string, days = 14): Promise<UsageHistory> {
  const qs = new URLSearchParams({
    mobile: '1', action: 'usage-history', _token: TOKEN,
    device_id: deviceId, days: String(days),
  });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as { ok: boolean; data?: UsageHistory; error?: string };
    if (!json.ok || !json.data) throw new Error(json.error ?? 'usage history error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}
