/**
 * REAL SSH (transport 'real_ssh') — server-catalog + config-builder unit tests.
 *
 * Covers the two regressions caught while wiring this in (2026-08-22):
 * bundled ping:0/load:0 placeholders otherwise "win" both compareForAutoSelect
 * (lowest-ping tiebreak) and scoreServer (ping/load-derived score) purely by
 * accident — REAL SSH must be reachable ONLY by manual tap or as AUTO's
 * explicit last-resort failover, never picked by default ranking.
 */
import {
  REAL_SSH_ID,
  BUNDLED_REAL_SSH,
  BUNDLED_REAL_SSH_CREDS,
  SERVER_CATALOG,
  compareForAutoSelect,
  scoreServer,
  type ServerRecord,
} from '../stores/serverStore';
import { buildRealSshConfigJson } from '../services/sshConfigBuilder';
import type { ServerCredentials } from '../services/serverConfigService';

describe('REAL SSH bundled catalog entry', () => {
  it('is present in the bundled catalog as a manual, non-preferred node', () => {
    expect(SERVER_CATALOG.some((s) => s.id === REAL_SSH_ID)).toBe(true);
    expect(BUNDLED_REAL_SSH.protocol).toBe('SSH');
    expect(BUNDLED_REAL_SSH.transport).toBe('real_ssh');
    expect(BUNDLED_REAL_SSH.tags ?? []).not.toContain('Recommended');
    expect(BUNDLED_REAL_SSH.tags ?? []).not.toContain('Stealth');
  });

  it('never wins compareForAutoSelect over a real node, regardless of successScore/ping', () => {
    const normal: ServerRecord = { id: 'x', country: 'X', city: 'X', flag: '🏳️', ping: 200, load: 90, protocol: 'Reality' };
    // Even with its 0/0 placeholders looking "best", real_ssh must sort after any real node.
    expect(compareForAutoSelect(BUNDLED_REAL_SSH, normal)).toBeGreaterThan(0);
    expect(compareForAutoSelect(normal, BUNDLED_REAL_SSH)).toBeLessThan(0);
  });

  it('scoreServer returns a floor value for real_ssh regardless of mode', () => {
    for (const mode of ['gaming', 'streaming', 'stealth', 'iran', 'auto', 'fallback'] as const) {
      expect(scoreServer(BUNDLED_REAL_SSH, mode)).toBe(-9999);
    }
    const normal: ServerRecord = { id: 'x', country: 'X', city: 'X', flag: '🏳️', ping: 200, load: 90, protocol: 'Reality' };
    expect(scoreServer(normal, 'auto')).toBeGreaterThan(scoreServer(BUNDLED_REAL_SSH, 'auto'));
  });
});

describe('buildRealSshConfigJson', () => {
  it('produces the real_ssh transport payload with no Reality/WS secret fields', () => {
    const json = buildRealSshConfigJson(BUNDLED_REAL_SSH_CREDS);
    const parsed = JSON.parse(json);
    expect(parsed.transport).toBe('real_ssh');
    expect(parsed.host).toBe(BUNDLED_REAL_SSH_CREDS.sshHost);
    expect(parsed.port).toBe(22);
    expect(parsed.username).toBe('realgram-tunnel');
    expect(parsed.hostKeyFingerprint).toContain('SHA256:');
    // No private-key or Reality-outbound fields ever end up in this payload.
    expect(json).not.toMatch(/privateKey|BEGIN OPENSSH|publicKey/i);
  });

  it('defaults port to 22 and algorithm to ssh-ed25519 when omitted', () => {
    const creds: ServerCredentials = { ...BUNDLED_REAL_SSH_CREDS, sshPort: undefined, sshHostKeyAlgorithm: undefined };
    const parsed = JSON.parse(buildRealSshConfigJson(creds));
    expect(parsed.port).toBe(22);
    expect(parsed.hostKeyAlgorithm).toBe('ssh-ed25519');
  });

  it('throws when the server did not provide SSH credentials', () => {
    expect(() => buildRealSshConfigJson({ ...BUNDLED_REAL_SSH_CREDS, sshHost: undefined })).toThrow();
  });
});
