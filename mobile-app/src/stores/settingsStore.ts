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
  /** Smart Mode / Iran Bypass: VPN stays connected, Iranian destinations
   *  (.ir + known services) bypass the tunnel. Default ON — for users in
   *  Iran this is the whole point; for everyone else the rules are inert
   *  unless they visit Iranian sites, where direct works equally well. */
  smartMode:            boolean;
  /** Android only: package names excluded from the VPN entirely
   *  (VpnService.addDisallowedApplication). Applied on next connect. */
  bypassApps:           string[];
  ipv6:                 boolean;
  pushNotifications:    boolean;
  biometricLock:        boolean;
  hasOnboarded:         boolean;
  hasSelectedLanguage:  boolean;
  hasSeenWelcome:       boolean;
  hasSeenTelegramTip:   boolean;   // Path B0 post-connect tip — shown once
  pendingReferralCode:  string | null;
  updateChannel:        'stable' | 'beta' | 'experimental';

  setProtocol:              (v: string) => void;
  setDnsMode:               (v: string) => void;
  setLanguage:              (v: string) => void;
  toggleAutoConnect:        () => void;
  toggleKillSwitch:         () => void;
  toggleStealthMode:        () => void;
  toggleSplitTunnel:        () => void;
  toggleSmartMode:          () => void;
  setBypassApps:            (pkgs: string[]) => void;
  toggleIpv6:               () => void;
  togglePushNotifications:  () => void;
  toggleBiometricLock:      () => void;
  setBiometricLock:         (v: boolean) => void;
  completeOnboarding:       () => void;
  completeLanguageSelection: () => void;
  markWelcomeSeen:           () => void;
  markTelegramTipSeen:       () => void;
  setPendingReferralCode:    (code: string | null) => void;
  setUpdateChannel:          (c: 'stable' | 'beta' | 'experimental') => void;
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
      smartMode:           true,
      bypassApps:          [],
      ipv6:                false,
      pushNotifications:   true,
      biometricLock:       false,
      hasOnboarded:         false,
      hasSelectedLanguage:  false,
      hasSeenWelcome:       false,
      hasSeenTelegramTip:   false,
      pendingReferralCode:  null,
      updateChannel:        'stable',

      setProtocol: (v) => set({ protocol: v }),
      setDnsMode:  (v) => set({ dnsMode: v }),
      setLanguage: (v) => set({ language: v }),

      toggleAutoConnect:         () => set((s) => ({ autoConnect:       !s.autoConnect })),
      toggleKillSwitch:          () => set((s) => ({ killSwitch:        !s.killSwitch })),
      toggleStealthMode:         () => set((s) => ({ stealthMode:       !s.stealthMode })),
      toggleSplitTunnel:         () => set((s) => ({ splitTunnel:       !s.splitTunnel })),
      toggleSmartMode:           () => set((s) => ({ smartMode:         !s.smartMode })),
      setBypassApps:             (pkgs) => set({ bypassApps: Array.isArray(pkgs) ? pkgs : [] }),
      toggleIpv6:                () => set((s) => ({ ipv6:              !s.ipv6 })),
      togglePushNotifications:   () => set((s) => ({ pushNotifications: !s.pushNotifications })),
      toggleBiometricLock:       () => set((s) => ({ biometricLock:     !s.biometricLock })),
      setBiometricLock:          (v) => set({ biometricLock: v }),
      completeOnboarding:        () => set({ hasOnboarded: true }),
      completeLanguageSelection: () => set({ hasSelectedLanguage: true }),
      markWelcomeSeen:           () => set({ hasSeenWelcome: true }),
      markTelegramTipSeen:       () => set({ hasSeenTelegramTip: true }),
      setPendingReferralCode:    (code) => set({ pendingReferralCode: code }),
      setUpdateChannel:          (c) => set({ updateChannel: c }),
    }),
    {
      name:    'setalink-settings-v2',
      storage: createJSONStorage(() => storage),
    }
  )
);
