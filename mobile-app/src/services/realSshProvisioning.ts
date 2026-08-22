/**
 * REAL SSH — device-side provisioning client for public/real-ssh.php.
 *
 * Only ever transports the device's PUBLIC key. The private key is generated
 * and stored natively (Android Keystore-backed) and never crosses this
 * boundary — see NativeXrayModule.getOrCreateRealSshIdentity().
 */
import { getAdapter } from './vpnBridge';

const BASE_URL = 'https://setalink.no/real-ssh.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

interface RealSshStatus {
  status: 'none' | 'pending' | 'active' | 'revoking' | 'revoked' | 'error';
  error?: string;
}

async function call(
  action: string,
  method: 'GET' | 'POST',
  params: Record<string, string> = {},
): Promise<RealSshStatus> {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    let res: Response;
    if (method === 'POST') {
      const form = new FormData();
      form.append('_token', TOKEN);
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      res = await fetch(`${BASE_URL}?mobile=1&action=${action}`, { method: 'POST', body: form, signal: ctrl.signal });
    } else {
      const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
      res = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    }
    const json = await res.json() as { ok: boolean; data?: RealSshStatus; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'real-ssh API error');
    return json.data ?? { status: 'none' };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Ensures this device has an active REAL SSH identity before connecting.
 * Cheap no-op once already active/pending. Generates the on-device keypair
 * (if not already generated) and provisions only the public key.
 */
export async function ensureRealSshProvisioned(deviceId: string): Promise<void> {
  const status = await call('real-ssh-status', 'GET', { device_id: deviceId });
  if (status.status === 'active' || status.status === 'pending') return;

  const identity = await getAdapter().getOrCreateRealSshIdentity?.();
  if (!identity?.publicKey) throw new Error('REAL SSH: could not generate device key');
  await call('real-ssh-provision', 'POST', { device_id: deviceId, public_key: identity.publicKey });
}
