/**
 * Auto Mode connector — tests profiles in priority order, stays connected
 * on the first fully-validated success, and retries forever in autonomous mode.
 *
 * Priority is determined by:
 *   1. Remote config SNI priority list (dynamic, pushed from admin)
 *   2. Local success history (MMKV — profiles that worked before come first)
 *   3. Static fallback order per mode (auto / iran)
 *
 * Success requires probeOk=true — at least one HTTP or HTTPS response must
 * have been received through the tunnel. TCP-only (probe inconclusive) is
 * recorded as a failure and the next profile is tried. Only real internet
 * access marks a profile as the winner.
 *
 * Phase 5: runAutoConnectLoop() never gives up. It retries with back-off,
 * re-fetches remote config on each cycle, and re-sorts by history.
 */

import { Platform } from 'react-native';
import type { VpnAdapter }        from './vpnBridge';
import type { VpnServer }         from '../stores/vpnStore';
import type { ServerCredentials } from './serverConfigService';
import { buildXrayConfigJson, buildEmergencyXrayConfigJson } from './xrayConfigBuilder';
import { getLastConnectProbeOk, getLastConnectFailureCategory } from './vpnBridge';
import { recordSuccess, recordFailure, sortByHistory, getTopProfiles } from './successHistory';
import { getRemoteConfig, isKillSwitched, invalidateRemoteConfig } from './remoteConfigService';
import { prefetchBundle } from './profileBundleService';
import { getSelectedAppBypassDomains } from './iranBypassRules';
import { uploadConnectTelemetry }              from './api/telemetry.api';
import type { TelemetryEvent, ConnectTelemetryPayload } from './api/telemetry.api';
import { APP_VERSION, APP_BUILD_CODE } from '../utils/version';

// Kick off bundle prefetch at import time (non-blocking)
prefetchBundle();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutoPhase =
  | 'idle'
  | 'testing'
  | 'probe-validated'
  | 'failed'
  | 'retrying';

export interface AutoProfile {
  id:          string;
  label:       string;
  protocol:    string;
  sni:         string;
  port:        number;
  flow:        string;
  fingerprint: string;
  emergency:   boolean;
  configJson:  string;
  status:      'pending' | 'testing' | 'success' | 'fail' | 'skipped';
  failureCategory?: string;
  latencyMs?:  number;
  error?:      string;
  probeOk?:    boolean;
  testedAt?:   number;
}

export interface AutoConnectStatus {
  phase:        AutoPhase;
  profileIndex: number;
  profileCount: number;
  profileLabel: string;
  retryCount?:  number;
  error?:       string;
}

export interface AutoConnectResult {
  success:      boolean;
  probeOk:      boolean;
  profiles:     AutoProfile[];
  winnerId:     string | null;
  winnerConfig: string | null;
  durationMs:   number;
  ranAt:        number;
  retryCount:   number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// admin.setalink.no has no DNS record → these best-effort diagnostics POSTs used
// to always fail. Point at setalink.no/api.php (the live backend we control).
const ADMIN_REPORT_URL   = 'https://setalink.no/api.php?mobile=1';
const MOBILE_TOKEN       = 'setalink-mobile-diag-v1';
// Increased to 120s: HTTPS probe (12s × 4 hosts) + HTTP probe (10s × 3 hosts) + tunnel setup.
// Validation now runs HTTPS first (for Vision), then HTTP — worst-case ~90s total.
const CONNECT_TIMEOUT_MS = 120_000;
const BETWEEN_ATTEMPTS_MS = 700;

// Autonomous retry back-off: 5s, 10s, 20s, 40s, 60s (capped)
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

// ── Device info cache ─────────────────────────────────────────────────────────

let _deviceInfo: { model: string; androidRelease: string; androidSdk: number } | null = null;

async function getDeviceInfo(): Promise<typeof _deviceInfo> {
  if (_deviceInfo) return _deviceInfo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
    if (mod?.getDeviceInfo) {
      _deviceInfo = await mod.getDeviceInfo();
      return _deviceInfo;
    }
  } catch {}
  _deviceInfo = {
    model:          'unknown',
    androidRelease: String(Platform.Version),
    androidSdk:     typeof Platform.Version === 'number' ? Platform.Version : 0,
  };
  return _deviceInfo;
}

// ── Profile builders ──────────────────────────────────────────────────────────

// credOverride: per-profile Reality credential overrides for multi-keypair setups
// (e.g. Hetzner Oracle :8443 has a different uuid/publicKey/shortId than Cloudflare :443).
type ProfileDef = Omit<AutoProfile, 'configJson' | 'status'> & {
  credOverride?: {
    uuid:      string;
    publicKey: string;
    shortId:   string;
    address?:  string;
  };
};

export function buildAutoProfiles(
  server: VpnServer,
  creds:  ServerCredentials,
  mode:   'auto' | 'iran',
  sniPriorities?: string[],
): ProfileDef[] {
  const addr     = creds.address || `${server.id}.setalink.no`;
  // Edge host is the nginx proxy used for WebSocket/XHTTP transports.
  // Falls back to deriving from VPN address if not explicitly set.
  const edgeAddr = creds.edgeAddress || addr;
  const baseFlow = creds.flow;
  const baseFp   = creds.fingerprint || 'chrome';
  const basePort = creds.port;
  const p        = mode === 'iran' ? 'iran' : 'auto';

  const reality = (
    id: string, label: string, sni: string,
    { fp = baseFp, flow = baseFlow, port = basePort } = {},
  ): ProfileDef => ({
    id, label,
    protocol: 'VLESS + Reality',
    sni, port, flow, fingerprint: fp,
    emergency: false,
  });

  // TLS transport profiles (XHTTP / WebSocket / HTTPUpgrade) go through the nginx
  // edge proxy, not the Reality port. Use edgeAddr and port 443 for the SNI.
  const tls = (id: string, label: string, protocol: string, port = 443): ProfileDef => ({
    id, label, protocol,
    sni: edgeAddr, port, flow: '', fingerprint: 'chrome',
    emergency: false,
  });

  const emergency = (id: string, label: string, sni: string): ProfileDef => ({
    id, label,
    protocol:    'VLESS + Reality',
    sni, port: basePort, flow: baseFlow, fingerprint: baseFp,
    emergency: true,
  });

  // A Reality node only accepts the SNIs in its own serverNames list; any other
  // SNI fails the handshake. Every failed attempt costs up to ~90 s of probing
  // (see CONNECT_TIMEOUT_MS), so candidates the node can actually accept go first:
  //   1. the node's altProfiles (self-steal SNIs such as static.setai.no, whose
  //      DNS, IP and certificate all match, so DPI has nothing to flag)
  //   2. the node's own primary SNI
  //   3. the CDN edge transports (a different network path entirely)
  //   4. at most two SNIs from the remote priority list, as a last resort
  // The old "spoof" SNIs are gone: no node lists them, so they always failed.
  const profiles: ProfileDef[] = [];

  (creds.altProfiles ?? []).forEach((alt, i) => {
    const shortName = alt.sni.replace(/^www\./, '').split('.')[0] ?? alt.sni;
    profiles.push({
      id:          `${p}-alt-reality-${alt.port}-${i}`,
      label:       `Reality · ${shortName} · :${alt.port}`,
      protocol:    'VLESS + Reality',
      sni:         alt.sni,
      port:        alt.port,
      flow:        alt.flow        ?? '',
      fingerprint: alt.fingerprint ?? baseFp,
      emergency:   false,
      credOverride: {
        uuid:      alt.uuid,
        publicKey: alt.publicKey,
        shortId:   alt.shortId,
        address:   alt.address || addr,
      },
    });
  });

  const fallbackSnis = sniPriorities ?? [
    'www.microsoft.com', 'www.bing.com', 'www.apple.com', 'www.samsung.com', 'www.speedtest.net',
  ];
  const nodeSni = creds.sni || fallbackSnis[0]!;
  profiles.push(reality(`${p}-current`, `Reality · ${nodeSni}`, nodeSni));

  profiles.push(tls(`${p}-xhttp`,  'VLESS + XHTTP · 443',      'VLESS+XHTTP'));
  profiles.push(tls(`${p}-ws`,     'VLESS + WebSocket · 443',  'VLESS + WebSocket'));
  profiles.push(tls(`${p}-httpup`, 'VLESS + HTTPUpgrade · 443', 'VLESS+HTTPUpgrade'));

  const extra = fallbackSnis.filter(s => s !== nodeSni).slice(0, 2);
  extra.forEach((sni, i) => {
    const fp = sni.includes('apple') ? 'safari' : baseFp;
    profiles.push(reality(`${p}-sni${i}`, `Reality · ${sni}`, sni, { fp }));
  });

  profiles.push(emergency(`${p}-emrg`, 'Emergency · IPv4+MTU1280', nodeSni));
  return profiles;
}

// ── Admin-pushed live profiles (remote config) ───────────────────────────────
// Profiles pushed via admin "push-emergency-profiles" / "push-stealth-profiles"
// become connectable WITHOUT an APK update. They carry full credentials
// (uuid/publicKey/shortId/address), applied per-profile via credOverride.
// Emergency profiles are tried FIRST (admin pushes them when the defaults are
// burned); stealth profiles slot in after the built-in Reality candidates.

interface RemoteProfileJson {
  id?:          string;
  label?:       string;
  protocol?:    string;   // 'Reality' | 'WebSocket' | 'XHTTP' | 'HTTPUpgrade'
  uuid?:        string;
  address?:     string;
  port?:        number;
  publicKey?:   string;
  shortId?:     string;
  sni?:         string;
  flow?:        string;
  fingerprint?: string;
  emergency?:   boolean;
}

export function buildRemoteProfiles(
  raw:    unknown[] | undefined,
  prefix: string,
): ProfileDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileDef[] = [];
  raw.forEach((entry, i) => {
    const p = entry as RemoteProfileJson;
    if (!p || !p.uuid || !p.sni) return;          // not connectable without these
    const protoRaw = (p.protocol ?? 'Reality').toLowerCase();
    const protocol =
      protoRaw.includes('xhttp')       ? 'VLESS+XHTTP'        :
      protoRaw.includes('websocket') ||
      protoRaw.includes('ws')          ? 'VLESS + WebSocket'  :
      protoRaw.includes('httpup')      ? 'VLESS+HTTPUpgrade'  :
                                         'VLESS + Reality';
    out.push({
      id:          p.id ?? `${prefix}-${i}`,
      label:       p.label ?? `${prefix === 'rc-emrg' ? 'Emergency' : 'Stealth'} · ${p.sni}`,
      protocol,
      sni:         p.sni,
      port:        p.port ?? 443,
      flow:        p.flow ?? '',
      fingerprint: p.fingerprint ?? 'chrome',
      emergency:   p.emergency ?? false,
      ...(p.publicKey && p.shortId ? {
        credOverride: {
          uuid:      p.uuid,
          publicKey: p.publicKey,
          shortId:   p.shortId,
          ...(p.address ? { address: p.address } : {}),
        },
      } : {}),
    });
  });
  return out;
}

function buildConfig(def: ProfileDef, server: VpnServer, creds: ServerCredentials): string {
  const isTls =
    def.protocol.includes('XHTTP') ||
    def.protocol.includes('WebSocket') ||
    def.protocol.includes('HTTPUpgrade');

  const patched: ServerCredentials = {
    ...creds,
    sni:         def.sni,
    port:        def.port,
    flow:        def.flow,
    fingerprint: def.fingerprint,
    // For TLS transport profiles the SNI is the edge proxy host — ensure edgeAddress
    // matches so buildVlessXhttpOutbound/WsOutbound don't fall back to the Reality IP.
    ...(isTls ? { edgeAddress: def.sni } : {}),
    // credOverride: per-profile keypair override for multi-inbound Reality setups.
    // Applied last so it wins over all base creds (uuid/publicKey/shortId/address).
    ...(def.credOverride ?? {}),
  };
  const protoKey =
    def.protocol.includes('XHTTP')        ? 'VLESS+XHTTP'       :
    def.protocol.includes('WebSocket')    ? 'WebSocket'          :
    def.protocol.includes('HTTPUpgrade')  ? 'VLESS+HTTPUpgrade'  :
    def.protocol.includes('Reality')      ? 'Reality'            : 'Reality';

  return def.emergency
    ? buildEmergencyXrayConfigJson(server, protoKey, patched)
    : buildXrayConfigJson(server, protoKey, 'Cloudflare (DoH)', patched,
        { smartBypass: _smartModeOn(), extraBypassDomains: getSelectedAppBypassDomains() });
}

// Smart Mode / Iran Bypass state — read defensively so a store hiccup can
// never break the auto-connect path (mirrors the vpnStore dnsMode pattern).
function _smartModeOn(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSettingsStore } = require('../stores/settingsStore') as typeof import('../stores/settingsStore');
    return useSettingsStore.getState().smartMode === true;
  } catch {
    return false;
  }
}

function winningInbound(protocol: string): string {
  if (protocol.includes('XHTTP'))       return 'inbound-xhttp';
  if (protocol.includes('WebSocket'))   return 'inbound-ws';
  if (protocol.includes('HTTPUpgrade')) return 'inbound-httpup';
  if (protocol.includes('Reality'))     return 'inbound-reality';
  return 'unknown';
}

// ── Single pass runner ────────────────────────────────────────────────────────

export async function runAutoConnect(
  server:   VpnServer,
  creds:    ServerCredentials,
  adapter:  VpnAdapter,
  mode:     'auto' | 'iran',
  onUpdate: (status: AutoConnectStatus, profiles: AutoProfile[]) => void,
): Promise<AutoConnectResult> {
  return _runPass(server, creds, adapter, mode, onUpdate, 0);
}

// ── Autonomous retry loop (Phase 5) ──────────────────────────────────────────

/**
 * Runs runAutoConnect in an infinite retry loop.
 * Invalidates remote config and re-sorts by history on each cycle.
 * Calls onUpdate with phase='retrying' between cycles.
 * Stops when:
 *   - A profile succeeds (returns result)
 *   - cancel() is called (returns last failure result)
 */
export function runAutoConnectLoop(
  server:   VpnServer,
  creds:    ServerCredentials,
  adapter:  VpnAdapter,
  mode:     'auto' | 'iran',
  onUpdate: (status: AutoConnectStatus, profiles: AutoProfile[]) => void,
): { promise: Promise<AutoConnectResult>; cancel: () => void } {
  let cancelled = false;
  let lastResult: AutoConnectResult | null = null;

  const promise = (async () => {
    let retryCount = 0;

    while (!cancelled) {
      // Invalidate remote config after first failure so we re-fetch fresh priorities
      if (retryCount > 0) invalidateRemoteConfig();

      const result = await _runPass(server, creds, adapter, mode, onUpdate, retryCount);
      lastResult = result;

      if (result.success || cancelled) return result;

      retryCount++;
      const delayMs = RETRY_DELAYS_MS[Math.min(retryCount - 1, RETRY_DELAYS_MS.length - 1)]!;
      const retryIn = Math.round(delayMs / 1000);

      const retryMsg = `All profiles failed — retrying in ${retryIn}s (attempt ${retryCount + 1})`;
      onUpdate({
        phase: 'retrying',
        profileIndex: 0,
        profileCount: result.profiles.length,
        profileLabel: retryMsg,
        retryCount,
        error: retryMsg,
      }, result.profiles);

      await sleep(delayMs);
    }

    return lastResult ?? {
      success: false, probeOk: false, profiles: [],
      winnerId: null, winnerConfig: null,
      durationMs: 0, ranAt: Date.now(), retryCount: 0,
    };
  })();

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
}

// ── Internal: single pass ─────────────────────────────────────────────────────

async function _runPass(
  server:     VpnServer,
  creds:      ServerCredentials,
  adapter:    VpnAdapter,
  mode:       'auto' | 'iran',
  onUpdate:   (status: AutoConnectStatus, profiles: AutoProfile[]) => void,
  retryCount: number,
): Promise<AutoConnectResult> {
  const ranAt = Date.now();

  // Fetch remote config to get current SNI priority list and kill-switches
  const remoteCfg = await getRemoteConfig();
  const sniPriorities = mode === 'iran'
    ? remoteCfg.iran_sni_order
    : remoteCfg.sni_priorities;

  const builtinDefs = buildAutoProfiles(server, creds, mode, sniPriorities);

  // Admin-pushed live profiles: emergency first (pushed when defaults are
  // burned — must win), stealth after the built-ins as extra candidates.
  const rcEmergency = buildRemoteProfiles(remoteCfg.emergency_profiles, 'rc-emrg');
  const rcStealth   = buildRemoteProfiles(remoteCfg.stealth_profiles,   'rc-stealth');
  const defs = [...rcEmergency, ...builtinDefs, ...rcStealth];

  // Apply kill-switches and disabled-node list: skip profiles that are known broken
  const nodesDisabled = remoteCfg.nodes_disabled ?? [];
  const filteredDefs = defs.filter(d =>
    !isKillSwitched(d.sni, d.protocol, remoteCfg) &&
    !nodesDisabled.includes(server.id),
  );

  // Sort by historical success (puts previously successful profiles first)
  const profileIds = filteredDefs.map(d => d.id);
  const sortedIds  = sortByHistory(profileIds);
  const sortedDefs = [
    ...sortedIds.map(id => filteredDefs.find(d => d.id === id)!).filter(Boolean),
    ...filteredDefs.filter(d => !sortedIds.includes(d.id)),
  ];

  const profiles: AutoProfile[] = sortedDefs.map(d => ({
    ...d,
    configJson: buildConfig(d, server, creds),
    status:     'pending' as const,
  }));

  onUpdate({
    phase: 'testing', profileIndex: 0,
    profileCount: profiles.length, profileLabel: profiles[0]?.label ?? '',
    retryCount,
  }, [...profiles]);

  const telemetryEnabled = remoteCfg.telemetry_enabled !== false;
  let probeWinnerId:  string | null = null;
  let probeWinnerCfg: string | null = null;

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i]!;

    if (probeWinnerId) {
      p.status = 'skipped';
      continue;
    }

    p.status = 'testing';
    onUpdate({
      phase: 'testing', profileIndex: i,
      profileCount: profiles.length, profileLabel: p.label, retryCount,
    }, [...profiles]);

    const t0 = Date.now();
    try {
      await Promise.race([
        p.emergency ? adapter.connectEmergency(p.configJson) : adapter.connect(p.configJson),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS)
        ),
      ]);

      const probeOk         = getLastConnectProbeOk();
      const failureCategory = getLastConnectFailureCategory();
      p.latencyMs   = Date.now() - t0;
      p.testedAt    = Date.now();
      p.probeOk     = probeOk;

      if (probeOk) {
        // HTTP/HTTPS confirmed through tunnel — definitive winner.
        p.status      = 'success';
        probeWinnerId  = p.id;
        probeWinnerCfg = p.configJson;
        recordSuccess(p.id, p.latencyMs, p.sni, p.protocol);
        _reportTelemetry(p, server.id, telemetryEnabled);
        onUpdate({
          phase: 'probe-validated', profileIndex: i,
          profileCount: profiles.length, profileLabel: p.label, retryCount,
        }, [...profiles]);
        break;
      }

      // HTTP/HTTPS probe did not confirm internet — stop this profile and try next.
      // TCP-only is NOT accepted as success: a tunnel that cannot route real HTTP
      // traffic may be serving stale SOCKS5 or have misconfigured transport settings.
      p.status          = 'fail';
      p.error           = `No internet through tunnel [${failureCategory}]`;
      // Never leave the category empty — the native layer reports '' when it has
      // no detail, which used to upload as NULL failure_stage/error_category.
      p.failureCategory = failureCategory || 'probe_no_internet';
      recordFailure(p.id, p.sni, p.protocol);
      _reportTelemetry(p, server.id, telemetryEnabled);
      try { await adapter.disconnect(); } catch {}
      await sleep(BETWEEN_ATTEMPTS_MS);
      onUpdate({
        phase: 'testing', profileIndex: i + 1,
        profileCount: profiles.length,
        profileLabel: profiles[i + 1]?.label ?? '', retryCount,
      }, [...profiles]);

    } catch (e: unknown) {
      p.latencyMs = Date.now() - t0;
      p.testedAt  = Date.now();
      const errMsg = e instanceof Error ? e.message : String(e);
      p.status = 'fail';
      p.error  = errMsg;
      // This path (timeout / native connect exception) previously never set
      // failureCategory, so most connect_fail rows uploaded with NULL stage.
      const lower = errMsg.toLowerCase();
      p.failureCategory =
        lower.includes('timeout')                                  ? 'timeout' :
        lower.includes('refused') || lower.includes('unreachable') ? 'server_unreachable' :
        lower.includes('permission') || lower.includes('prepare')  ? 'vpn_permission' :
        'connect_exception';
      recordFailure(p.id, p.sni, p.protocol);
      _reportTelemetry(p, server.id, telemetryEnabled);
      try { await adapter.disconnect(); } catch {}
      await sleep(BETWEEN_ATTEMPTS_MS);
      onUpdate({
        phase: 'testing', profileIndex: i + 1,
        profileCount: profiles.length,
        profileLabel: profiles[i + 1]?.label ?? '', retryCount,
      }, [...profiles]);
    }
  }

  if (probeWinnerId) {
    const result: AutoConnectResult = {
      success: true, probeOk: true, profiles,
      winnerId: probeWinnerId, winnerConfig: probeWinnerCfg,
      durationMs: Date.now() - ranAt, ranAt, retryCount,
    };
    reportToAdmin(result, server.id, mode).catch(() => {});
    return result;
  }

  // All profiles failed HTTP/HTTPS validation — genuine connectivity failure.
  // TCP-only success is NOT accepted: no internet through tunnel = not connected.
  onUpdate({
    phase: 'failed', profileIndex: profiles.length,
    profileCount: profiles.length, profileLabel: '', retryCount,
  }, profiles);

  const result: AutoConnectResult = {
    success:      false,
    probeOk:      false,
    profiles,
    winnerId:     null,
    winnerConfig: null,
    durationMs:   Date.now() - ranAt,
    ranAt,
    retryCount,
  };
  reportToAdmin(result, server.id, mode).catch(() => {});
  return result;
}

// ── Node-intelligence telemetry (Phase 6) ────────────────────────────────────
// Uploads anonymous connect outcomes to /v1/telemetry/connect.
// Fire-and-forget: never throws; never blocks the user flow.

function profileTelemetryEvent(p: AutoProfile): TelemetryEvent {
  if (p.status === 'success') return 'connect_ok';
  if (p.error?.startsWith('No internet through tunnel')) return 'internet_fail';
  return 'connect_fail';
}

function _reportTelemetry(
  p:       AutoProfile,
  nodeId:  string,
  telemetryEnabled: boolean,
): void {
  if (!telemetryEnabled) return;
  // Only upload tested profiles (skip pending/skipped — they have no data)
  if (p.status === 'pending' || p.status === 'skipped') return;

  let token: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAuthStore } = require('../stores/authStore');
    token = useAuthStore.getState().user?.deviceId
      ? `device-${useAuthStore.getState().user.deviceId}`
      : undefined;
  } catch {}

  // Map failureCategory to a structured error_category enum value
  const errorCat: ConnectTelemetryPayload['error_category'] =
    p.failureCategory?.includes('dns')         ? 'dns_failed'        :
    p.failureCategory?.includes('timeout')     ? 'server_unreachable':
    p.failureCategory?.includes('unreachable') ? 'server_unreachable':
    p.failureCategory?.includes('proxy')       ? 'proxy_not_ready'   :
    p.failureCategory?.includes('probe')       ? 'routing_failed'    :
    p.failureCategory?.includes('routing')     ? 'routing_failed'    :
    p.failureCategory === 'connect_exception'  ? 'unknown'           :
    p.failureCategory                          ? 'routing_failed'    : undefined;

  let carrier: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCachedCarrier } = require('./deviceIdentityService');
    carrier = getCachedCarrier() || undefined;
  } catch {}

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { noteAutoConnectorReport } = require('./sessionTelemetry');
    noteAutoConnectorReport();
  } catch {}
  uploadConnectTelemetry({
    event:             profileTelemetryEvent(p),
    node_id:           nodeId,
    profile_id:        p.id,
    sni:               p.sni,
    protocol:          p.protocol,
    carrier_name:      carrier,
    platform:          Platform.OS as 'android' | 'ios',
    app_version:       APP_VERSION,
    build_number:      APP_BUILD_CODE,
    failure_stage:     p.failureCategory ?? undefined,
    latency_ms:        p.latencyMs,
    internet_ok:       p.probeOk ?? false,
    time_to_connect_ms: p.latencyMs,
    error_category:    errorCat,
    // Extended diagnostics (Phase 7)
    ip_version:        'ipv4' as const, // Our servers are IPv4; Android native layer may override via getStats()
    rtt_ms:            p.latencyMs ? Math.round(p.latencyMs * 0.3) : undefined,
    // 30% of total connect latency approximates server RTT (rest is TLS + xray setup)
    // network_switched: set by Android native layer via XrayVpnService broadcast
  }, token);
}

// ── Admin telemetry reporting (Phase 2) ───────────────────────────────────────

async function reportToAdmin(
  result:   AutoConnectResult,
  serverId: string,
  mode:     string,
): Promise<void> {
  const device = await getDeviceInfo();
  const topHistory = getTopProfiles(3)
    .map(p => `${p.protocol}/${p.sni}@${Math.round(p.rate * 100)}%`)
    .join(';');

  try {
    for (const p of result.profiles) {
      if (p.status === 'pending' || p.status === 'skipped') continue;

      // Derive failure category from error message patterns when not set explicitly
      const rawCat = p.error ?? '';
      const failureCat =
        rawCat.includes('reality_clienthello') ? 'reality_clienthello_failed' :
        rawCat.includes('ws_upgrade')          ? 'ws_upgrade_failed'          :
        rawCat.includes('xhttp_path')          ? 'xhttp_path_mismatch'        :
        rawCat.includes('socks_probe')         ? 'socks_probe_timeout'        :
        rawCat.includes('dns_failed')          ? 'dns_failed'                 :
        rawCat.match(/\[([\w_]+)\]/)           ? rawCat.match(/\[([\w_]+)\]/)![1]! :
        p.status === 'fail'                    ? 'no_internet_routed'         : '';

      const body = new URLSearchParams({
        _token:           MOBILE_TOKEN,
        country:          'unknown',
        network:          'unknown',
        server:           serverId,
        port:             String(p.port),
        protocol:         p.protocol,
        sni:              p.sni,
        flow:             p.flow,
        fingerprint:      p.fingerprint,
        result:           p.status === 'success' ? 'success' : 'fail',
        error_msg:        p.error ?? '',
        failure_category: failureCat,
        tcp_ok:           p.status === 'success' ? '1' : '0',
        http_ok:          p.probeOk ? '1' : '0',
        latency_ms:       String(p.latencyMs ?? 0),
        is_winner:        p.id === result.winnerId ? '1' : '0',
        tested_by:        'auto-connector-v2',
        mode,
        emergency:        p.emergency ? '1' : '0',
        device_model:     device?.model ?? 'unknown',
        android_version:  device?.androidRelease ?? '',
        android_sdk:      String(device?.androidSdk ?? 0),
        ipv6_enabled:     '0',
        mtu:              p.emergency ? '1280' : '1400',
        reconnect_count:  String(result.retryCount),
        no_internet:      !p.probeOk ? '1' : '0',
        fallback_chain:   topHistory,
        winning_inbound: p.id === result.winnerId ? winningInbound(p.protocol) : '',
        notes: `AutoConnector v2 mode=${mode} total=${result.durationMs}ms probeOk=${result.probeOk} retry=${result.retryCount}`,
      });

      await Promise.race([
        fetch(ADMIN_REPORT_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    body.toString(),
        }),
        new Promise<void>((_, r) => setTimeout(() => r(new Error('timeout')), 4_000)),
      ]);
    }
  } catch { /* silent */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
