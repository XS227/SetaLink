/**
 * Connection optimizer — tests multiple VLESS config profiles sequentially
 * and returns a ranked list of working configurations.
 *
 * Each profile is tested by starting the native Xray tunnel with that config
 * and waiting for the native SOCKS5 probe to validate end-to-end connectivity.
 * This is the only reliable way to test from inside Iran because:
 *   - JS fetch() always bypasses the VPN (app UID excluded from tunnel)
 *   - TCP reachability doesn't prove traffic flows through the proxy
 *   - Only the native SOCKS5 probe accurately validates the full tunnel path
 *
 * Usage: call runOptimizer() when VPN is disconnected. It will try each profile
 * and report results via onUpdate(). Returns the first successful profile or null.
 */

import type { VpnAdapter }        from './vpnBridge';
import type { VpnServer }         from '../stores/vpnStore';
import type { ServerCredentials } from './serverConfigService';
import { buildXrayConfigJson }    from './xrayConfigBuilder';

export interface OptimizerProfile {
  id:             string;
  label:          string;
  protocol:       string;
  sni:            string;
  port:           number;
  flow:           string;
  fingerprint:    string;
  configJson:     string;
  status:         'pending' | 'testing' | 'success' | 'fail' | 'skipped';
  latencyMs?:     number;
  error?:         string;
  testedAt?:      number;
}

export interface OptimizerResult {
  profiles:       OptimizerProfile[];
  bestProfileId:  string | null;
  ranAt:          number;
  durationMs:     number;
}

// How long to wait for a single profile attempt (ms).
// Budget: config-test(5s) + xray-start(3s) + tun-init(4s) + TCP-probe(8s)
//         + HTTP probes (2×6s=12s) + HTTPS probes (3×8s=24s) = ~56s worst-case.
// 70 s gives headroom for slow servers; fast failures (config errors, Xray crash)
// still resolve in under 10 s and move to the next profile immediately.
const PROBE_TIMEOUT_MS = 70_000;

// Admin API endpoint for anonymized diagnostics reporting.
const ADMIN_REPORT_URL = 'https://admin.setalink.no/api.php?mobile=1';
const MOBILE_TOKEN = 'setalink-mobile-diag-v1';

// Post anonymized probe results to the admin panel.
// Failures are silently swallowed — reporting must never block the optimizer.
async function reportResultsToAdmin(
  result: OptimizerResult,
  serverId: string,
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
        result:      p.status === 'success' ? 'success' : 'fail',
        error_msg:   p.error ?? '',
        tcp_ok:      p.status !== 'fail' ? '1' : '0',
        http_ok:     p.status === 'success' ? '1' : '0',
        latency_ms:  String(p.latencyMs ?? 0),
        is_winner:   p.id === result.bestProfileId ? '1' : '0',
        tested_by:   'mobile-optimizer-v2',
        mode:        'optimizer',
        notes:       `Optimizer v2. Total=${result.durationMs}ms bestId=${result.bestProfileId ?? 'none'}`,
      });
      // Best-effort POST — 4s timeout. JS fetch bypasses VPN, so it reaches admin directly.
      await Promise.race([
        fetch(ADMIN_REPORT_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    body.toString(),
        }),
        new Promise<void>((_, r) => setTimeout(() => r(new Error('timeout')), 4000)),
      ]);
    }
  } catch { /* silent */ }
}

// Build all candidate profiles for a given base server + credentials.
// Each profile tests a different combination of SNI / transport / port.
export function buildProfiles(
  server: VpnServer,
  creds: ServerCredentials | undefined,
): Omit<OptimizerProfile, 'configJson' | 'status'>[] {
  if (!creds) return [];

  const base = creds;

  return [
    // ── Reality profiles (different SNIs) ───────────────────────────────────
    {
      id: 'reality-current',
      label: 'Reality · current SNI',
      protocol: 'VLESS + Reality',
      sni: base.sni || 'www.microsoft.com',
      port: base.port,
      flow: base.flow,
      fingerprint: base.fingerprint || 'chrome',
    },
    {
      id: 'reality-microsoft',
      label: 'Reality · microsoft.com',
      protocol: 'VLESS + Reality',
      sni: 'www.microsoft.com',
      port: base.port,
      flow: base.flow,
      fingerprint: base.fingerprint || 'chrome',
    },
    {
      id: 'reality-bing',
      label: 'Reality · bing.com',
      protocol: 'VLESS + Reality',
      sni: 'www.bing.com',
      port: base.port,
      flow: base.flow,
      fingerprint: base.fingerprint || 'chrome',
    },
    {
      id: 'reality-apple',
      label: 'Reality · apple.com',
      protocol: 'VLESS + Reality',
      sni: 'www.apple.com',
      port: base.port,
      flow: base.flow,
      fingerprint: 'safari',
    },
    {
      id: 'reality-samsung',
      label: 'Reality · samsung.com',
      protocol: 'VLESS + Reality',
      sni: 'www.samsung.com',
      port: base.port,
      flow: base.flow,
      fingerprint: base.fingerprint || 'chrome',
    },
    {
      id: 'reality-speedtest',
      label: 'Reality · speedtest.net (no flow)',
      protocol: 'VLESS + Reality',
      sni: 'www.speedtest.net',
      port: base.port,
      flow: '',
      fingerprint: 'chrome',
    },
    // ── TLS transport profiles (port 443) ───────────────────────────────────
    {
      id: 'xhttp-443',
      label: 'VLESS + XHTTP · port 443',
      protocol: 'VLESS + XHTTP',
      sni: base.address || server.id + '.setalink.net',
      port: 443,
      flow: '',
      fingerprint: 'chrome',
    },
    {
      id: 'ws-443',
      label: 'VLESS + WebSocket · port 443',
      protocol: 'VLESS + WebSocket',
      sni: base.address || server.id + '.setalink.net',
      port: 443,
      flow: '',
      fingerprint: 'chrome',
    },
  ];
}

// Build the Xray config JSON for each profile, replacing credential fields.
function buildProfileConfig(
  profile: Omit<OptimizerProfile, 'configJson' | 'status'>,
  server: VpnServer,
  creds: ServerCredentials,
): string {
  const patchedCreds: ServerCredentials = {
    ...creds,
    sni:         profile.sni,
    port:        profile.port,
    flow:        profile.flow,
    fingerprint: profile.fingerprint,
  };

  const protocol =
    profile.protocol.includes('Reality')     ? 'Reality'    :
    profile.protocol.includes('XHTTP')       ? 'VLESS+XHTTP' :
    profile.protocol.includes('WebSocket')   ? 'WebSocket'  :
    profile.protocol.includes('HTTPUpgrade') ? 'HTTPUpgrade': 'Reality';

  return buildXrayConfigJson(server, protocol, 'Cloudflare (DoH)', patchedCreds);
}

// Run the optimizer. Tests profiles sequentially, calls onUpdate after each one.
// Returns the id of the first successful profile (or null if all fail).
// Results are reported anonymously to the admin panel (best-effort, silent on failure).
export async function runOptimizer(
  server:   VpnServer,
  creds:    ServerCredentials | undefined,
  adapter:  VpnAdapter,
  onUpdate: (profiles: OptimizerProfile[]) => void,
): Promise<OptimizerResult> {
  const startMs = Date.now();

  if (!creds) {
    return { profiles: [], bestProfileId: null, ranAt: startMs, durationMs: 0 };
  }

  const profileDefs = buildProfiles(server, creds);

  // Build full profiles with config JSON
  const profiles: OptimizerProfile[] = profileDefs.map(def => ({
    ...def,
    configJson: buildProfileConfig(def, server, creds),
    status: 'pending' as const,
  }));

  onUpdate([...profiles]);

  let bestProfileId: string | null = null;

  for (const profile of profiles) {
    if (bestProfileId) {
      // Already found a working profile — skip remaining but show as skipped
      profile.status = 'skipped';
      onUpdate([...profiles]);
      continue;
    }

    profile.status = 'testing';
    onUpdate([...profiles]);

    const attemptStart = Date.now();

    try {
      // Race the adapter connect against a timeout
      await Promise.race([
        adapter.connect(profile.configJson),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Probe timeout after ' + PROBE_TIMEOUT_MS / 1000 + 's')), PROBE_TIMEOUT_MS)
        ),
      ]);

      profile.status    = 'success';
      profile.latencyMs = Date.now() - attemptStart;
      profile.testedAt  = Date.now();
      bestProfileId = profile.id;
      onUpdate([...profiles]);

      // Disconnect so the user can reconnect with the winning profile
      try { await adapter.disconnect(); } catch {}

    } catch (e: unknown) {
      profile.status   = 'fail';
      profile.error    = (e instanceof Error) ? e.message : String(e);
      profile.testedAt = Date.now();
      onUpdate([...profiles]);

      // Ensure VPN is stopped before trying next profile
      try { await adapter.disconnect(); } catch {}

      // Small gap between attempts to let the system stabilize
      await sleep(800);
    }
  }

  const finalResult: OptimizerResult = {
    profiles,
    bestProfileId,
    ranAt:      startMs,
    durationMs: Date.now() - startMs,
  };

  // Report anonymized results to admin asynchronously — do not await.
  reportResultsToAdmin(finalResult, server.id).catch(() => {});

  return finalResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
