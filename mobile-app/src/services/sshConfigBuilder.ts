/**
 * Builds the config payload for the REAL SSH transport (internal id
 * 'real_ssh') — a plain SSH dynamic-forward (SOCKS5-over-SSH) fallback,
 * separate from xrayConfigBuilder.ts since the shape is unrelated to an Xray
 * outbound (no uuid/publicKey/flow — just host/port/username/host-key pin).
 *
 * No secret material here: the device's private key never leaves native
 * storage, referenced only by the stable per-device key alias. This JSON is
 * safe to surface in getGeneratedConfig()'s debug view.
 */
import type { ServerCredentials } from './serverConfigService';

export interface RealSshTunnelConfig {
  transport:           'real_ssh';
  host:                string;
  port:                number;
  username:            string;
  hostKeyFingerprint:  string;
  hostKeyAlgorithm:    string;
}

export function buildRealSshConfigJson(creds: ServerCredentials): string {
  if (!creds.sshHost || !creds.sshUsername || !creds.sshHostKeyFingerprint) {
    throw new Error('REAL SSH: server did not provide complete SSH credentials');
  }
  const config: RealSshTunnelConfig = {
    transport:          'real_ssh',
    host:               creds.sshHost,
    port:               creds.sshPort ?? 22,
    username:           creds.sshUsername,
    hostKeyFingerprint: creds.sshHostKeyFingerprint,
    hostKeyAlgorithm:   creds.sshHostKeyAlgorithm ?? 'ssh-ed25519',
  };
  return JSON.stringify(config);
}
