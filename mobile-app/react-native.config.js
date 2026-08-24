module.exports = {
  project: {
    android: {
      packageName: 'com.setalink',
    },
    ios: {},
    // Windows (RealGram desktop, chat-only — no calling/ads, see the
    // windows:null dependency overrides below). Scaffolded via
    // `npx react-native-windows-init --version 0.75.4 --namespace SetaLink`.
    windows: {
      sourceDir: 'windows',
      solutionFile: 'setalink.sln',
      project: {
        projectFile: 'setalink/setalink.vcxproj',
      },
    },
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
        // No Windows implementation either; same try/catch require() fallback.
        windows: null,
      },
    },
    // None of these have a react-native-windows implementation. RealGram for
    // Windows is chat-only (calling/ads/live-TV are gated off in JS — see
    // adsService.ts, TrackedBannerAd.tsx, featureFlags.ts, AppNavigator.tsx),
    // so there's nothing on Windows for autolink-windows to link here.
    'react-native-webrtc': { platforms: { windows: null } },
    'react-native-incall-manager': { platforms: { windows: null } },
    'react-native-google-mobile-ads': { platforms: { windows: null } },
    'react-native-orientation-locker': { platforms: { windows: null } },
    'react-native-video': { platforms: { windows: null } },
    'react-native-keep-awake': { platforms: { windows: null } },
  },
};
