import { Alert } from 'react-native';
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
  // v0.9.31 server-side quota ledger (optional — older endpoints omit these).
  quota?:            QuotaSummary;
  milestones?:       MilestoneProgress;
  packages?:         PurchasedPackage[];
  // REAL-ID: the linked ecosystem account ('' = not linked yet). Shared across
  // Shahnameh, 3REAL, TrustAI, RealGram. Set by linking via @shahnameh_bot or RealGram.
  linked_real_account?: string;
}

/** Server-side quota ledger breakdown (bytes). All profile cards read this. */
export interface QuotaSummary {
  starter_quota:      number;  // non-transferable welcome grant
  referral_quota:     number;
  purchased_quota:    number;
  promotion_quota:    number;
  transfer_in_quota:  number;
  transfer_out_quota: number;  // negative
  adjustment_quota:   number;
  total_quota:        number;
  used_quota:         number;
  remaining_quota:    number;
  transferable_quota: number;  // available to send (starter excluded)
}

export interface MilestoneItem {
  count:     number;
  bytes:     number;
  badge:     string;
  rewardKey: string;
  reached:   boolean;
  claimed:   boolean;
}

export interface MilestoneProgress {
  invite_count:      number;
  current_milestone: number;
  next_milestone:    number | null;
  next_reward_key:   string | null;
  next_reward_bytes: number;
  progress:          number;  // 0..1 toward next milestone
  milestones:        MilestoneItem[];
}

export interface PurchasedPackage {
  id:                number;
  package_name:      string;
  bytes:             number;
  purchase_date:     string;
  payment_reference: string;
}

export interface QuotaSummaryResponse {
  quota:      QuotaSummary;
  milestones: MilestoneProgress;
  packages:   PurchasedPackage[];
}

export interface TransferRecipient {
  device_id: string;
  user_id:   string;
  country:   string;
  blocked:   boolean;
}

export interface TransferResult {
  transfer_id:      number;
  bytes:            number;
  receiver_device:  string;
  receiver_user_id: string;
  sender:           QuotaSummary;
}

export interface TransferRecord {
  id:               number;
  direction:        'in' | 'out';
  sender_device:    string;
  receiver_device:  string;
  sender_user_id:   string;
  receiver_user_id: string;
  bytes:            number;
  status:           string;
  created_at:       string;
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
    // SIM country survives the tunnel (request IP does not) — send it as the
    // country when the caller didn't supply one explicitly.
    if (!body.country && fp.sim_country) body.country = String(fp.sim_country);
    // Carrier/operator name → drives per-operator learned routing server-side.
    if (fp.carrier_name)    body.carrier         = String(fp.carrier_name);
    if (fp.android_id_hash) body.android_id_hash = String(fp.android_id_hash);
    if (fp.manufacturer)    body.manufacturer    = String(fp.manufacturer);
    if (fp.model)           body.model           = String(fp.model);
    if (fp.sdk_version)     body.sdk_version     = Number(fp.sdk_version);
    if (fp.android_version) body.android_version = String(fp.android_version);
    if (fp.abi)             body.abi             = String(fp.abi);
  }
  const data = await mobilePost('register-device', body);
  return data as DeviceEntitlement;
}

/**
 * Report an OTA install outcome (success/failure) so the admin install
 * diagnostics page can surface devices where updates fail to install
 * (wrong ABI, blocked installer, storage full, …). Fire-and-forget.
 */
export async function reportInstallEvent(event: {
  event: 'install_success' | 'install_failure' | 'download_started';
  deviceId?: string;
  currentVersion?: string;
  targetVersion?: string;
  error?: string;
  fingerprint?: Record<string, string | number>;
}): Promise<void> {
  try {
    const body: Record<string, string | number> = { event: event.event };
    if (event.deviceId)       body.device_id       = event.deviceId;
    if (event.currentVersion) body.current_version = event.currentVersion;
    if (event.targetVersion)  body.target_version  = event.targetVersion;
    if (event.error)          body.error           = event.error;
    const fp = event.fingerprint;
    if (fp) {
      if (fp.model)           body.device_model    = String(fp.model);
      if (fp.android_version) body.android_version = String(fp.android_version);
      if (fp.sdk_version)     body.android_sdk     = Number(fp.sdk_version);
      if (fp.abi)             body.abi             = String(fp.abi);
    }
    await mobilePost('report-install', body);
  } catch {
    // never block the caller on telemetry
  }
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

export interface AdminMessage { id: number; title: string; body: string; created_at: string; }

export async function getMessages(deviceId: string): Promise<AdminMessage[]> {
  const data = await mobileGet('get-messages', { device_id: deviceId }) as { messages?: AdminMessage[] };
  return data.messages ?? [];
}

export async function ackMessage(deviceId: string, messageId: number): Promise<void> {
  await mobilePost('ack-message', { device_id: deviceId, message_id: messageId });
}

// Poll-based "push": fetch unread admin messages and show them one at a
// time; each is acked when dismissed so it never reappears. Called at app
// launch and on the connected heartbeat. Never throws.
export async function checkAdminMessages(deviceId: string): Promise<void> {
  try {
    const msgs = await getMessages(deviceId);
    for (const m of msgs) {
      await new Promise<void>((resolve) => {
        Alert.alert(m.title || 'RealGram', m.body,
          [{ text: 'OK', onPress: () => resolve() }], { cancelable: false });
      });
      ackMessage(deviceId, m.id).catch(() => {});
    }
  } catch { /* offline — retry on next poll */ }
}

// ── User-to-user direct messages (v0.9.33) ────────────────────────────────────

/**
 * Peer VIP/verified/premium status (2026-07-20) — comes back embedded on
 * every DirectMessage via list-messages' batched `peers` map (see
 * lib/quota_economy.php's qe_badge_info_for_devices()), never a separate
 * per-user fetch. isVip/vipTier are earned via the referral milestone
 * ladder ('vip' at 21 invites, 'elite' at 55); verified/premiumUntil track
 * a confirmed paying plan — the two are independent and can both be true.
 */
export interface PeerBadge {
  isVip:        boolean;
  vipTier:      'vip' | 'elite' | null;
  verified:     boolean;
  premiumUntil: string | null;
}

export const DEFAULT_PEER_BADGE: PeerBadge = {
  isVip: false, vipTier: null, verified: false, premiumUntil: null,
};

export interface DirectMessage {
  id:          number;
  direction:   'in' | 'out';
  peerUserId:  string;   // RealGram ID of the other party (sender for 'in')
  peerDevice:  string;
  body:        string;
  read:        boolean;
  createdAt:   string;
  /** Disappearing-message timer (seconds after read); 0 = never. */
  expireSecs:  number;
  /** UTC 'YYYY-MM-DD HH:MM:SS' when the message burns — set once it is read. */
  expiresAt:   string | null;
  /** Reaction counts by emoji, e.g. { '👍': 2 } — empty object when none.
   *  Optional: older test fixtures / pre-2026-07-22 cached data won't have it. */
  reactions?:  Record<string, number>;
  /** This device's own reaction, if any (null = hasn't reacted, undefined =
   *  unknown/older data). */
  myReaction?: string | null;
  /** The OTHER party's badge status — same value on every message from/to
   *  them, carried per-message purely so callers never need a second
   *  lookup keyed by peerDevice. Only `list-messages` returns a `peers` map
   *  server-side; threads/search paths fall back to DEFAULT_PEER_BADGE. */
  peerBadge:   PeerBadge;
}

/** Max characters per direct message — mirrors MSG_MAX_LEN server-side. */
export const DM_MAX_LEN = 2000;

/** Fixed reaction set — mirrors MSG_REACTIONS server-side (lib/messaging.php). */
export const DM_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** Send a direct message addressed by RealGram ID (user_id / device_id / referral code).
 *  `expireSecs` > 0 makes it a disappearing message: the server hard-deletes it
 *  that many seconds after the recipient reads it (Wickr-style). */
export async function sendMessage(
  deviceId: string, recipient: string, body: string, expireSecs = 0,
): Promise<{ message_id: number; recipient_user_id: string; created_at: string }> {
  const data = await mobilePost('send-message', {
    device_id: deviceId, recipient, body,
    ...(expireSecs > 0 ? { expire_secs: String(expireSecs) } : {}),
  });
  return data as { message_id: number; recipient_user_id: string; created_at: string };
}

type RawDirectMessage = {
  id: number; direction: 'in' | 'out'; peer_user_id: string;
  peer_device: string; body: string; read: boolean; created_at: string;
  expire_secs?: number; expires_at?: string | null;
  reactions?: Record<string, number>; my_reaction?: string | null;
};

/** device_id -> badge, one entry per distinct peer — see
 *  qe_badge_info_for_devices() server-side. Only `list-messages` returns
 *  this map today; other endpoints pass `undefined` and get the default. */
type PeerBadgeMap = Record<string, PeerBadge>;

function mapDirectMessage(m: RawDirectMessage, peers?: PeerBadgeMap): DirectMessage {
  return {
    id:         m.id,
    direction:  m.direction,
    peerUserId: m.peer_user_id,
    peerDevice: m.peer_device,
    body:       m.body,
    read:       m.read,
    createdAt:  m.created_at,
    expireSecs: m.expire_secs ?? 0,
    expiresAt:  m.expires_at ?? null,
    reactions:  m.reactions ?? {},
    myReaction: m.my_reaction ?? null,
    peerBadge:  peers?.[m.peer_device] ?? DEFAULT_PEER_BADGE,
  };
}

/** Fetch this device's direct-message thread (inbox + sent), newest first. */
export async function listMessages(deviceId: string): Promise<DirectMessage[]> {
  const data = await mobileGet('list-messages', { device_id: deviceId }) as {
    messages?: RawDirectMessage[];
    peers?: PeerBadgeMap;
  };
  const peers = data.peers ?? {};
  return (data.messages ?? []).map(m => mapDirectMessage(m, peers));
}

/** "Load older" pagination for one open thread (2026-07-22, chat audit bug #1)
 *  -- listMessages() above is capped at 200 combined across every thread, so
 *  older messages can silently disappear once that's crossed. This fetches
 *  further back in a single peer's thread on demand, newest-first (prepend
 *  to the already-loaded thread). `peer` is peerUserId or peerDevice, either
 *  works (mirrors sendMessage's recipient param). */
export async function listThreadMessages(
  deviceId: string, peer: string, beforeId: number, limit = 50,
): Promise<DirectMessage[]> {
  const data = await mobileGet('list-thread-messages', {
    device_id: deviceId, peer, before_id: String(beforeId), limit: String(limit),
  }) as { messages?: RawDirectMessage[] };
  return (data.messages ?? []).map(m => mapDirectMessage(m));
}

/** Server-side search fallback (2026-07-22, chat audit bug #2) -- the
 *  in-app search only covers listMessages()'s locally-cached window; this
 *  searches this device's full recent message history server-side for
 *  anything the local cache doesn't have. Lighter shape than DirectMessage
 *  (no reactions/read/expire — those aren't shown in search results). */
export async function searchMessages(deviceId: string, query: string): Promise<Array<{
  id: number; direction: 'in' | 'out'; peerUserId: string; peerDevice: string;
  body: string; createdAt: string;
}>> {
  const q = query.trim();
  if (!q) return [];
  const data = await mobileGet('search-messages', { device_id: deviceId, q }) as {
    results?: Array<{ id: number; direction: 'in' | 'out'; peer_user_id: string; peer_device: string; body: string; created_at: string }>;
  };
  return (data.results ?? []).map(r => ({
    id: r.id, direction: r.direction, peerUserId: r.peer_user_id,
    peerDevice: r.peer_device, body: r.body, createdAt: r.created_at,
  }));
}

/** React to a message with one of DM_REACTIONS. Tapping the same emoji again
 *  toggles it off. Returns the message's full reaction summary. */
export async function reactToMessage(
  deviceId: string, messageId: number, emoji: string,
): Promise<{ counts: Record<string, number>; mine: string | null }> {
  const data = await mobilePost('react-message', { device_id: deviceId, message_id: messageId, emoji }) as {
    counts?: Record<string, number>; mine?: string | null;
  };
  return { counts: data.counts ?? {}, mine: data.mine ?? null };
}

/** Fire-and-forget: tell the server this device is typing to `peer` right
 *  now. Safe to call on every keystroke — cheap upsert, no explicit "stopped
 *  typing" call needed (server-side TTL handles that). */
export async function setTyping(deviceId: string, peer: string): Promise<void> {
  await mobilePost('set-typing', { device_id: deviceId, peer });
}

/** Poll: is `peer` currently typing to this device? */
export async function getTyping(deviceId: string, peer: string): Promise<boolean> {
  const data = await mobileGet('get-typing', { device_id: deviceId, peer }) as { typing?: boolean };
  return !!data.typing;
}

/** Fixed reason set — mirrors MSG_REPORT_REASONS server-side (lib/messaging.php). */
export const DM_REPORT_REASONS = ['spam', 'harassment', 'scam', 'illegal', 'other'] as const;
export type DMReportReason = typeof DM_REPORT_REASONS[number];

/** Block a peer (device_id / user_id / referral_code) — silences the thread
 *  both directions server-side (dm_send rejects either party messaging the
 *  other once blocked). Does not delete existing history. */
export async function blockUser(deviceId: string, peer: string): Promise<void> {
  await mobilePost('block-user', { device_id: deviceId, peer });
}

export async function unblockUser(deviceId: string, peer: string): Promise<void> {
  await mobilePost('unblock-user', { device_id: deviceId, peer });
}

export async function listBlockedUsers(deviceId: string): Promise<Array<{
  deviceId: string; userId: string; blockedAt: string;
}>> {
  const data = await mobileGet('list-blocked', { device_id: deviceId }) as {
    blocked?: Array<{ device_id: string; user_id: string; blocked_at: string }>;
  };
  return (data.blocked ?? []).map(b => ({ deviceId: b.device_id, userId: b.user_id, blockedAt: b.blocked_at }));
}

/** Report a specific message for abuse. Does not block — the UI offers
 *  "report and block" as a combined action by calling both. */
export async function reportMessage(
  deviceId: string, messageId: number, reason: DMReportReason,
): Promise<void> {
  await mobilePost('report-message', { device_id: deviceId, message_id: messageId, reason });
}

/** Mark a received direct message as read. */
export async function markMessageRead(deviceId: string, messageId: number): Promise<void> {
  await mobilePost('mark-message-read', { device_id: deviceId, message_id: messageId });
}

/** Soft-delete one message from this device's inbox only (v0.9.35). */
export async function deleteMessage(deviceId: string, messageId: number): Promise<void> {
  await mobilePost('delete-message', { device_id: deviceId, message_id: messageId });
}

/** Soft-delete a whole thread (by peer RealGram ID) from this device only. */
export async function deleteThread(deviceId: string, peer: string): Promise<void> {
  await mobilePost('delete-thread', { device_id: deviceId, peer });
}

export interface ReferralResult {
  /** 'approved' = bonus granted now; 'pending_review' = held for anti-fraud
   *  review, bonus_bytes is 0 and may be granted later by an admin. */
  status?: 'approved' | 'pending_review';
  bonus_bytes: number;
  new_total_bytes: number;
}

export async function useReferral(deviceId: string, referralCode: string): Promise<ReferralResult> {
  const data = await mobilePost('use-referral', { device_id: deviceId, referral_code: referralCode });
  return data as ReferralResult;
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

// ── Quota economy (v0.9.31) ───────────────────────────────────────────────────

/** Minimum transferable amount, in bytes (100 MiB). Mirrors QE_MIN_TRANSFER. */
export const MIN_TRANSFER_BYTES = 104857600;

/** Server-side quota ledger breakdown + milestone progress + purchased packages. */
export async function getQuotaSummary(deviceId: string): Promise<QuotaSummaryResponse> {
  const data = await mobileGet('quota-summary', { device_id: deviceId });
  return data as QuotaSummaryResponse;
}

export async function getPackages(deviceId: string): Promise<PurchasedPackage[]> {
  const data = await mobileGet('get-packages', { device_id: deviceId }) as { packages?: PurchasedPackage[] };
  return data.packages ?? [];
}

export async function getTransfers(deviceId: string): Promise<TransferRecord[]> {
  const data = await mobileGet('get-transfers', { device_id: deviceId }) as { transfers?: TransferRecord[] };
  return data.transfers ?? [];
}

/** Resolve a recipient (device_id | user_id | referral_code) before transferring. */
export async function resolveRecipient(recipient: string): Promise<TransferRecipient> {
  const data = await mobileGet('resolve-recipient', { recipient });
  return data as TransferRecipient;
}

/** Send quota to another device. Atomic + audited server-side. */
export async function transferQuota(
  deviceId: string, recipient: string, bytes: number,
): Promise<TransferResult> {
  const data = await mobilePost('transfer-quota', { device_id: deviceId, recipient, bytes });
  return data as TransferResult;
}

export async function reportSessionEnd(
  deviceId:     string,
  protocol:     string,
  bytesSent:    number,
  bytesRecv:    number,
  durationSecs: number,
  probeResult:  'ok' | 'fail' | 'unknown' = 'unknown',
  errorReason   = '',
  sessionId     = '',
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
    session_id:    sessionId,
  });
}

/** Stamina/energy pool upgrade tiers (Khabat, 2026-07-31: "1k...2k, 3k, 5k
 *  osv, fibonacci sekvensen"). Server-persisted (devices.energy_tier,
 *  api.php 'get-energy-tier'/'upgrade-energy-tier') so it survives a
 *  reinstall — see lib/real_economy.php's ENERGY_TIERS for pool sizes and
 *  the (explicitly flagged, not-yet-reviewed) proposed REAL prices. */
export interface EnergyTierDef { pool: number; cost_real: number }
export interface EnergyTierStatus { tier: number; tiers: EnergyTierDef[] }

export async function getEnergyTier(deviceId: string): Promise<EnergyTierStatus> {
  const data = await mobileGet('get-energy-tier', { device_id: deviceId });
  return data as EnergyTierStatus;
}

export type EnergyUpgradeResult =
  | { ok: true; tier: number; pool: number; balance: number | null }
  | { ok: false; error: string };

export async function upgradeEnergyTier(deviceId: string, clientRef: string): Promise<EnergyUpgradeResult> {
  try {
    const data = await mobilePost('upgrade-energy-tier', { device_id: deviceId, client_ref: clientRef }) as
      { tier: number; pool: number; balance: number | null };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

/** Global chat — one shared room every user can post in (Khabat, 2026-07-31:
 *  "en social chat der alle brukere av realgram kan skrive i men
 *  begrensning på antall meldinger pr minut"). Server-enforced rate limit
 *  (lib/globalChat.php: 3/min, 100/day per device) — this is NOT just a
 *  client-side throttle, since that would be trivially bypassable. */
export interface GlobalChatMessage {
  id: number;
  device_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

export type SendGlobalMessageResult =
  | { ok: true; message: GlobalChatMessage }
  | { ok: false; error: string };

export async function sendGlobalMessage(deviceId: string, displayName: string, body: string): Promise<SendGlobalMessageResult> {
  try {
    const data = await mobilePost('send-global-message', { device_id: deviceId, display_name: displayName, body }) as
      { message: GlobalChatMessage };
    return { ok: true, message: data.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network_error' };
  }
}

/** Newest-first, same convention as the raw DB query — caller reverses for display. */
export async function getGlobalMessages(limit = 50, beforeId?: number): Promise<GlobalChatMessage[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (beforeId != null) params.before_id = String(beforeId);
  const data = await mobileGet('get-global-messages', params) as { messages: GlobalChatMessage[] };
  return data.messages ?? [];
}
