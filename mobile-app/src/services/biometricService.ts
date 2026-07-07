import { NativeModules } from 'react-native';

const { BiometricModule } = NativeModules;

export type BiometricStatus =
  | 'available' | 'none_enrolled' | 'no_hardware' | 'hw_unavailable'
  | 'update_required' | 'unknown';

export interface BiometricStatusDetail {
  strong?: number;            // raw canAuthenticate() code per class
  weak?: number;
  deviceCredential?: number;
  sdkInt?: number;
  available?: boolean;
  error?: string;
}

export interface BiometricService {
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<BiometricStatus>;
  getStatusDetail(): Promise<BiometricStatusDetail>;
  authenticate(title?: string, subtitle?: string): Promise<boolean>;
}

export const BiometricService: BiometricService = {
  async isAvailable(): Promise<boolean> {
    if (!BiometricModule) return false;
    try {
      return await BiometricModule.isAvailable();
    } catch {
      return false;
    }
  },

  async getStatus(): Promise<BiometricStatus> {
    if (!BiometricModule?.getStatus) return 'unknown';
    try {
      return (await BiometricModule.getStatus()) as BiometricStatus;
    } catch {
      return 'unknown';
    }
  },

  async getStatusDetail(): Promise<BiometricStatusDetail> {
    if (!BiometricModule?.getStatusDetail) return { error: 'module_unavailable' };
    try {
      return (await BiometricModule.getStatusDetail()) as BiometricStatusDetail;
    } catch (e: any) {
      return { error: String(e?.message ?? 'error') };
    }
  },

  async authenticate(
    title = 'Realink',
    subtitle = 'Verify your identity to unlock',
  ): Promise<boolean> {
    if (!BiometricModule) return false;
    try {
      return await BiometricModule.authenticate(title, subtitle);
    } catch {
      return false;
    }
  },
};
