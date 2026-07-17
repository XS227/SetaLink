import { apiGet } from './client';
import type { Server } from '../../components/ServerRow';
import type { ServerCredentials } from '../serverConfigService';

export const ServersAPI = {
  // Carrier rides along so the backend can serve per-operator learned routing
  // (node reachability from Iran differs by operator, not just country).
  list: (token: string) => {
    let carrier = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getCachedCarrier } = require('../deviceIdentityService');
      carrier = getCachedCarrier() || '';
    } catch {}
    const qs = carrier ? `?carrier=${encodeURIComponent(carrier)}` : '';
    return apiGet<Server[]>(`/servers${qs}`, token);
  },

  getConfig: (serverId: string, token: string) =>
    apiGet<ServerCredentials>(`/servers/${encodeURIComponent(serverId)}/config`, token),
};
