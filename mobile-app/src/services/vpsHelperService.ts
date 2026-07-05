/**
 * ReaLink VPS Helper — client service (Case 2: server-side exit).
 *
 * For users who SSH into their OWN VPS (Termius) and run tools like Claude Code
 * THERE. That traffic is on the VPS, not the phone — so mobile Smart Mode /
 * per-app bypass cannot help, and the VPS's own IP is often sanctioned. The
 * backend provisions a dedicated, revocable node identity for the device and
 * returns ONE install command the user pastes into their VPS.
 *
 * This service ONLY talks to the backend. It does NOT change the VPN, Smart
 * Mode, per-app bypass, or route Termius — it is informational + provisioning.
 */

const BASE  = 'https://setalink.no/vps-helper.php';
const TOKEN  = 'setalink-mobile-diag-v1';
const TIMEOUT_MS = 12_000;

export type VpsHelperStatus = 'none' | 'pending' | 'active' | 'revoking' | 'revoked' | 'error';

export interface VpsHelperState {
  status: VpsHelperStatus;
  node?: string | null;
  exitIp?: string | null;
  /** Only present when status === 'active'. The single command to paste into the VPS. */
  installCommand?: string;
  error?: string;
}

async function call(
  method: 'GET' | 'POST',
  action: string,
  deviceId: string,
): Promise<VpsHelperState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${BASE}?mobile=1&action=${action}` +
      (method === 'GET'
        ? `&_token=${encodeURIComponent(TOKEN)}&device_id=${encodeURIComponent(deviceId)}`
        : '');
    const init: RequestInit = { method, signal: controller.signal };
    if (method === 'POST') {
      const form = new URLSearchParams();
      form.append('_token', TOKEN);
      form.append('device_id', deviceId);
      init.body = form.toString();
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }
    const res = await fetch(url, init);
    const json = await res.json();
    if (!json?.ok) return { status: 'error', error: String(json?.error ?? 'request failed') };
    const d = json.data ?? {};
    return {
      status: (d.status ?? 'none') as VpsHelperStatus,
      node: d.node ?? null,
      exitIp: d.exit_ip ?? null,
      installCommand: d.install_command,
      error: d.error,
    };
  } catch (e: any) {
    return { status: 'error', error: e?.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

export const vpsHelperService = {
  getStatus:  (deviceId: string) => call('GET',  'vps-helper-status',    deviceId),
  provision:  (deviceId: string) => call('POST', 'vps-helper-provision', deviceId),
  revoke:     (deviceId: string) => call('POST', 'vps-helper-revoke',    deviceId),
};
