/**
 * VPS Helper client service — contract tests (no network; fetch mocked).
 * Verifies the service talks to the standalone endpoint, maps the backend
 * shape correctly, surfaces the install command ONLY when active, and never
 * throws on network failure.
 */
import { vpsHelperService } from '../services/vpsHelperService';

const okJson = (data: any) => ({ ok: true, json: async () => ({ ok: true, data }) });
const g = globalThis as unknown as Record<string, unknown>;
const setFetch = (fn: unknown) => { g.fetch = fn; };

describe('vpsHelperService', () => {
  const realFetch = g.fetch;
  afterEach(() => { g.fetch = realFetch; jest.clearAllMocks(); });

  it('getStatus maps active state + install command', async () => {
    setFetch(jest.fn().mockResolvedValue(okJson({
      status: 'active', node: 'finland', exit_ip: '65.109.183.7',
      install_command: 'curl ... | bash',
    })));
    const s = await vpsHelperService.getStatus('dev-123456');
    expect(s.status).toBe('active');
    expect(s.node).toBe('finland');
    expect(s.exitIp).toBe('65.109.183.7');
    expect(s.installCommand).toBe('curl ... | bash');
  });

  it('pending state carries no install command', async () => {
    setFetch(jest.fn().mockResolvedValue(okJson({ status: 'pending' })));
    const s = await vpsHelperService.provision('dev-123456');
    expect(s.status).toBe('pending');
    expect(s.installCommand).toBeUndefined();
  });

  it('provision POSTs token + device_id form-encoded to the standalone endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okJson({ status: 'pending' }));
    setFetch(fetchMock);
    await vpsHelperService.provision('dev-abc-999');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/vps-helper.php');
    expect(String(url)).toContain('action=vps-helper-provision');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('device_id=dev-abc-999');
    expect(String(init.body)).toContain('_token=');
  });

  it('backend ok:false becomes an error state (not a throw)', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'rate limit (device)' }) }));
    const s = await vpsHelperService.provision('dev-123456');
    expect(s.status).toBe('error');
    expect(s.error).toContain('rate limit');
  });

  it('network failure never throws; returns error state', async () => {
    setFetch(jest.fn().mockRejectedValue(new Error('down')));
    const s = await vpsHelperService.getStatus('dev-123456');
    expect(s.status).toBe('error');
    expect(s.error).toBe('network error');
  });

  it('revoke calls the revoke action', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okJson({ status: 'revoking' }));
    setFetch(fetchMock);
    const s = await vpsHelperService.revoke('dev-123456');
    expect(String(fetchMock.mock.calls[0][0])).toContain('action=vps-helper-revoke');
    expect(s.status).toBe('revoking');
  });
});
