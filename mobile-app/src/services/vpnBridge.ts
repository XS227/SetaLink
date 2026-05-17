/**
 * VPN bridge — adapts ConnectionMachine to native (real) or mock VPN operations.
 *
 * Architecture:
 *   ConnectionMachine receives a VpnAdapter at construction time.
 *   When connecting, the machine calls adapter.connect(configJson) and awaits
 *   the result instead of using random mock timers.
 *
 * createAdapter() auto-detects availability:
 *   • If NativeXrayModule resolves → NativeAdapter (real tunnel)
 *   • Otherwise              → MockAdapter  (dev/simulator)
 */

export interface VpnStats {
  uploadBytes:   number;
  downloadBytes: number;
  pingMs:        number;
  uptime:        number;  // seconds
}

export interface VpnAdapter {
  connect(configJson: string): Promise<void>;
  disconnect(): Promise<void>;
  getStats(): Promise<VpnStats>;
  isRunning(): Promise<boolean>;
}

// ── Mock adapter (used when native module is unavailable) ─────────────────────

const MOCK_CONNECT_DELAY  = () => 1500 + Math.random() * 1000;
const MOCK_SUCCESS_RATE   = 0.95;

class MockAdapter implements VpnAdapter {
  private _running   = false;
  private _startedAt = 0;

  async connect(_configJson: string): Promise<void> {
    await sleep(MOCK_CONNECT_DELAY());
    if (Math.random() >= MOCK_SUCCESS_RATE) throw new Error('Connection failed (mock)');
    this._running   = true;
    this._startedAt = Date.now();
  }

  async disconnect(): Promise<void> {
    await sleep(600 + Math.random() * 400);
    this._running   = false;
    this._startedAt = 0;
  }

  async getStats(): Promise<VpnStats> {
    const uptime = this._startedAt ? Math.floor((Date.now() - this._startedAt) / 1000) : 0;
    return {
      uploadBytes:   Math.floor(Math.random() * 50_000),
      downloadBytes: Math.floor(Math.random() * 200_000),
      pingMs:        20 + Math.floor(Math.random() * 15),
      uptime,
    };
  }

  async isRunning(): Promise<boolean> { return this._running; }
}

// ── Native adapter (wraps XrayModule TurboModule) ────────────────────────────

// Last connect log — readable by vpnStore without creating a circular import
let _lastConnectLog: string[] = [];
export function getLastConnectLog(): string[] { return _lastConnectLog; }

export interface RoutingValidationResult {
  ok: boolean;
  reason: string;
  preIp?: string | null;
  postIp?: string | null;
  uploadBytes?: number;
  downloadBytes?: number;
}

async function fetchPublicIp(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res  = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(tid);
    const json = await res.json() as { ip?: string };
    return json.ip ?? null;
  } catch {
    return null;
  }
}


async function validateRouting(module: any, preIp: string | null, log: string[]): Promise<RoutingValidationResult> {
  const postIp = await fetchPublicIp();
  const stats = await module.getStats?.().catch(() => ({}));
  const up = Number(stats?.uploadBytes ?? 0);
  const down = Number(stats?.downloadBytes ?? 0);
  const countersForwarding = up > 0 || down > 0;
  const ipChanged = Boolean(preIp && postIp && preIp !== postIp);

  if (postIp) log.push(`Post-connect IP: ${postIp}`);
  else log.push('Post-connect IP: unavailable');
  log.push(`TUN counters: up=${up}B down=${down}B`);

  if (ipChanged || countersForwarding) {
    return { ok: true, reason: ipChanged ? 'public_ip_changed' : 'tun_counters_forwarding', preIp, postIp, uploadBytes: up, downloadBytes: down };
  }

  return { ok: false, reason: 'no_forwarding_signal', preIp, postIp, uploadBytes: up, downloadBytes: down };
}

class NativeAdapter implements VpnAdapter {
  private module: any;

  constructor(module: any) {
    this.module = module;
  }

  async connect(configJson: string): Promise<void> {
    const log: string[] = [];

    // Check public IP before connecting so we can verify routing later
    log.push('Checking pre-connect public IP...');
    const priorIp = await fetchPublicIp();
    if (priorIp) {
      log.push(`Pre-connect IP: ${priorIp}`);
    } else {
      log.push('Pre-connect IP: unavailable (no internet?)');
    }

    // module.start() may reject immediately (e.g. VPN_PERMISSION_DENIED)
    // or resolve and then the service broadcasts connected/failed asynchronously.
    try {
      await this.module.start(configJson);
    } catch (e: unknown) {
      const msg =
        (e as any)?.userInfo?.NSLocalizedDescription ??
        (e as any)?.userInfo?.message               ??
        (e instanceof Error ? e.message : String(e));
      log.push(`✗ start() rejected: ${msg}`);
      _lastConnectLog = log;
      throw new Error(msg);
    }
    log.push('VPN service started — waiting for tunnel...');

    // Poll until VpnService broadcasts CONNECTED (max 30 s)
    let connected = false;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (await this.module.isRunning()) { connected = true; break; }
      // Fail fast: if service already broadcast an error, stop waiting
      const earlyErr = await this.module.getLastError?.().catch(() => null) as string | null;
      if (earlyErr) {
        log.push(`✗ Service error detected early: ${earlyErr}`);
        break;
      }
    }

    if (!connected) {
      const nativeErr = await this.module.getLastError?.().catch(() => null) as string | null;
      const msg = nativeErr ?? 'VPN tunnel did not start — check server config';
      log.push(`✗ ${msg}`);

      // Pull native step log and xray process output for diagnostics
      const nativeSteps = await this.module.getConnectionLog?.().catch(() => []) as string[] ?? [];
      let xrayLogLines: string[] = [];
      try {
        const rawLog = await this.module.getXrayLog?.() as string | null;
        if (rawLog && !rawLog.startsWith('(no xray')) {
          xrayLogLines = ['--- xray.log ---', ...rawLog.split('\n').slice(-20), '---'];
        }
      } catch {}
      _lastConnectLog = [...nativeSteps, ...log, ...xrayLogLines];
      throw new Error(msg);
    }
    log.push('Native tunnel reports running — validating traffic routing...');

    const validation = await validateRouting(this.module, priorIp, log);
    if (!validation.ok) {
      log.push(`✗ Routing validation failed (${validation.reason})`);
      await this.module.stop?.().catch(() => {});
      await sleep(900);
      log.push('Recovery: full teardown requested, retrying clean start (1/1)');
      await this.module.start(configJson);
      await sleep(1500);
      const second = await validateRouting(this.module, priorIp, log);
      if (!second.ok) {
        await this.module.stop?.().catch(() => {});
        throw new Error('VPN connected but routing could not be verified');
      }
      log.push(`✓ Routing recovered (${second.reason})`);
    } else {
      log.push(`✓ Routing validated (${validation.reason})`);
    }

    // Merge native step log with JS log
    try {
      const nativeSteps = await this.module.getConnectionLog?.() as string[] ?? [];
      _lastConnectLog = [...nativeSteps, ...log];
    } catch { _lastConnectLog = log; }
  }

  async disconnect(): Promise<void> {
    await this.module.stop();
  }

  async getStats(): Promise<VpnStats> {
    const s = await this.module.getStats();
    return {
      uploadBytes:   s.uploadBytes   ?? 0,
      downloadBytes: s.downloadBytes ?? 0,
      pingMs:        s.pingMs        ?? 0,
      uptime:        s.uptime        ?? 0,
    };
  }

  async isRunning(): Promise<boolean> {
    return this.module.isRunning();
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAdapter(): VpnAdapter {
  // Try TurboModuleRegistry first (works with New Architecture)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
    if (mod) return new NativeAdapter(mod);
  } catch {}

  // Fallback: Old Architecture bridge — modules registered via ReactPackage
  // live in NativeModules, not in TurboModuleRegistry, when newArchEnabled=false
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const mod = NativeModules?.XrayModule;
    if (mod) return new NativeAdapter(mod);
  } catch {}

  return new MockAdapter();
}

// ── Singleton exposed for stats polling from stores ──────────────────────────

let _sharedAdapter: VpnAdapter | null = null;

export function getAdapter(): VpnAdapter {
  if (!_sharedAdapter) _sharedAdapter = createAdapter();
  return _sharedAdapter;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
