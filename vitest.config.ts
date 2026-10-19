import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // The web app's page and worker entry are browser-only wiring (src/web/main.ts,
      // src/web/worker.ts), checked in a browser; what they call is tested.
      exclude: ['src/**/*.test.ts', 'src/web/main.ts', 'src/web/worker.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
