import { APP_VERSION } from '../utils/version';

const BASE_URL = 'https://setalink.no/api.php';
const TOKEN    = 'setalink-mobile-diag-v1';
const TIMEOUT  = 10_000;

export interface DeviceEntitlement {
  device_id:         string;
  user_id?:          string;
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
  options: {
    language?:    string;
    referralCode?: string;
    country?:     string;
    fingerprint?: Record<string, string | number>;
  } = {}
): Promise<DeviceEntitlement> {
  const body: Record<string, string | number> = {
    device_id:   deviceId,
    platform,
    app_version: APP_VERSION,
  };
  if (options.language)     body.language      = options.language;
  if (options.referralCode) body.referral_code = options.referralCode;
  if (options.country)      body.country       = options.country;
  if (options.fingerprint) {
    const fp = options.fingerprint;
    if (fp.android_id_hash) body.android_id_hash = String(fp.android_id_hash);
    if (fp.manufacturer)    body.manufacturer    = String(fp.manufacturer);
    if (fp.model)           body.model           = String(fp.model);
    if (fp.sdk_version)     body.sdk_version     = Number(fp.sdk_version);
    if (fp.android_version) body.android_version = String(fp.android_version);
  }
  const data = await mobilePost('register-device', body);
  return data as DeviceEntitlement;
}

export async function reportVpnStatus(
  deviceId: string,
  status: 'online' | 'offline',
  options?: string | {
    protocol?:         string;
    dnsOk?:            boolean;
    internetOk?:       boolean;
    activeSni?:        string;
    rxBytes?:          number;
    txBytes?:          number;
    latencyMs?:        number;
    failureCategory?:  string;
  }
): Promise<void> {
  const body: Record<string, string | number> = { device_id: deviceId, status };
  // Accept legacy string argument (protocol only)
  if (typeof options === 'string') {
    if (options) body.active_protocol = options;
  } else if (options) {
    if (options.protocol)                  body.active_protocol    = options.protocol;
    if (options.dnsOk     !== undefined)  body.dns_ok             = options.dnsOk ? 1 : 0;
    if (options.internetOk !== undefined) body.internet_ok        = options.internetOk ? 1 : 0;
    if (options.activeSni)                body.active_sni         = options.activeSni;
    if (options.rxBytes   !== undefined)  body.rx_bytes           = options.rxBytes;
    if (options.txBytes   !== undefined)  body.tx_bytes           = options.txBytes;
    if (options.latencyMs !== undefined)  body.latency_ms         = options.latencyMs;
    if (options.failureCategory)          body.failure_category   = options.failureCategory;
  }
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
  userId?: string,
): Promise<{ payment_id: number }> {
  const body: Record<string, string | number> = {
    device_id: deviceId,
    package:   packageKey,
    memo,
  };
  if (userId) body.user_id = userId;
  const data = await mobilePost('payment-submit', body);
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
