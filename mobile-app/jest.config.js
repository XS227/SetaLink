module.exports = {
  preset: 'react-native',
  // This box is single-core, ~1GB total RAM, already carrying other live
  // services (calling-relay, nginx, etc.) — jest's default worker pool
  // has OOM'd the full 37-file suite outright on at least two separate
  // sessions now (never a single runaway test, just heap growing across
  // the whole run with nothing recycling it). maxWorkers:1 means no
  // parallelism is lost anyway (nothing to parallelize across on 1 CPU);
  // workerIdleMemoryLimit forces jest to recycle that one worker process
  // between test files once it grows past the cap, instead of letting
  // 37 files' worth of retained RN/Babel transform state pile up in a
  // single process until the box runs out of memory.
  maxWorkers: 1,
  workerIdleMemoryLimit: '450MB',
  moduleNameMapper: {
    '^@stores/(.*)$':  '<rootDir>/src/stores/$1',
    '^@hooks/(.*)$':   '<rootDir>/src/hooks/$1',
    '^@screens/(.*)$': '<rootDir>/src/screens/$1',
    '^@services/(.*)$':'<rootDir>/src/services/$1',
    '^@design/(.*)$':  '<rootDir>/src/design/$1',
    '^@utils/(.*)$':   '<rootDir>/src/utils/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|zustand|react-native-mmkv|react-native-haptic-feedback|react-native-incall-manager)/)',
  ],
  testMatch: ['**/__tests__/**/*.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
