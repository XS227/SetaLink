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
import { getLastConnectProbeOk }  from './vpnBridge';
import { recordSuccess, recordFailure, sortByHistory, getTopProfiles } from './successHistory';
import { getRemoteConfig, isKillSwitched, invalidateRemoteConfig } from './remoteConfigService';
import { getSpoofSnisSync, prefetchBundle } from './profileBundleService';

// Kick off bundle prefetch at import time (non-blocking)
prefetchBundle();

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutoPhase =
  | 'idle'
  | 'testing'
  | 'probe-validated'
  | 'tcp-only'
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
  status:      'pending' | 'testing' | 'success' | 'tcp-only' | 'fail' | 'skipped';
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

const ADMIN_REPORT_URL   = 'https://admin.setalink.no/api.php?mobile=1';
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

type ProfileDef = Omit<AutoProfile, 'configJson' | 'status'>;

export function buildAutoProfiles(
  server: VpnServer,
  creds:  ServerCredentials,
  mode:   'auto' | 'iran',
  sniPriorities?: string[],
): ProfileDef[] {
  const addr     = creds.address || `${server.id}.setalink.net`;
  // Edge host is the nginx proxy used for WebSocket/XHTTP transports.
  // Falls back to deriving from VPN address if not explicitly set.
  const edgeAddr = creds.edgeAddress || addr;
  const baseFlow = creds.flow;
  const baseFp   = creds.fingerprint || 'chrome';
  const basePort = creds.port;

  const reality = (
    id: string, label: string, sni: string,
    { fp = baseFp, flow = baseFlow, port = basePort } = {},
  ): ProfileDef => ({
    id, label,
    protocol: 'VLESS + Reality',
    sni, port, flow, fingerprint: fp,
    emergency: false,
  });

  // TLS transport profiles (WebSocket / XHTTP / HTTPUpgrade) go through the nginx
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

  if (mode === 'iran') {
    // Build ordered SNI list from remote config or static default
    const iranSnis = sniPriorities ?? [
      'www.microsoft.com', 'www.bing.com', 'www.apple.com', 'www.samsung.com', 'www.speedtest.net',
    ];

    const profiles: ProfileDef[] = [
      // Priority 1-2: top SNI on both 443 and current port
      reality('iran-sni0-443',  `Reality · ${iranSnis[0]} · 443`,         iranSnis[0]!, { port: 443 }),
      reality('iran-sni0-port', `Reality · ${iranSnis[0]} · ${basePort}`, iranSnis[0]!),
    ];

    // Remaining SNIs from priority list
    for (let i = 1; i < Math.min(iranSnis.length, 5); i++) {
      const sni = iranSnis[i]!;
      const fp  = sni.includes('apple') ? 'safari' : baseFp;
      profiles.push(reality(`iran-sni${i}`, `Reality · ${sni}`, sni, { fp }));
    }

    // Speedtest with no flow (broader compat)
    if (!iranSnis.includes('www.speedtest.net')) {
      profiles.push(reality('iran-speedtest', 'Reality · speedtest.net', 'www.speedtest.net', { flow: '' }));
    }

    // SNI Spoof profiles — Reality with alternative fake SNIs (stealth mode)
    // These work because Reality server accepts ANY SNI via x25519 authentication.
    // DPI sees traffic to "auth.vercel.com" and does not block it.
    const spoofSnis = getSpoofSnisSync();
    for (let i = 0; i < Math.min(spoofSnis.length, 4); i++) {
      const sni = spoofSnis[i]!;
      profiles.push(reality(`iran-spoof${i}`, `Stealth · ${sni}`, sni, { flow: baseFlow }));
    }

    // TLS transports
    profiles.push(tls('iran-xhttp', 'VLESS + XHTTP · 443',     'VLESS+XHTTP'));
    profiles.push(tls('iran-ws',    'VLESS + WebSocket · 443',  'VLESS + WebSocket'));

    // Emergency
    profiles.push(emergency('iran-emrg', 'Emergency · IPv4+MTU1280', iranSnis[0]!));
    return profiles;
  }

  // Auto Mode — ordered by remote SNI priorities
  const autoSnis = sniPriorities ?? [
    'www.microsoft.com', 'www.apple.com', 'www.bing.com', 'www.samsung.com', 'www.speedtest.net',
  ];

  const profiles: ProfileDef[] = [
    reality('auto-current', 'Reality · current config', creds.sni || autoSnis[0]!),
  ];

  for (let i = 0; i < Math.min(autoSnis.length, 5); i++) {
    const sni = autoSnis[i]!;
    if (sni === creds.sni) continue; // already added as auto-current
    const fp = sni.includes('apple') ? 'safari' : baseFp;
    profiles.push(reality(`auto-sni${i}`, `Reality · ${sni}`, sni, { fp }));
  }

  // SNI Spoof profiles for auto mode (stealth fallback)
  const autoSpoofSnis = getSpoofSnisSync();
  for (let i = 0; i < Math.min(autoSpoofSnis.length, 3); i++) {
    const sni = autoSpoofSnis[i]!;
    profiles.push(reality(`auto-spoof${i}`, `Stealth · ${sni}`, sni, { flow: baseFlow }));
  }

  profiles.push(tls('auto-xhttp', 'VLESS + XHTTP · 443',    'VLESS+XHTTP'));
  profiles.push(tls('auto-ws',    'VLESS + WebSocket · 443', 'VLESS + WebSocket'));
  profiles.push(emergency('auto-emrg', 'Emergency · IPv4+MTU1280', creds.sni || autoSnis[0]!));
  return profiles;
}

function buildConfig(def: ProfileDef, server: VpnServer, creds: ServerCredentials): string {
  const patched: ServerCredentials = {
    ...creds, sni: def.sni, port: def.port, flow: def.flow, fingerprint: def.fingerprint,
  };
  const protoKey =
    def.protocol.includes('XHTTP')     ? 'VLESS+XHTTP'  :
    def.protocol.includes('WebSocket') ? 'WebSocket'     :
    def.protocol.includes('Reality')   ? 'Reality'       : 'Reality';

  return def.emergency
    ? buildEmergencyXrayConfigJson(server, protoKey, patched)
    : buildXrayConfigJson(server, protoKey, 'Cloudflare (DoH)', patched);
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

  const defs = buildAutoProfiles(server, creds, mode, sniPriorities);

  // Apply kill-switches: skip profiles that are known broken
  const filteredDefs = defs.filter(d => !isKillSwitched(d.sni, d.protocol, remoteCfg));

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

      const probeOk = getLastConnectProbeOk();
      p.latencyMs   = Date.now() - t0;
      p.testedAt    = Date.now();
      p.probeOk     = probeOk;

      if (probeOk) {
        // Probe-validated: real HTTP/HTTPS data confirmed through tunnel.
        p.status      = 'success';
        probeWinnerId  = p.id;
        probeWinnerCfg = p.configJson;
        recordSuccess(p.id, p.latencyMs, p.sni, p.protocol);
        onUpdate({
          phase: 'probe-validated', profileIndex: i,
          profileCount: profiles.length, profileLabel: p.label, retryCount,
        }, [...profiles]);
        break;
      }

      // probeOk=false: TCP established but no internet data confirmed.
      // This tunnel does NOT deliver real internet access. Do NOT accept it.
      // Disconnect and try the next profile.
      p.status = 'tcp-only';
      recordFailure(p.id, p.sni, p.protocol);
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
      // Distinguish "TCP ok but probe failed" from hard Xray/config failures.
      p.status = errMsg.includes('TCP OK') ? 'tcp-only' : 'fail';
      p.error  = errMsg;
      recordFailure(p.id, p.sni, p.protocol);
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

  // No profile delivered confirmed internet access.
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

      const body = new URLSearchParams({
        _token:          MOBILE_TOKEN,
        country:         'unknown',
        network:         'unknown',
        server:          serverId,
        port:            String(p.port),
        protocol:        p.protocol,
        sni:             p.sni,
        flow:            p.flow,
        fingerprint:     p.fingerprint,
        result:          p.status === 'success' ? 'success'
                       : p.status === 'tcp-only' ? 'tcp_only' : 'fail',
        error_msg:       p.error ?? '',
        tcp_ok:          p.status !== 'fail' ? '1' : '0',
        http_ok:         p.probeOk ? '1' : '0',
        latency_ms:      String(p.latencyMs ?? 0),
        is_winner:       p.id === result.winnerId ? '1' : '0',
        tested_by:       'auto-connector-v2',
        mode,
        emergency:       p.emergency ? '1' : '0',
        device_model:    device?.model ?? 'unknown',
        android_version: device?.androidRelease ?? '',
        android_sdk:     String(device?.androidSdk ?? 0),
        ipv6_enabled:    '0',  // IPv6 is now disabled in TUN (Phase 1 fix)
        mtu:             p.emergency ? '1280' : '1400',
        reconnect_count: String(result.retryCount),
        no_internet:     (p.status === 'tcp-only' && !p.probeOk) ? '1' : '0',
        fallback_chain:  topHistory,
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
