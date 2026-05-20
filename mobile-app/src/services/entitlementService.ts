import { APP_VERSION } from '../utils/version';

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface DeviceEntitlement {
  device_id:         string;
  referral_code:     string;
  plan:              string;
  quota_bytes_total: number;
  quota_bytes_used:  number;
  valid_until:       string | null;
  blocked:           boolean;
  server:            BootstrapServer | null;
}

export interface BootstrapServer {
  uuid:        string;
  address:     string;
  port:        number;
  publicKey:   string;
  shortId:     string;
  sni:         string;
  flow:        string;
  fingerprint: string;
}

async function mobilePost(action: string, body: Record<string, string | number>): Promise<unknown> {
  const form = new FormData();
  form.append('_token', TOKEN);
  for (const [k, v] of Object.entries(body)) form.append(k, String(v));

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?mobile=1&action=${action}`, {
      method: 'POST', body: form, signal: ctrl.signal,
    });
    clearTimeout(tid);
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

async function mobileGet(action: string, params: Record<string, string> = {}): Promise<unknown> {
  const qs = new URLSearchParams({ mobile: '1', action, _token: TOKEN, ...params });
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res  = await fetch(`${BASE_URL}?${qs.toString()}`, { signal: ctrl.signal });
    clearTimeout(tid);
    const json = await res.json() as { ok: boolean; data?: unknown; error?: string };
    if (!json.ok) throw new Error(json.error ?? 'API error');
    return json.data;
  } finally {
    clearTimeout(tid);
  }
}

export async function registerDevice(
  deviceId: string,
  platform = 'android',
  options: { language?: string; referralCode?: string; country?: string } = {}
): Promise<DeviceEntitlement> {
  const body: Record<string, string | number> = {
    device_id:   deviceId,
    platform,
    app_version: APP_VERSION,
  };
  if (options.language)     body.language      = options.language;
  if (options.referralCode) body.referral_code = options.referralCode;
  if (options.country)      body.country       = options.country;
  const data = await mobilePost('register-device', body);
  return data as DeviceEntitlement;
}

export async function reportVpnStatus(
  deviceId: string,
  status: 'online' | 'offline',
  protocol?: string
): Promise<void> {
  const body: Record<string, string | number> = { device_id: deviceId, status };
  if (protocol) body.active_protocol = protocol;
  await mobilePost('update-status', body);
}

export async function syncEntitlement(deviceId: string): Promise<DeviceEntitlement> {
  const data = await mobileGet('sync-entitlement', { device_id: deviceId });
  return data as DeviceEntitlement;
}

export async function useReferral(deviceId: string, referralCode: string): Promise<{ bonus_bytes: number; new_total_bytes: number }> {
  const data = await mobilePost('use-referral', { device_id: deviceId, referral_code: referralCode });
  return data as { bonus_bytes: number; new_total_bytes: number };
}

export async function reportUsage(deviceId: string, bytesUsed: number): Promise<{ remaining_bytes: number }> {
  const data = await mobilePost('report-usage', { device_id: deviceId, bytes_used: bytesUsed });
  return data as { remaining_bytes: number };
}

export async function mobilePostPayment(
  deviceId: string,
  packageKey: string,
  memo: string,
): Promise<{ payment_id: number }> {
  const data = await mobilePost('submit-payment', {
    device_id: deviceId,
    package:   packageKey,
    memo,
  });
  return data as { payment_id: number };
}

export async function reportSessionEnd(
  deviceId:     string,
  protocol:     string,
  bytesSent:    number,
  bytesRecv:    number,
  durationSecs: number,
  probeResult:  'ok' | 'fail' | 'unknown' = 'unknown',
  errorReason   = '',
): Promise<void> {
  await mobilePost('report-session', {
    device_id:     deviceId,
    protocol,
    bytes_sent:    bytesSent,
    bytes_recv:    bytesRecv,
    duration_secs: durationSecs,
    app_version:   APP_VERSION,
    probe_result:  probeResult,
    error_reason:  errorReason,
  });
}
