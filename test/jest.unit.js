/** @type {import('jest').Config} */
module.exports = {
  displayName: 'unit',
  testEnvironment: 'node',
  rootDir: '../',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
};
