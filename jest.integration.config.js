const nextJest = require('next/jest');

// Integration tests run against a local Supabase stack (`supabase start`) and use
// only the public (publishable) key: they check what an attacker holding that key
// can and can't do. Run with `npm run test:int`.
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  displayName: 'integration',
  testEnvironment: 'node',
  roots: ['<rootDir>/integration'],
  testMatch: ['**/*.int.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testTimeout: 20000,
};

module.exports = createJestConfig(config);
