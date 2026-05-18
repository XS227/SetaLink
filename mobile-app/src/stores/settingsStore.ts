import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

interface SettingsState {
  protocol:             string;
  dnsMode:              string;
  language:             string;
  autoConnect:          boolean;
  killSwitch:           boolean;
  stealthMode:          boolean;
  splitTunnel:          boolean;
  ipv6:                 boolean;
  pushNotifications:    boolean;
  biometricLock:        boolean;
  hasOnboarded:         boolean;
  hasSelectedLanguage:  boolean;
  hasSeenWelcome:       boolean;

  setProtocol:              (v: string) => void;
  setDnsMode:               (v: string) => void;
  setLanguage:              (v: string) => void;
  toggleAutoConnect:        () => void;
  toggleKillSwitch:         () => void;
  toggleStealthMode:        () => void;
  toggleSplitTunnel:        () => void;
  toggleIpv6:               () => void;
  togglePushNotifications:  () => void;
  toggleBiometricLock:      () => void;
  completeOnboarding:       () => void;
  completeLanguageSelection: () => void;
  markWelcomeSeen:           () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      protocol:            'VLESS+Reality',
      dnsMode:             'Cloudflare (DoH)',
      language:            'English',
      autoConnect:         false,
      killSwitch:          false,
      stealthMode:         false,
      splitTunnel:         false,
      ipv6:                false,
      pushNotifications:   true,
      biometricLock:       false,
      hasOnboarded:        false,
      hasSelectedLanguage: false,
      hasSeenWelcome:      false,

      setProtocol: (v) => set({ protocol: v }),
      setDnsMode:  (v) => set({ dnsMode: v }),
      setLanguage: (v) => set({ language: v }),

      toggleAutoConnect:         () => set((s) => ({ autoConnect:       !s.autoConnect })),
      toggleKillSwitch:          () => set((s) => ({ killSwitch:        !s.killSwitch })),
      toggleStealthMode:         () => set((s) => ({ stealthMode:       !s.stealthMode })),
      toggleSplitTunnel:         () => set((s) => ({ splitTunnel:       !s.splitTunnel })),
      toggleIpv6:                () => set((s) => ({ ipv6:              !s.ipv6 })),
      togglePushNotifications:   () => set((s) => ({ pushNotifications: !s.pushNotifications })),
      toggleBiometricLock:       () => set((s) => ({ biometricLock:     !s.biometricLock })),
      completeOnboarding:        () => set({ hasOnboarded: true }),
      completeLanguageSelection: () => set({ hasSelectedLanguage: true }),
      markWelcomeSeen:           () => set({ hasSeenWelcome: true }),
    }),
    {
      name:    'setalink-settings-v2',
      storage: createJSONStorage(() => storage),
    }
  )
);
