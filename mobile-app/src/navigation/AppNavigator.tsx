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

import React from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';

import { SplashScreen }      from '../screens/SplashScreen';
import { OnboardingScreen }  from '../screens/OnboardingScreen';
import { AuthScreen }        from '../screens/AuthScreen';
import { HomeScreen }        from '../screens/HomeScreen';
import { ServersScreen }     from '../screens/ServersScreen';
import { SmartAIScreen }     from '../screens/SmartAIScreen';
import { ActivityScreen }    from '../screens/ActivityScreen';
import { ProfileScreen }     from '../screens/ProfileScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { BottomNav, NavTab } from '../components/BottomNav';
import { Toast }             from '../components/Toast';
import { UpgradeScreen }     from '../screens/UpgradeScreen';

import { runBootSequence }   from '../services/bootService';
import { useAuthStore }      from '../stores/authStore';
import { useSettingsStore }  from '../stores/settingsStore';
import { useVpnStore }       from '../stores/vpnStore';
import { useAppBoot }        from '../hooks/useAppBoot';
import { useDeepLinks }      from '../hooks/useDeepLinks';

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
    if ((tab as string) === 'settings')    { navigation.navigate('Settings');    return; }
    if ((tab as string) === 'diagnostics') { navigation.navigate('Diagnostics'); return; }
    if ((tab as string) === 'upgrade')     { navigation.navigate('Upgrade');     return; }
    navigation.navigate(TAB_TO_SCREEN[tab] ?? 'Home');
  };
}

// ── Main tab shell with AppState lifecycle ────────────────────────────────────

function MainTabs() {
  useAppBoot(); // registers AppState listener for kill-switch / reconnect logic

  return (
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

function SplashAdapter({ navigation }: ScreenAdapterProps) {
  return (
    <SplashScreen
      onFinish={async () => {
        const result = await runBootSequence();
        const { hasOnboarded } = useSettingsStore.getState();

        if (!hasOnboarded) {
          navigation.replace('Onboarding');
          return;
        }

        if (result.status === 'auth_required') {
          navigation.replace('Auth');
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

function OnboardingAdapter({ navigation }: ScreenAdapterProps) {
  const { completeOnboarding } = useSettingsStore();
  return (
    <OnboardingScreen
      onFinish={() => {
        completeOnboarding();
        if (useAuthStore.getState().isAuthenticated) {
          navigation.replace('Main');
        } else {
          navigation.replace('Auth');
        }
      }}
    />
  );
}

function AuthAdapter({ navigation }: ScreenAdapterProps) {
  if (useAuthStore.getState().isAuthenticated) {
    navigation.replace('Main');
    return null;
  }
  return (
    <AuthScreen
      onAuth={() => navigation.replace('Main')}
    />
  );
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
        <Stack.Screen name="Onboarding"  component={OnboardingAdapter} />
        <Stack.Screen name="Auth"        component={AuthAdapter} />
        <Stack.Screen name="Main"        component={MainTabs} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen as any}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Diagnostics"
          component={DiagnosticsScreen as any}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Upgrade"
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        >
          {({ navigation }) => (
            <UpgradeScreen onBack={() => navigation.goBack()} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
      <Toast />
    </NavigationContainer>
  );
}
