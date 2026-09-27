import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';
export default mergeConfig(
  { ...base, test: {} },
  defineConfig({
    test: {
      include: ['tests/integration/**/*.test.ts'],
      fileParallelism: false,
      testTimeout: 30000,
      hookTimeout: 30000,
      setupFiles: ['./tests/integration/setup.ts'],
    },
  }),
);
