import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'apps/console/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/main.ts', 'apps/console/server.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
