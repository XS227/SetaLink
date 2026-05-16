/**
 * AppNavigator — React Navigation v7
 *
 * Architecture:
 *   NavigationContainer
 *   └── RootStack (NativeStack, animation: fade)
 *       ├── Splash  → replace → Auth
 *       ├── Auth    → replace → Main
 *       ├── Main    → BottomTabs (custom BottomNav component)
 *       │   ├── Home, Servers, AI, Activity, Profile
 *       ├── Settings    (slide_from_right)
 *       └── Diagnostics (slide_from_right)
 *
 * Adapter pattern: existing screens expose { onNavigate, activeTab } props.
 * Adapters translate React Navigation props to that legacy interface so no
 * screen file needs modification in this phase.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';

import { SplashScreen }      from '../screens/SplashScreen';
import { AuthScreen }        from '../screens/AuthScreen';
import { HomeScreen }        from '../screens/HomeScreen';
import { ServersScreen }     from '../screens/ServersScreen';
import { SmartAIScreen }     from '../screens/SmartAIScreen';
import { ActivityScreen }    from '../screens/ActivityScreen';
import { ProfileScreen }     from '../screens/ProfileScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { BottomNav, NavTab } from '../components/BottomNav';

import type { RootStackParamList, MainTabParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<MainTabParamList>();

// Map React Navigation tab screen names → legacy NavTab strings
const SCREEN_TO_TAB: Record<string, NavTab> = {
  Home:     'home',
  Servers:  'servers',
  AI:       'ai',
  Activity: 'activity',
  Profile:  'profile',
};

// Reverse map for navigation.navigate() calls
const TAB_TO_SCREEN: Record<NavTab, keyof MainTabParamList> = {
  home:     'Home',
  servers:  'Servers',
  ai:       'AI',
  activity: 'Activity',
  profile:  'Profile',
};

// ── Shared adapter helpers ─────────────────────────────────────────────────

type ScreenAdapterProps = { navigation: any; route: any };

function makeOnNavigate(navigation: any): (tab: NavTab) => void {
  return (tab) => {
    // Settings / Diagnostics are stack screens, not tabs
    if ((tab as string) === 'settings')     { navigation.navigate('Settings');    return; }
    if ((tab as string) === 'diagnostics')  { navigation.navigate('Diagnostics'); return; }
    navigation.navigate(TAB_TO_SCREEN[tab] ?? 'Home');
  };
}

// ── Main tab shell ─────────────────────────────────────────────────────────

function MainTabs() {
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

// ── Tab adapters ───────────────────────────────────────────────────────────

function HomeAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <HomeScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'home'}
      onNavigate={makeOnNavigate(navigation)}
    />
  );
}

function ServersAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <ServersScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'servers'}
      onNavigate={makeOnNavigate(navigation)}
    />
  );
}

function AIAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <SmartAIScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'ai'}
      onNavigate={makeOnNavigate(navigation)}
    />
  );
}

function ActivityAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <ActivityScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'activity'}
      onNavigate={makeOnNavigate(navigation)}
    />
  );
}

function ProfileAdapter({ navigation, route }: ScreenAdapterProps) {
  return (
    <ProfileScreen
      activeTab={SCREEN_TO_TAB[route.name] ?? 'profile'}
      onNavigate={makeOnNavigate(navigation)}
    />
  );
}

// ── Stack adapters ─────────────────────────────────────────────────────────

function SplashAdapter({ navigation }: ScreenAdapterProps) {
  return <SplashScreen onFinish={() => navigation.replace('Auth')} />;
}

function AuthAdapter({ navigation }: ScreenAdapterProps) {
  return <AuthScreen onAuth={() => navigation.replace('Main')} />;
}

// ── Root navigator ─────────────────────────────────────────────────────────

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Splash"      component={SplashAdapter} />
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
