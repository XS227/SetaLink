module.exports = {
  preset: 'react-native',
  setupFilesAfterFramework: ['@testing-library/react-native/extend-expect'],
  moduleNameMapper: {
    // Alias maps matching tsconfig paths
    '^@stores/(.*)$':  '<rootDir>/src/stores/$1',
    '^@hooks/(.*)$':   '<rootDir>/src/hooks/$1',
    '^@screens/(.*)$': '<rootDir>/src/screens/$1',
    '^@services/(.*)$':'<rootDir>/src/services/$1',
    '^@design/(.*)$':  '<rootDir>/src/design/$1',
    '^@utils/(.*)$':   '<rootDir>/src/utils/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|zustand|react-native-mmkv|react-native-haptic-feedback)/)',
  ],
  testPathPattern: '__tests__',
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
