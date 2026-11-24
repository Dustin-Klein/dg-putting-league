const nextJest = require('next/jest');

// Integration tests run against a local Supabase stack (`supabase start`):
// - client-lockdown: only the public (publishable) key, i.e. what an attacker holding
//   that key can and can't do.
// - *.db.int.test.ts: services and repositories against real Postgres as the
//   app_server role, including concurrency tests.
// Run with `npm run test:int`.
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  displayName: 'integration',
  testEnvironment: 'node',
  roots: ['<rootDir>/integration'],
  testMatch: ['**/*.int.test.ts'],
  globalSetup: '<rootDir>/integration/db/global-setup.ts',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^server-only$': '<rootDir>/lib/services/__tests__/__mocks__/server-only.ts',
  },
  testTimeout: 60000,
};

module.exports = async () => {
  const resolved = await createJestConfig(config)();
  // postgres v4 is ESM-only and Jest's require can't load it, so let SWC compile it to CJS.
  // next/jest only allows appending ignore patterns, so postgres is added to its node_modules allowlist.
  const [nodeModules, ...rest] = resolved.transformIgnorePatterns;
  if (!nodeModules.startsWith('/node_modules/(?!.pnpm)(?!(')) {
    throw new Error(`Unexpected next/jest transformIgnorePatterns: ${nodeModules}`);
  }
  resolved.transformIgnorePatterns = [
    nodeModules.replace('(?!(', '(?!(postgres|'),
    ...rest,
  ];
  return resolved;
};
