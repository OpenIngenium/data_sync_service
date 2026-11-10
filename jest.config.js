module.exports = {
  testEnvironment: 'node',

  testMatch: [
    '**/tests/unit/**/*.test.js',
  ],

  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/coverage/**',
    '!jest.config.js',
  ],

  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
  ],

  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'html',
  ],

  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      statements: 100,
      lines: 100,
    },
  },

  clearMocks: true,
  restoreMocks: true,
};
