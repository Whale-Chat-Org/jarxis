import { defineConfig } from '@playwright/test';

// Client-only demo checks: no migrations, seeds, sign-in, or database fixtures.
export default defineConfig({
  testDir: './tests/chat',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3020',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm start --port 3020',
    url: 'http://127.0.0.1:3020/chat',
    reuseExistingServer: false,
    env: {
      // Unreachable disposable target makes accidental database use fail instead of touching local data.
      DATABASE_URL: 'postgresql://chat:chat@127.0.0.1:9/jarxis_test_chat',
      BETTER_AUTH_URL: 'http://127.0.0.1:3020',
    },
  },
});
