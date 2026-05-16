import { create } from 'zustand';

interface SettingsState {
  protocol:   string;
  dnsMode:    string;
  language:   string;

  autoConnect:      boolean;
  killSwitch:       boolean;
  stealthMode:      boolean;
  splitTunnel:      boolean;
  ipv6:             boolean;
  pushNotifications:boolean;
  biometricLock:    boolean;

  setProtocol: (v: string) => void;
  setDnsMode:  (v: string) => void;
  setLanguage: (v: string) => void;
  toggleAutoConnect:       () => void;
  toggleKillSwitch:        () => void;
  toggleStealthMode:       () => void;
  toggleSplitTunnel:       () => void;
  toggleIpv6:              () => void;
  togglePushNotifications: () => void;
  toggleBiometricLock:     () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  protocol:          'VLESS+Reality',
  dnsMode:           'Secure (DoH)',
  language:          'English',
  autoConnect:       true,
  killSwitch:        true,
  stealthMode:       false,
  splitTunnel:       false,
  ipv6:              false,
  pushNotifications: true,
  biometricLock:     false,

  setProtocol: (v) => set({ protocol: v }),
  setDnsMode:  (v) => set({ dnsMode: v }),
  setLanguage: (v) => set({ language: v }),
  toggleAutoConnect:       () => set((s) => ({ autoConnect:       !s.autoConnect })),
  toggleKillSwitch:        () => set((s) => ({ killSwitch:        !s.killSwitch })),
  toggleStealthMode:       () => set((s) => ({ stealthMode:       !s.stealthMode })),
  toggleSplitTunnel:       () => set((s) => ({ splitTunnel:       !s.splitTunnel })),
  toggleIpv6:              () => set((s) => ({ ipv6:              !s.ipv6 })),
  togglePushNotifications: () => set((s) => ({ pushNotifications: !s.pushNotifications })),
  toggleBiometricLock:     () => set((s) => ({ biometricLock:     !s.biometricLock })),
}));
