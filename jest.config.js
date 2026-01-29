/** @type {import('jest').Config} */
module.exports = {
  projects: [
    // Backend tests (services, repositories)
    {
      displayName: 'backend',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/lib'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': 'ts-jest',
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
        '^server-only$': '<rootDir>/lib/services/__tests__/__mocks__/server-only.ts',
      },
    },
    // Frontend component tests
    {
      displayName: 'frontend',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/components', '<rootDir>/app'],
      testMatch: ['**/__tests__/**/*.test.tsx'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
      },
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'components/**/*.tsx',
    'app/**/*.tsx',
    '!lib/**/*.d.ts',
    '!lib/__tests__/**',
    '!**/__tests__/**',
  ],
};
