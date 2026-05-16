module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
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
  testMatch: ['**/__tests__/**/*.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
