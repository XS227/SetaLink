import { apiGet } from './client';

export type StarlinkUnlockReason = 'premium' | 'test_mode' | 'invites' | null;
export type StarlinkNodeStatus   = 'online' | 'maintenance' | 'offline';
export type StarlinkNodeHealth   = 'ONLINE' | 'DEGRADED' | 'MAINTENANCE' | 'OFFLINE';

export interface StarlinkTelemetry {
  latencyMs:            number | null;
  packetLossPct:        number | null;
  uptimeSecs:           number | null;
  downloadKbps:         number | null;
  uploadKbps:           number | null;
  sessions:             number;
  lastHeartbeatAgeSecs: number | null;
}

export interface StarlinkNodeInfo {
  id:          string;
  available:   boolean;
  status:      StarlinkNodeStatus;
  statusNote:  string | null;
  maxSessions: number;
  country:     string;
  health:      StarlinkNodeHealth;
  telemetry:   StarlinkTelemetry;
}

export interface StarlinkUnlockStatus {
  unlock: {
    unlocked:        boolean;
    reason:          StarlinkUnlockReason;
    invitesVerified: number;
    invitesRequired: number;
  };
  /** null only when no Starlink node is enabled server-side at all. */
  node:         StarlinkNodeInfo | null;
  /** Server-truth (node_usage-backed, survives reinstalls): has this device
   *  ever routed through the Starlink node. Drives the once-per-device
   *  "first connect" achievement — see StarlinkCelebration. */
  hasConnected: boolean;
}

export const StarlinkAPI = {
  unlockStatus: (token: string) => apiGet<StarlinkUnlockStatus>('/starlink/unlock-status', token),
};
