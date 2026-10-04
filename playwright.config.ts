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
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'pnpm dev:next';
// The app sends mail to a local Brevo stub so acceptance runs never deliver real email.
const brevoStubURL = process.env.BREVO_STUB_URL ?? 'http://127.0.0.1:4010';
process.env.BREVO_STUB_URL = brevoStubURL;
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
  webServer: [
    {
      command: 'pnpm exec tsx tests/e2e/brevo-stub.ts',
      url: brevoStubURL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: webServerCommand,
      url: baseURL,
      // Never send setup/account mutations to a reused development server with another database.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseURL,
        BETTER_AUTH_URL: baseURL,
        TRUST_PROXY: 'true',
        BREVO_API_KEY: 'e2e-stub-key',
        BREVO_API_URL: brevoStubURL,
        MAIL_FROM: 'Jarxis <noreply@example.test>',
        AZURE_STORAGE_CONNECTION_STRING:
          process.env.AZURE_STORAGE_CONNECTION_STRING ?? 'UseDevelopmentStorage=true',
        AZURE_STORAGE_CONTAINER: process.env.AZURE_STORAGE_CONTAINER ?? 'profile-photos-e2e',
        PORT: new URL(baseURL).port || '3000',
      },
    },
  ],
});
