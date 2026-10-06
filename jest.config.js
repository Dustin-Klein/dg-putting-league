const nextJest = require('next/jest');

// next/jest compiles tests with SWC, so the test stack doesn't load the
// TypeScript compiler API. Type safety for tests comes from `npm run type-check`.
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const backendConfig = {
  displayName: 'backend',
  testEnvironment: 'node',
  roots: ['<rootDir>/lib'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^server-only$': '<rootDir>/lib/services/__tests__/__mocks__/server-only.ts',
  },
};

/** @type {import('jest').Config} */
const frontendConfig = {
  displayName: 'frontend',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/components', '<rootDir>/app'],
  testMatch: ['**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

module.exports = async () => ({
  // next/jest only applies its transform to the config it wraps, not to
  // nested projects, so each project is wrapped individually.
  projects: [
    await createJestConfig(backendConfig)(),
    await createJestConfig(frontendConfig)(),
  ],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'components/**/*.tsx',
    'app/**/*.tsx',
    '!lib/**/*.d.ts',
    '!lib/__tests__/**',
    '!**/__tests__/**',
  ],
});
