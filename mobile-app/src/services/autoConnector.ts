/**
 * Auto Mode connector — tests profiles in priority order and stays connected
 * on the first fully-validated success (HTTP/HTTPS probe through SOCKS5).
 *
 * Differs from connectionOptimizer, which disconnects every profile to rank them.
 * This service keeps the VPN connected after finding the first working profile
 * so the caller can hand off to the normal vpnStore connect flow.
 *
 * Priority order:
 *   Auto Mode  — current SNI → microsoft → apple → bing → speedtest → XHTTP → WS → Emergency
 *   Iran Mode  — microsoft 443 → microsoft port → bing → apple → samsung → speedtest → XHTTP → WS → Emergency
 *
 * "Success" tiers (in order of preference):
 *   1. probeOk=true  — HTTPS/HTTP probe confirmed real data through the tunnel
 *   2. probeOk=false — TCP-only (tunnel is up, probe inconclusive — still usable)
 *   3. fail          — Xray/config error or SOCKS5 unreachable
 */

import type { VpnAdapter }        from './vpnBridge';
import type { VpnServer }         from '../stores/vpnStore';
import type { ServerCredentials } from './serverConfigService';
import { buildXrayConfigJson, buildEmergencyXrayConfigJson } from './xrayConfigBuilder';
import { getLastConnectProbeOk }  from './vpnBridge';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutoPhase =
  | 'idle'
  | 'testing'
  | 'probe-validated'   // HTTPS/HTTP probe confirmed traffic
  | 'tcp-only'          // TCP works, probes inconclusive (still connected)
  | 'failed';

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
  error?:       string;
}

export interface AutoConnectResult {
  success:      boolean;            // true if any profile connected (probe or TCP-only)
  probeOk:      boolean;            // true only if the winner had a passing HTTP/HTTPS probe
  profiles:     AutoProfile[];
  winnerId:     string | null;
  winnerConfig: string | null;      // Xray JSON string to hand to vpnStore
  durationMs:   number;
  ranAt:        number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_REPORT_URL  = 'https://admin.setalink.no/api.php?mobile=1';
const MOBILE_TOKEN      = 'setalink-mobile-diag-v1';
// 70 s covers worst case: setup + all probes timing out (~56 s total)
const CONNECT_TIMEOUT_MS = 70_000;
const BETWEEN_ATTEMPTS_MS = 700;

// ── Profile builders ──────────────────────────────────────────────────────────

type ProfileDef = Omit<AutoProfile, 'configJson' | 'status'>;

export function buildAutoProfiles(
  server: VpnServer,
  creds:  ServerCredentials,
  mode:   'auto' | 'iran',
): ProfileDef[] {
  const addr = creds.address || `${server.id}.setalink.net`;
  const baseFlow = creds.flow;
  const baseFp   = creds.fingerprint || 'chrome';
  const basePort = creds.port;

  const reality = (
    id: string, label: string, sni: string,
    { fp = baseFp, flow = baseFlow, port = basePort } = {},
  ): ProfileDef => ({
    id, label,
    protocol:    'VLESS + Reality',
    sni, port, flow, fingerprint: fp,
    emergency:   false,
  });

  const tls = (id: string, label: string, protocol: string, port = 443): ProfileDef => ({
    id, label, protocol,
    sni: addr, port, flow: '', fingerprint: 'chrome',
    emergency: false,
  });

  const emergency = (id: string, label: string, sni: string): ProfileDef => ({
    id, label,
    protocol:    'VLESS + Reality',
    sni, port: basePort, flow: baseFlow, fingerprint: baseFp,
    emergency: true,
  });

  if (mode === 'iran') {
    return [
      // Priority 1-2: Microsoft SNI on both 443 and current port (confirmed working in Iran)
      reality('iran-ms-443',    'Reality · microsoft.com · 443',          'www.microsoft.com', { port: 443 }),
      reality('iran-ms-port',   'Reality · microsoft.com · current port', 'www.microsoft.com'),
      // Priority 3: Bing (Microsoft CDN — less DPI-targeted in Iran)
      reality('iran-bing',      'Reality · bing.com',                     'www.bing.com'),
      // Priority 4: Apple with Safari fingerprint (common iOS device signature)
      reality('iran-apple',     'Reality · apple.com',                    'www.apple.com',    { fp: 'safari' }),
      // Priority 5: Samsung (Android-native SNI — blends with device traffic)
      reality('iran-samsung',   'Reality · samsung.com',                  'www.samsung.com'),
      // Priority 6: Speedtest — no vision flow (broadest compatibility)
      reality('iran-speedtest', 'Reality · speedtest.net',                'www.speedtest.net', { flow: '' }),
      // Priority 7-8: TLS-based transports (bypass DPI that targets Reality handshake)
      tls('iran-xhttp',         'VLESS + XHTTP · 443',       'VLESS+XHTTP'),
      tls('iran-ws',            'VLESS + WebSocket · 443',   'VLESS + WebSocket'),
      // Priority 9: Emergency — IPv4 only, MTU 1280, no IPv6 routes
      emergency('iran-emrg',    'Emergency · IPv4+MTU1280',               'www.microsoft.com'),
    ];
  }

  // Auto Mode — tries current imported config first, then common fallbacks
  return [
    reality('auto-current',   'Reality · current config',     creds.sni || 'www.microsoft.com'),
    reality('auto-ms',        'Reality · microsoft.com',      'www.microsoft.com'),
    reality('auto-apple',     'Reality · apple.com',          'www.apple.com',    { fp: 'safari' }),
    reality('auto-bing',      'Reality · bing.com',           'www.bing.com'),
    reality('auto-speedtest', 'Reality · speedtest.net',      'www.speedtest.net', { flow: '' }),
    tls('auto-xhttp',         'VLESS + XHTTP · 443',          'VLESS+XHTTP'),
    tls('auto-ws',            'VLESS + WebSocket · 443',      'VLESS + WebSocket'),
    emergency('auto-emrg',    'Emergency · IPv4+MTU1280',     creds.sni || 'www.microsoft.com'),
  ];
}

function buildConfig(def: ProfileDef, server: VpnServer, creds: ServerCredentials): string {
  const patched: ServerCredentials = {
    ...creds,
    sni:         def.sni,
    port:        def.port,
    flow:        def.flow,
    fingerprint: def.fingerprint,
  };

  const protoKey =
    def.protocol.includes('XHTTP')     ? 'VLESS+XHTTP'       :
    def.protocol.includes('WebSocket') ? 'WebSocket'          :
    def.protocol.includes('Reality')   ? 'Reality'            : 'Reality';

  if (def.emergency) {
    return buildEmergencyXrayConfigJson(server, protoKey, patched);
  }
  return buildXrayConfigJson(server, protoKey, 'Cloudflare (DoH)', patched);
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runAutoConnect(
  server:   VpnServer,
  creds:    ServerCredentials,
  adapter:  VpnAdapter,
  mode:     'auto' | 'iran',
  onUpdate: (status: AutoConnectStatus, profiles: AutoProfile[]) => void,
): Promise<AutoConnectResult> {
  const ranAt = Date.now();
  const defs  = buildAutoProfiles(server, creds, mode);

  const profiles: AutoProfile[] = defs.map(d => ({
    ...d,
    configJson: buildConfig(d, server, creds),
    status:     'pending' as const,
  }));

  onUpdate({
    phase: 'testing', profileIndex: 0,
    profileCount: profiles.length, profileLabel: profiles[0]?.label ?? '',
  }, [...profiles]);

  let probeWinnerId:    string | null = null;
  let probeWinnerCfg:   string | null = null;
  let tcpOnlyWinnerId:  string | null = null;
  let tcpOnlyWinnerCfg: string | null = null;

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i]!;

    if (probeWinnerId) {
      p.status = 'skipped';
      continue;
    }

    p.status = 'testing';
    onUpdate({
      phase: 'testing', profileIndex: i,
      profileCount: profiles.length, profileLabel: p.label,
    }, [...profiles]);

    const t0 = Date.now();
    try {
      await Promise.race([
        p.emergency ? adapter.connectEmergency(p.configJson) : adapter.connect(p.configJson),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS)
        ),
      ]);

      const probeOk  = getLastConnectProbeOk();
      p.latencyMs    = Date.now() - t0;
      p.testedAt     = Date.now();
      p.probeOk      = probeOk;

      if (probeOk) {
        // Full success — probe confirmed real data. Stay connected; stop testing.
        p.status      = 'success';
        probeWinnerId  = p.id;
        probeWinnerCfg = p.configJson;
        onUpdate({
          phase: 'probe-validated', profileIndex: i,
          profileCount: profiles.length, profileLabel: p.label,
        }, [...profiles]);
        // Don't disconnect — leave tunnel up for caller to hand to vpnStore
        break;
      }

      // TCP-only success: record as backup, disconnect and try next profile
      p.status = 'tcp-only';
      if (!tcpOnlyWinnerId) {
        tcpOnlyWinnerId  = p.id;
        tcpOnlyWinnerCfg = p.configJson;
      }
      try { await adapter.disconnect(); } catch {}
      await sleep(BETWEEN_ATTEMPTS_MS);
      onUpdate({
        phase: 'testing', profileIndex: i + 1,
        profileCount: profiles.length,
        profileLabel: profiles[i + 1]?.label ?? '',
      }, [...profiles]);

    } catch (e: unknown) {
      p.status   = 'fail';
      p.error    = e instanceof Error ? e.message : String(e);
      p.testedAt = Date.now();
      try { await adapter.disconnect(); } catch {}
      await sleep(BETWEEN_ATTEMPTS_MS);
      onUpdate({
        phase: 'testing', profileIndex: i + 1,
        profileCount: profiles.length,
        profileLabel: profiles[i + 1]?.label ?? '',
      }, [...profiles]);
    }
  }

  // If probe winner found: already connected — return immediately
  if (probeWinnerId) {
    const result: AutoConnectResult = {
      success: true, probeOk: true, profiles,
      winnerId: probeWinnerId, winnerConfig: probeWinnerCfg,
      durationMs: Date.now() - ranAt, ranAt,
    };
    reportToAdmin(result, server.id, mode).catch(() => {});
    return result;
  }

  // No probe winner, but TCP-only winner exists — reconnect it
  if (tcpOnlyWinnerId && tcpOnlyWinnerCfg) {
    const tp = profiles.find(p => p.id === tcpOnlyWinnerId)!;
    tp.status = 'success'; // promote — it will be the VPN the user uses

    try {
      await Promise.race([
        tp.emergency
          ? adapter.connectEmergency(tcpOnlyWinnerCfg)
          : adapter.connect(tcpOnlyWinnerCfg),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Reconnect timeout')), CONNECT_TIMEOUT_MS)
        ),
      ]);
      onUpdate({
        phase: 'tcp-only', profileIndex: 0,
        profileCount: profiles.length, profileLabel: tp.label,
      }, profiles);
    } catch {
      tp.status = 'fail';
      tcpOnlyWinnerId  = null;
      tcpOnlyWinnerCfg = null;
    }
  }

  const success = tcpOnlyWinnerId !== null;

  if (!success) {
    onUpdate({
      phase: 'failed', profileIndex: profiles.length,
      profileCount: profiles.length, profileLabel: '',
    }, profiles);
  }

  const result: AutoConnectResult = {
    success,
    probeOk:      false,
    profiles,
    winnerId:     tcpOnlyWinnerId,
    winnerConfig: tcpOnlyWinnerCfg,
    durationMs:   Date.now() - ranAt,
    ranAt,
  };
  reportToAdmin(result, server.id, mode).catch(() => {});
  return result;
}

// ── Admin reporting ───────────────────────────────────────────────────────────

async function reportToAdmin(
  result:   AutoConnectResult,
  serverId: string,
  mode:     string,
): Promise<void> {
  try {
    for (const p of result.profiles) {
      if (p.status === 'pending' || p.status === 'skipped') continue;
      const body = new URLSearchParams({
        _token:      MOBILE_TOKEN,
        country:     'unknown',
        network:     'unknown',
        server:      serverId,
        port:        String(p.port),
        protocol:    p.protocol,
        sni:         p.sni,
        flow:        p.flow,
        fingerprint: p.fingerprint,
        result:      p.status === 'success' ? 'success'
                   : p.status === 'tcp-only' ? 'tcp_only' : 'fail',
        error_msg:   p.error ?? '',
        tcp_ok:      p.status !== 'fail' ? '1' : '0',
        http_ok:     p.probeOk ? '1' : '0',
        latency_ms:  String(p.latencyMs ?? 0),
        is_winner:   p.id === result.winnerId ? '1' : '0',
        tested_by:   'auto-connector-v1',
        mode,
        emergency:   p.emergency ? '1' : '0',
        notes:       `AutoConnector mode=${mode} total=${result.durationMs}ms probeOk=${result.probeOk}`,
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
