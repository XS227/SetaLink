/**
 * AppNavigator — React Navigation v7
 *
 * Stack:
 *   Splash → (boot sequence) → Auth | Main
 *   Main   → BottomTabs (Home | Servers | AI | Activity | Profile)
 *   Settings, Diagnostics → slide_from_right stack screens
 *
 * Boot sequence:
 *   SplashAdapter runs runBootSequence(), which checks auth state and
 *   autoConnect setting, then routes accordingly.
 *
 * Adapter pattern: screens expose { onNavigate, activeTab } — adapters
 * translate React Navigation props to that interface with no screen changes.
 */

import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';

import { SplashScreen }      from '../screens/SplashScreen';
import { LanguageScreen }    from '../screens/LanguageScreen';
import { OnboardingScreen }  from '../screens/OnboardingScreen';
import { AuthScreen }        from '../screens/AuthScreen';
import { WelcomeScreen }     from '../screens/WelcomeScreen';
import { HomeScreen }        from '../screens/HomeScreen';
import { ServersScreen }     from '../screens/ServersScreen';
import { SmartAIScreen }     from '../screens/SmartAIScreen';
import { ActivityScreen }    from '../screens/ActivityScreen';
import { ProfileScreen }     from '../screens/ProfileScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { BottomNav, NavTab }        from '../components/BottomNav';
import { Toast }                    from '../components/Toast';
import { BiometricLockScreen }      from '../components/BiometricLockScreen';
import { UpgradeScreen }            from '../screens/UpgradeScreen';
import { ProfileImportScreen }     from '../screens/ProfileImportScreen';

import { runBootSequence }       from '../services/bootService';
import { getOrCreateDeviceId, enrichDeviceId } from '../services/deviceIdentityService';
import { registerDevice }        from '../services/entitlementService';
import { BiometricService }      from '../services/biometricService';
import { getAdapter }            from '../services/vpnBridge';
import { useAuthStore }          from '../stores/authStore';
import { useSettingsStore }      from '../stores/settingsStore';
import { useVpnStore }           from '../stores/vpnStore';
import { useServerStore }        from '../stores/serverStore';
import { useAppBoot }            from '../hooks/useAppBoot';
import { useDeepLinks }          from '../hooks/useDeepLinks';

import type { RootStackParamList, MainTabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<MainTabParamList>();

const SCREEN_TO_TAB: Record<string, NavTab> = {
  Home:     'home',
  Servers:  'servers',
  AI:       'ai',
  Activity: 'activity',
  Profile:  'profile',
};

const TAB_TO_SCREEN: Record<NavTab, keyof MainTabParamList> = {
  home:     'Home',
  servers:  'Servers',
  ai:       'AI',
  activity: 'Activity',
  profile:  'Profile',
};

type ScreenAdapterProps = { navigation: any; route: any };

function makeOnNavigate(navigation: any): (tab: NavTab) => void {
  return (tab) => {
    if ((tab as string) === 'settings')       { navigation.navigate('Settings');       return; }
    if ((tab as string) === 'diagnostics')    { navigation.navigate('Diagnostics');    return; }
    if ((tab as string) === 'upgrade')        { navigation.navigate('Upgrade');        return; }
    if ((tab as string) === 'profileImport')  { navigation.navigate('ProfileImport'); return; }
    navigation.navigate(TAB_TO_SCREEN[tab] ?? 'Home');
  };
}

// ── Main tab shell with AppState lifecycle ────────────────────────────────────

function MainTabs() {
  useAppBoot(); // registers AppState listener for kill-switch / reconnect logic

  const token               = useAuthStore((s) => s.token);
  const fetchServers        = useServerStore((s) => s.fetchServers);
  const loadBootstrapIfEmpty = useServerStore((s) => s.loadBootstrapIfEmpty);
  const biometricLock       = useSettingsStore((s) => s.biometricLock);
  const setBiometricLock    = useSettingsStore((s) => s.setBiometricLock);
  const connectionState     = useVpnStore((s) => s.connectionState);
  const setSessionBytes     = useVpnStore((s) => s.setSessionBytes);

  const [isLocked, setIsLocked] = React.useState(false);
  const appStateRef = React.useRef(AppState.currentState);

  useEffect(() => {
    if (token) { fetchServers(token).catch(() => {}); }
  }, [token, fetchServers]);

  // On first launch (no servers imported), try to fetch the remote bootstrap profile.
  // This gives fresh installs a working "install → open → connect" experience.
  useEffect(() => {
    loadBootstrapIfEmpty().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: if biometric lock is enabled, verify the device actually supports it.
  // If unavailable, silently disable the setting so the user is never locked out.
  useEffect(() => {
    if (!biometricLock) return;
    BiometricService.isAvailable().then((available) => {
      if (!available) setBiometricLock(false);
    }).catch(() => setBiometricLock(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState.match(/inactive|background/)) {
        // Only lock if biometric lock is still enabled (it may have been auto-disabled above)
        if (useSettingsStore.getState().biometricLock) setIsLocked(true);
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // Global traffic poller — runs at the shell level regardless of which tab is active.
  // Ensures sessionBytes stays up to date for Activity, Profile, and Home displays.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await getAdapter().getStats();
        if (!cancelled) setSessionBytes({ sent: s.uploadBytes, received: s.downloadBytes });
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => {
          const routeName = props.state.routes[props.state.index].name as string;
          const activeTab = SCREEN_TO_TAB[routeName] ?? 'home';
          return (
            <BottomNav
              active={activeTab}
              onPress={(tab) => props.navigation.navigate(TAB_TO_SCREEN[tab])}
            />
          );
        }}
      >
        <Tab.Screen name="Home"     component={HomeAdapter} />
        <Tab.Screen name="Servers"  component={ServersAdapter} />
        <Tab.Screen name="AI"       component={AIAdapter} />
        <Tab.Screen name="Activity" component={ActivityAdapter} />
        <Tab.Screen name="Profile"  component={ProfileAdapter} />
      </Tab.Navigator>
      <BiometricLockScreen visible={isLocked} onUnlock={() => setIsLocked(false)} />
    </>
  );
}

// ── Tab adapters ──────────────────────────────────────────────────────────────

function HomeAdapter({ navigation, route }: ScreenAdapterProps) {
  return <HomeScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'home'} onNavigate={makeOnNavigate(navigation)} />;
}

function ServersAdapter({ navigation, route }: ScreenAdapterProps) {
  return <ServersScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'servers'} onNavigate={makeOnNavigate(navigation)} />;
}

function AIAdapter({ navigation, route }: ScreenAdapterProps) {
  return <SmartAIScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'ai'} onNavigate={makeOnNavigate(navigation)} />;
}

function ActivityAdapter({ navigation, route }: ScreenAdapterProps) {
  return <ActivityScreen activeTab={SCREEN_TO_TAB[route.name] ?? 'activity'} onNavigate={makeOnNavigate(navigation)} />;
}

function ProfileAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <ProfileScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'profile'}
      onNavigate={makeOnNavigate(navigation)}
      onSignOut={() => {
        useAuthStore.getState().logout();
        navigation.replace('Auth');
      }}
    />
  );
}

// ── Stack adapters ────────────────────────────────────────────────────────────

async function tryAutoRegister(): Promise<boolean> {
  try {
    // Attempt to use stable Android hardware ID; falls back to MMKV UUID
    const deviceId = await enrichDeviceId().catch(() => getOrCreateDeviceId());
    const { language } = useSettingsStore.getState();
    const entitlement = await registerDevice(deviceId, 'android', { language });
    useAuthStore.getState().loginWithDevice(entitlement);
    // Bootstrap server from registration response → import into server list
    if (entitlement.server?.uuid && entitlement.server?.address) {
      const { importFromVless } = useServerStore.getState();
      const vless = `vless://${entitlement.server.uuid}@${entitlement.server.address}:${entitlement.server.port}` +
        `?security=reality&encryption=none&pbk=${entitlement.server.publicKey}` +
        `&sid=${entitlement.server.shortId}&sni=${entitlement.server.sni}` +
        `&flow=${entitlement.server.flow}&fp=${entitlement.server.fingerprint}&type=tcp#SetaLink-Auto`;
      importFromVless(vless);
    }
    return true;
  } catch {
    return false;
  }
}

function SplashAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <SplashScreen
      onFinish={async () => {
        const result = await runBootSequence();
        const { hasOnboarded, hasSelectedLanguage, hasSeenWelcome } = useSettingsStore.getState();

        if (!hasSelectedLanguage) {
          navigation.replace('Language');
          return;
        }

        if (!hasOnboarded) {
          navigation.replace('Onboarding');
          return;
        }

        if (result.status === 'auth_required') {
          const registered = await tryAutoRegister();
          if (registered) {
            navigation.replace('Welcome');
          } else {
            navigation.replace('Auth');
          }
          return;
        }

        // Already authenticated
        if (!hasSeenWelcome) {
          navigation.replace('Welcome');
          return;
        }

        navigation.replace('Main');

        if (result.shouldAutoConnect) {
          setTimeout(() => useVpnStore.getState().connect(), 600);
        }
      }}
    />
  );
}

function WelcomeAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <WelcomeScreen
      onStart={() => {
        useSettingsStore.getState().markWelcomeSeen();
        navigation.replace('Main');
      }}
    />
  );
}

function LanguageAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <LanguageScreen
      onSelect={() => {
        const { hasOnboarded } = useSettingsStore.getState();
        navigation.replace(hasOnboarded ? 'Main' : 'Onboarding');
      }}
    />
  );
}

function OnboardingAdapter({ navigation }: ScreenAdapterProps) {
  const { completeOnboarding } = useSettingsStore();
  return (
    <OnboardingScreen
      onFinish={async () => {
        completeOnboarding();
        if (useAuthStore.getState().isAuthenticated) {
          navigation.replace('Main');
        } else {
          const registered = await tryAutoRegister();
          navigation.replace(registered ? 'Welcome' : 'Auth');
        }
      }}
    />
  );
}

function AuthAdapter({ navigation }: ScreenAdapterProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) navigation.replace('Main');
  }, [isAuthenticated]);

  if (isAuthenticated) return null;
  return <AuthScreen onAuth={() => navigation.replace('Main')} />;
}

// ── Deep link handler — must be inside NavigationContainer ───────────────────

function DeepLinkHandler() {
  const navigation = useNavigation();
  useDeepLinks(navigation);
  return null;
}

// ── Root navigator ────────────────────────────────────────────────────────────

export function AppNavigator() {
  return (
    <NavigationContainer>
      <DeepLinkHandler />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Splash"      component={SplashAdapter} />
        <Stack.Screen name="Language"    component={LanguageAdapter} />
        <Stack.Screen name="Onboarding"  component={OnboardingAdapter} />
        <Stack.Screen name="Auth"        component={AuthAdapter} />
        <Stack.Screen name="Welcome"     component={WelcomeAdapter} />
        <Stack.Screen name="Main"        component={MainTabs} />
        <Stack.Screen
          name="Settings"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <SettingsScreen
              onBack={() => navigation.goBack()}
              onProfileImport={() => navigation.navigate('ProfileImport')}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Diagnostics"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <DiagnosticsScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="Upgrade"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        >
          {({ navigation }) => (
            <UpgradeScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="ProfileImport"
          options={{ animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <ProfileImportScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
      <Toast />
    </NavigationContainer>
  );
}
