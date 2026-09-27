import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const databaseURL = process.env.DATABASE_URL;
if (
  !databaseURL?.includes('jarxis_test') ||
  !/^\/jarxis_test(?:_[a-z0-9]+)*$/.test(new URL(databaseURL).pathname)
) {
  throw new Error(
    'Acceptance tests require DATABASE_URL pointing to the dedicated jarxis_test database',
  );
}
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
export default defineConfig({
  testDir: './tests/e2e',
  reporter: [['list'], ['html', { open: 'never' }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  globalTimeout: 600_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL: databaseURL, BETTER_AUTH_URL: baseURL, TRUST_PROXY: 'true' },
  },
});
