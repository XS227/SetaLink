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

class NativeAdapter implements VpnAdapter {
  private module: any;

  constructor(module: any) {
    this.module = module;
  }

  async connect(configJson: string): Promise<void> {
    await this.module.start(configJson);
    // Poll until the service signals it's running (max 10 s)
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (await this.module.isRunning()) return;
    }
    throw new Error('Tunnel did not start within 10 seconds');
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../specs/NativeXrayModule').default;
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
