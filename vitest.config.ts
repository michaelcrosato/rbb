import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/server/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      enabled: !!process.env.CI,
      include: ['src/**/*.ts', 'server/**/*.ts', 'api/**/*.ts'],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
    },
  },
});
