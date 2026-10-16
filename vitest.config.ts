import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  'server-only': fileURLToPath(new URL('./tests/server-only.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Server and library code runs in Node; React components (`*.test.tsx`) run in jsdom.
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup-dom.ts'],
        },
      },
    ],
    // Enabled with --coverage in CI; lcov.info feeds SonarQube. The run fails below 80%.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
