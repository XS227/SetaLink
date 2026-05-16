import { apiGet } from './client';
import type { Server } from '../../components/ServerRow';
import type { ServerCredentials } from '../serverConfigService';

export const ServersAPI = {
  list: (token: string) =>
    apiGet<Server[]>('/servers', token),

  getConfig: (serverId: string, token: string) =>
    apiGet<ServerCredentials>(`/servers/${encodeURIComponent(serverId)}/config`, token),
};
