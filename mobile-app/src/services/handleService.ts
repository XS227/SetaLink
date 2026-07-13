// Handle reservation (A-11) — local-first, backend-optional.
//
// The uniqueness authority is Agent B's B-14 endpoint (`handle-lookup` +
// reservation), which isn't live yet. Until it is, this service degrades
// cleanly: it tries the backend, and on "unknown action" / any error / a
// timeout it returns a *local* claim so the user is never blocked from
// picking a name. When B-14 lands, the same call starts returning real
// availability and a 'reserved' state — no app change needed.

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 8_000;

export type ReserveSource = 'backend' | 'local';

export interface HandleResult {
  available: boolean;
  source:    ReserveSource;   // 'local' = backend not live / unreachable
  reason?:   string;          // e.g. 'taken' when backend says so
}

async function call(action: string, params: Record<string, string>): Promise<HandleResult> {
  const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    const json = await res.json() as {
      ok: boolean; data?: { available?: boolean; reason?: string }; error?: string;
    };
    // Backend live and answered: trust it.
    if (json.ok && json.data && typeof json.data.available === 'boolean') {
      return { available: json.data.available, source: 'backend', reason: json.data.reason };
    }
    // Backend reachable but doesn't know this action yet (B-14 not deployed) —
    // treat as "not gating" so the user can still claim the handle locally.
    return { available: true, source: 'local' };
  } catch {
    // Timeout / offline / parse error — never block the user on identity.
    return { available: true, source: 'local' };
  } finally {
    clearTimeout(tid);
  }
}

/** Read-only availability check for live validation as the user types. */
export function checkHandleAvailable(handle: string): Promise<HandleResult> {
  return call('handle-lookup', { handle });
}

/** Claim a handle for this device. Backend-authoritative when B-14 is live. */
export function reserveHandle(handle: string, deviceId: string): Promise<HandleResult> {
  return call('handle-reserve', { handle, device_id: deviceId });
}
