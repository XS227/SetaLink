/**
 * AppNavigator
 *
 * In production: use React Navigation v7 with Stack + BottomTab navigators.
 * This file shows the intended navigation architecture with a lightweight
 * state-machine approach so the design is runnable without the full nav library.
 *
 * Navigation tree:
 *
 *   RootStack
 *   ├── Splash          (auto-dismissed after animation)
 *   ├── Auth            (login / register)
 *   └── Main (tabs)
 *       ├── Home
 *       ├── Servers
 *       ├── SmartAI
 *       ├── Activity
 *       └── Profile
 *           └── Settings  (pushed from Profile / nav)
 *           └── Diagnostics (pushed from Settings / Home)
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { SplashScreen }      from '../screens/SplashScreen';
import { AuthScreen }        from '../screens/AuthScreen';
import { HomeScreen }        from '../screens/HomeScreen';
import { ServersScreen }     from '../screens/ServersScreen';
import { SmartAIScreen }     from '../screens/SmartAIScreen';
import { ActivityScreen }    from '../screens/ActivityScreen';
import { ProfileScreen }     from '../screens/ProfileScreen';
import { SettingsScreen }    from '../screens/SettingsScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { NavTab }            from '../components/BottomNav';

type RootScreen = 'splash' | 'auth' | 'main' | 'settings' | 'diagnostics';

export function AppNavigator() {
  const [root, setRoot]     = useState<RootScreen>('splash');
  const [tab, setTab]       = useState<NavTab>('home');

  const navigate = (screen: RootScreen) => setRoot(screen);

  if (root === 'splash') {
    return <SplashScreen onFinish={() => navigate('auth')} />;
  }

  if (root === 'auth') {
    return <AuthScreen onAuth={() => navigate('main')} />;
  }

  if (root === 'settings') {
    return (
      <View style={styles.full}>
        <SettingsScreen />
      </View>
    );
  }

  if (root === 'diagnostics') {
    return (
      <View style={styles.full}>
        <DiagnosticsScreen />
      </View>
    );
  }

  // Main tab shell
  return (
    <View style={styles.full}>
      {tab === 'home' && (
        <HomeScreen onNavigate={t => {
          // Settings and Diagnostics navigate as stack pushes
          if ((t as string) === 'settings')     { navigate('settings'); return; }
          if ((t as string) === 'diagnostics')  { navigate('diagnostics'); return; }
          setTab(t);
        }} activeTab={tab} />
      )}
      {tab === 'servers' && (
        <ServersScreen onNavigate={setTab} activeTab={tab} />
      )}
      {tab === 'ai' && (
        <SmartAIScreen onNavigate={setTab} activeTab={tab} />
      )}
      {tab === 'activity' && (
        <ActivityScreen onNavigate={setTab} activeTab={tab} />
      )}
      {tab === 'profile' && (
        <ProfileScreen onNavigate={setTab} activeTab={tab} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
});
