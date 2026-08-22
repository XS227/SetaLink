import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider }       from 'react-native-safe-area-context';
import { ThemeProvider }          from './theme';
import { AppNavigator }           from './navigation/AppNavigator';
import { ErrorBoundary }          from './components/ErrorBoundary';
import { Colors }                 from './design/tokens';
import { useVpnStats }            from './hooks/useVpnStats';

export default function App() {
  // Runs the live traffic-byte poll for the app's whole lifetime, not just
  // while HomeScreen happens to be mounted — sessionBytes (and therefore
  // Activity's Total Data / Bandwidth chart) used to freeze the moment the
  // user navigated to any other tab, since the poll's setInterval lived
  // inside HomeScreen's own useVpnStats() call.
  useVpnStats();

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <StatusBar
              barStyle="light-content"
              backgroundColor={Colors.bg.void}
              translucent
            />
            <AppNavigator />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
