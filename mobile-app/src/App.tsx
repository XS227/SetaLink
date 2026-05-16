import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider }       from 'react-native-safe-area-context';
import { ThemeProvider }          from './theme';
import { AppNavigator }           from './navigation/AppNavigator';
import { Colors }                 from './design/tokens';

export default function App() {
  return (
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
  );
}
