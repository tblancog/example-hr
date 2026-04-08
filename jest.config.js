/** @type {import('jest').Config} */
module.exports = {
  // Coverage thresholds enforced on every `pnpm test:coverage` run.
  // Failing below these values fails the CI build.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 75,
      functions: 85,
      lines: 85,
    },
  },
};
