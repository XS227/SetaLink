/**
 * REAL wallet — panel-proxied ecosystem wallet (plan item A3).
 *
 * The app NEVER talks to the Shahnameh backend or holds its API key: the
 * SetaLink panel proxies balance reads and orchestrates the debit
 * (docs/realgram/TASK_SPLIT.md contracts 3–4). `balance: null` means the
 * ecosystem service couldn't answer — the card still renders link state and
 * rates, so the UI never blocks on the wallet backend being up.
 *
 * redeemRealSpend is retry-safe: the panel keys the debit on client_ref, so
 * resubmitting after a timeout can't spend or credit twice.
 */

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface RealWalletRates {
  real_per_gb:            number;
  redeem_min_real:        number;
  redeem_daily_cap_bytes: number;
}

export interface RealWalletInfo {
  linked_account:       string;   // '' = not linked
  balance:              number | null;
  /** ZAR balance (game currency) — B-23, contract §3 v2. Server-tracked, not client-only. */
  zar:                  number | null;
  /** ZAR→REAL conversion rate, when the ecosystem publishes one. */
  conversion_rate:      number | null;
  rates:                RealWalletRates;
  redeemed_today_bytes: number;
}

export interface RedeemResult {
  status:       'credited' | 'pending';
  quota_bytes:  number;
  new_total?:   number;
  balance?:     number | null;
  duplicate?:   boolean;
}

export interface ZarSwapResult {
  new_zar:                 number;
  new_real_balance:        number;
  real_earned_this_season: number;
  zar_cost:                number;
  amount_real:              number;
  rate:                     number;
  duplicate?:               boolean;
}

async function call(action: string, method: 'GET' | 'POST',
                    params: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    let res: Response;
    if (method === 'GET') {
      const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
      res = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    } else {
      const form = new FormData();
      form.append('_token', TOKEN);
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      res = await fetch(`${BASE_URL}?mobile=1&action=${action}`, {
        method: 'POST', body: form, signal: ctrl.signal,
      });
    }
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

export async function getRealWallet(deviceId: string): Promise<RealWalletInfo> {
  return await call('real-wallet', 'GET', { device_id: deviceId }) as RealWalletInfo;
}

export async function redeemRealSpend(
  deviceId: string, realAmount: number, clientRef: string,
): Promise<RedeemResult> {
  return await call('redeem-real-spend', 'POST', {
    device_id:   deviceId,
    real_amount: String(realAmount),
    client_ref:  clientRef,
  }) as RedeemResult;
}

/**
 * Convert ZAR to REAL (contract per docs/realgram/TASK_SPLIT.md B->A(114)).
 * Retry-safe like redeemRealSpend: the panel keys the conversion on
 * client_ref, so resubmitting after a timeout replays the stored outcome
 * instead of converting twice — required here since Shahnameh's own
 * /v1/zar-swap has no idempotency of its own (flagged in B->A(114)).
 * Callers MUST generate a fresh client_ref per attempt and reuse the SAME
 * one if retrying the same attempt (same convention as redeemRealSpend).
 */
export async function convertZarToReal(
  deviceId: string, amountReal: number, clientRef: string,
): Promise<ZarSwapResult> {
  return await call('zar-swap', 'POST', {
    device_id:   deviceId,
    amount_real: String(amountReal),
    client_ref:  clientRef,
  }) as ZarSwapResult;
}

export async function linkRealAccount(
  deviceId: string, realAccount: string, ts: number, sig: string,
): Promise<{ linked_real_account: string }> {
  return await call('link-real-account', 'POST', {
    device_id:    deviceId,
    real_account: realAccount,
    ts:           String(ts),
    sig,
  }) as { linked_real_account: string };
}
