module.exports = {
  project: {
    android: {
      packageName: 'com.setalink',
    },
    ios: {},
  },
  // RealGram gold/silver theme typefaces (Space Grotesk, JetBrains Mono,
  // Vazirmatn) — linked via `npx react-native-asset`, which writes into
  // android/app/src/main/assets/fonts/ and ios/SetaLink/Info.plist's
  // UIAppFonts + the Xcode project's Copy Bundle Resources phase.
  assets: ['./assets/fonts/'],
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
