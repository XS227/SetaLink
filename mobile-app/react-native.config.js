module.exports = {
  project: {
    android: {
      packageName: 'com.setalink',
    },
  },
  dependencies: {
    // react-native-network-info 5.x is pre-autolinking-era and ships Java
    // that doesn't compile cleanly under AGP 8.3 / compileSdk 34.
    // Disable native autolinking; the JS side uses a try/catch require().
    'react-native-network-info': {
      platforms: {
        android: null,
      },
    },
  },
};
