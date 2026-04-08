/** @type {import('jest').Config} */
module.exports = {
  displayName: 'e2e',
  testEnvironment: 'node',
  rootDir: '../',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
};
