import { apiGet } from './client';

/**
 * Starlink Experience API (b97 addendum #2).
 *
 * GET /v1/starlink/unlock-status powers every Starlink surface — the Home hero
 * card, the dedicated Starlink screen, and the first-connect celebration — for
 * BOTH locked and unlocked users. Contract verified live on prod 2026-07-17;
 * see docs/PRODUCT_CORRECTION_B97.md ("ADDENDUM #2") for the full shape.
 */

export interface StarlinkUnlock {
  unlocked:        boolean;
  reason:          'premium' | 'test_mode' | 'invites' | null;
  invitesVerified: number;
  invitesRequired: number;
}

/** Numbers only by design — the node's WAN/exit addresses never leave the server. */
export interface StarlinkTelemetry {
  latencyMs:            number | null;
  packetLossPct:        number | null;
  uptimeSecs:           number | null;
  downloadKbps:         number | null;
  uploadKbps:           number | null;
  sessions:             number;
  lastHeartbeatAgeSecs: number | null;
}

export type StarlinkHealth = 'ONLINE' | 'DEGRADED' | 'MAINTENANCE' | 'OFFLINE';

export interface StarlinkNodeStatus {
  id:          string;
  available:   boolean;
  status:      'online' | 'maintenance' | 'offline';
  statusNote:  string | null;   // 'auto_returns_when_healthy' while unavailable
  maxSessions: number;
  country:     string;
  health?:     StarlinkHealth;
  telemetry?:  StarlinkTelemetry;
}

export interface StarlinkUnlockStatus {
  unlock: StarlinkUnlock;
  /** null only when no Starlink node is enabled server-side at all. */
  node: StarlinkNodeStatus | null;
  /** Server-side truth for the once-per-device first-connect celebration
   *  (node_usage-backed, survives reinstalls). */
  hasConnected?: boolean;
}

export const StarlinkAPI = {
  unlockStatus: (token: string) =>
    apiGet<StarlinkUnlockStatus>('/starlink/unlock-status', token),
};
