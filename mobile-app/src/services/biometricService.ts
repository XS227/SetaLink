import { NativeModules, Platform } from 'react-native';

const { BiometricModule } = NativeModules;

export interface BiometricService {
  isAvailable(): Promise<boolean>;
  authenticate(title?: string, subtitle?: string): Promise<boolean>;
}

export const BiometricService: BiometricService = {
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'android' || !BiometricModule) return false;
    try {
      return await BiometricModule.isAvailable();
    } catch {
      return false;
    }
  },

  async authenticate(
    title = 'SetaLink',
    subtitle = 'Verify your identity to unlock',
  ): Promise<boolean> {
    if (Platform.OS !== 'android' || !BiometricModule) return false;
    try {
      return await BiometricModule.authenticate(title, subtitle);
    } catch {
      return false;
    }
  },
};
