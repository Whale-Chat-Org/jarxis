import { randomBytes } from 'node:crypto';
import { test as base } from '@playwright/test';

// The test server explicitly enables TRUST_PROXY. Both request and browser
// contexts receive the same per-test synthetic IP; no shared Redis clearing.
export const test = base.extend({
  extraHTTPHeaders: async ({ baseURL }, provide) => {
    const bytes = randomBytes(3);
    await provide({
      Origin: new URL(baseURL!).origin,
      'X-Real-IP': `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`,
    });
  },
});
