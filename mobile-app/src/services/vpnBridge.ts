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

export interface TraceTestResult {
  ok: boolean;
  statusCode?: number;
  routedIp?: string;
  body?: string;
  bytesIn?: number;
  error?: string;
}

export interface SelfTestResult {
  test:   string;
  label:  string;
  ok:     boolean;
  detail: string;
}

export interface ProbeDiagnostics {
  tunnelState:  string;
  probeOk:      boolean;
  probeMs:      number;
  probeAt:      number;
  probeDetail:  string;
  quicEvidence: string;
  /** Build 80 — the extension's direct-path control measurement. */
  quicEvidenceDirect?: string;
}

/** Build 80 — app-process QUIC probe result (traverses the TUN on iOS). */
export interface QuicProbeResult {
  verdict:    string; // QUIC_OK | QUIC_BLACKHOLE_LIKELY | BOTH_FAIL | TCP_FAIL_QUIC_OK
  line:       string; // human-readable 'TCP=… QUIC=… ⇒ VERDICT [app-path]'
  tcpOk:      boolean;
  tcpMs:      number;
  tcpDetail:  string;
  quicOk:     boolean;
  quicMs:     number;
  quicDetail: string;
}

export interface VpnAdapter {
  connect(configJson: string): Promise<void>;
  connectEmergency(configJson: string): Promise<void>;
  disconnect(): Promise<void>;
  getStats(): Promise<VpnStats>;
  isRunning(): Promise<boolean>;
  getTun2socksLog?(): Promise<string>;
  getGeneratedConfig?(): Promise<string>;
  runTraceTest?(): Promise<TraceTestResult>;
  runSelfTest?(): Promise<SelfTestResult[]>;
  getTunnelState?(): Promise<string>;
  getProbeDiagnostics?(): Promise<ProbeDiagnostics>;
  runQuicProbe?(): Promise<QuicProbeResult | null>;
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

  async connectEmergency(_configJson: string): Promise<void> {
    return this.connect(_configJson);
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
  async getTun2socksLog(): Promise<string> { return '(mock — no native tunnel)'; }
  async getGeneratedConfig(): Promise<string> { return '(mock — no native tunnel)'; }
  async runTraceTest(): Promise<TraceTestResult> {
    await sleep(800);
    return { ok: true, statusCode: 200, routedIp: '104.28.0.1', bytesIn: 312, body: 'ip=104.28.0.1\nts=1234567890\n(mock)' };
  }
  async runSelfTest(): Promise<SelfTestResult[]> {
    await sleep(1000);
    return [
      { test: 'dns',     label: 'DNS Resolution',       ok: true,  detail: 'HTTP 204 · 0B · 0.80s (mock)' },
      { test: 'https',   label: 'HTTPS (IP-direct)',     ok: true,  detail: 'HTTP 200 · 312B · 0.90s (mock)' },
      { test: 'route',   label: 'Tunnel Route Verified', ok: true,  detail: 'state=connected_verified probe_ok=true (mock)' },
      { test: 'exit_ip', label: 'Exit IP',               ok: true,  detail: 'exit IP: 104.28.0.1 (mock)' },
    ];
  }
  async getTunnelState(): Promise<string> { return 'connected_verified'; }
  async getProbeDiagnostics(): Promise<ProbeDiagnostics> {
    return { tunnelState: 'connected_verified', probeOk: true, probeMs: 120,
             probeAt: Math.floor(Date.now() / 1000), probeDetail: 'mock',
             quicEvidence: '(mock)', quicEvidenceDirect: '(mock)' };
  }
  async runQuicProbe(): Promise<QuicProbeResult> {
    return { verdict: 'QUIC_OK', line: 'TCP=ok(50ms,HTTP 200) QUIC=ok(60ms,HTTP 200) ⇒ QUIC_OK [app-path] (mock)',
             tcpOk: true, tcpMs: 50, tcpDetail: 'HTTP 200 (mock)',
             quicOk: true, quicMs: 60, quicDetail: 'HTTP 200 (mock)' };
  }
}

// ── Native adapter (wraps XrayModule TurboModule) ────────────────────────────

// Last connect log — readable by vpnStore without creating a circular import
let _lastConnectLog:         string[]  = [];
let _lastConnectProbeOk:     boolean   = false;
let _lastConnectFailureCat:  string    = '';
export function getLastConnectLog():             string[]  { return _lastConnectLog; }
export function getLastConnectProbeOk():         boolean   { return _lastConnectProbeOk; }
export function getLastConnectFailureCategory(): string    { return _lastConnectFailureCat; }

class NativeAdapter implements VpnAdapter {
  private module: any;

  constructor(module: any) {
    this.module = module;
  }

  async connectEmergency(configJson: string): Promise<void> {
    return this._doConnect(configJson, true);
  }

  async connect(configJson: string): Promise<void> {
    return this._doConnect(configJson, false);
  }

  private async _doConnect(configJson: string, emergency: boolean): Promise<void> {
    const log: string[] = [];

    try {
      if (emergency) {
        await this.module.startEmergency(configJson);
      } else {
        await this.module.start(configJson);
      }
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

    // Poll until VpnService broadcasts CONNECTED (max 75 s).
    // Deep validation can take ~60 s in the worst case (several probe targets timing
    // out before a successful HTTPS probe). 30 s was too short and caused Server B's
    // "VPN tunnel did not start" error before the native side finished validating.
    let connected = false;
    for (let i = 0; i < 150; i++) {
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
      _lastConnectFailureCat = (await this.module.getLastFailureCategory?.().catch(() => '') as string | null) ?? '';

      // Pull native step log and xray process output for diagnostics
      const nativeSteps = await this.module.getConnectionLog?.().catch(() => []) as string[] ?? [];
      let xrayLogLines: string[] = [];
      let t2sLogLines: string[] = [];
      try {
        const rawLog = await this.module.getXrayLog?.() as string | null;
        if (rawLog && !rawLog.startsWith('(no xray')) {
          xrayLogLines = ['--- xray.log (last 20) ---', ...rawLog.split('\n').slice(-20), '---'];
        }
      } catch {}
      try {
        const t2sRaw = await this.module.getTun2socksLog?.() as string | null;
        if (t2sRaw && !t2sRaw.startsWith('(no tun2socks')) {
          t2sLogLines = ['--- tun2socks.log (last 20) ---', ...t2sRaw.split('\n').slice(-20), '---'];
        }
      } catch {}
      _lastConnectLog = [...nativeSteps, ...log, ...xrayLogLines, ...t2sLogLines];
      throw new Error(msg);
    }
    // Native layer (runRoutingValidation) validated end-to-end connectivity via a
    // SOCKS5 probe before broadcasting CONNECTED.  No JS-side IP-change check needed
    // — our app UID is excluded from the VPN, so fetchPublicIp() always returns the
    // real device IP regardless of VPN state, making pre/post comparison meaningless.
    // Read probe result before merging logs — probeOk=true means HTTP/HTTPS data confirmed.
    _lastConnectProbeOk    = (await this.module.getLastProbeResult?.().catch(() => false) as boolean | null) ?? false;
    _lastConnectFailureCat = (await this.module.getLastFailureCategory?.().catch(() => '') as string | null) ?? '';
    log.push(`✓ Native validation passed — tunnel active (probeOk=${_lastConnectProbeOk})`);

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

  async getTun2socksLog(): Promise<string> {
    return this.module.getTun2socksLog?.() ?? '(not available)';
  }

  async getGeneratedConfig(): Promise<string> {
    return this.module.getGeneratedConfig?.() ?? '(not available)';
  }

  async runTraceTest(): Promise<TraceTestResult> {
    try {
      return await this.module.runTraceTest();
    } catch {
      return { ok: false, error: 'runTraceTest not available on this platform' };
    }
  }

  async runSelfTest(): Promise<SelfTestResult[]> {
    try {
      return (await this.module.runSelfTest?.()) ?? [];
    } catch {
      return [{ test: 'error', label: 'Self Test', ok: false, detail: 'runSelfTest not available on this platform' }];
    }
  }

  async getTunnelState(): Promise<string> {
    try {
      return (await this.module.getTunnelState?.()) ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async getProbeDiagnostics(): Promise<ProbeDiagnostics> {
    const empty: ProbeDiagnostics = {
      tunnelState: 'unknown', probeOk: false, probeMs: 0,
      probeAt: 0, probeDetail: '', quicEvidence: '',
    };
    try {
      return (await this.module.getProbeDiagnostics?.()) ?? empty;
    } catch {
      return empty;
    }
  }

  // Build 80 — app-process QUIC probe. Returns null where the native method is
  // unavailable (Android: per-app UDP evidence is not implemented natively).
  async runQuicProbe(): Promise<QuicProbeResult | null> {
    try {
      return (await this.module.runQuicProbe?.()) ?? null;
    } catch {
      return null;
    }
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

// ── Diagnostic context ────────────────────────────────────────────────────────

/** Write device_id + country to App Group before each connect attempt. */
export async function setDiagnosticContext(deviceId: string, country: string): Promise<void> {
  // Try TurboModule path first, fall back to old-arch NativeModules.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
    await mod?.setDiagnosticContext?.(deviceId, country);
    return;
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    await NativeModules?.XrayModule?.setDiagnosticContext?.(deviceId, country);
  } catch {}
}

// ── Tunnel log upload ─────────────────────────────────────────────────────────

const TUNNEL_LOG_URL = 'https://setalink.no/api.php?mobile=1&action=submit-tunnel-log';

/** Fire-and-forget upload of the connection log to the server for remote diagnosis. */
export function uploadTunnelLog(deviceId: string, log: string[]): void {
  if (!deviceId || log.length === 0) return;
  const body = new FormData();
  body.append('device_id', deviceId);
  body.append('log', JSON.stringify(log));
  fetch(TUNNEL_LOG_URL, { method: 'POST', body }).catch(() => {});
}
