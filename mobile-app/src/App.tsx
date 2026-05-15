import React from 'react';
import { StatusBar, SafeAreaView, StyleSheet } from 'react-native';
import { AppNavigator } from './navigation/AppNavigator';
import { Colors } from './design/tokens';

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={Colors.bg.void}
        translucent
      />
      <AppNavigator />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg.void,
  },
});
