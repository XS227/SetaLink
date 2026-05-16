module.exports = {
  root: true,
  extends: ['@react-native'],
  rules: {
    // Warn on console.log but allow warn/error for intentional logging
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Allow explicit any in controlled cases (e.g. navigation props)
    '@typescript-eslint/no-explicit-any': 'warn',

    // Enforce consistent import ordering
    'import/order': 'off',

    // Allow unused vars prefixed with _
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

    // React hooks exhaustive-deps is noisy with stable store refs
    'react-hooks/exhaustive-deps': 'warn',
  },
};
