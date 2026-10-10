import { expect } from '@playwright/test';
import { test } from './fixtures';
import { login, register, verify } from './helpers';

const viewports = [
  [375, 667],
  [440, 956],
  [768, 1024],
  [960, 1440],
  [1280, 800],
  [1440, 900],
];
test('OAuth endpoints return 404 for both anonymous and signed-in requests', async ({
  request,
  baseURL,
}) => {
  const check = async () => {
    for (const path of [
      'sign-in/social',
      'link-social',
      'unlink-account',
      'get-access-token',
      'refresh-token',
      'account-info',
      'callback/google',
    ]) {
      for (const method of ['get', 'post'] as const)
        expect((await request[method](`/api/auth/${path}`)).status()).toBe(404);
    }
  };
  await check();
  const account = await register(request, baseURL!);
  await verify(request, account.email, baseURL!);
  await login(request, account.email, baseURL!);
  await check();
});

test('password authentication and security settings fit all required viewports without social controls', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      for (const path of ['sign-in', 'sign-up']) {
        await page.goto(`/auth/${path}`);
        await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
        await expect(page.locator('input[name="password"]:visible').first()).toBeVisible();
        await expect(
          page.getByRole('button', { name: /continue with|sign in with|sign up with/i }),
        ).toHaveCount(0);
        const submit = page.getByRole('button', {
          name: path === 'sign-in' ? 'Sign In' : 'Sign Up',
          exact: true,
        });
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await page.screenshot({
          path: `/tmp/jarxis-${path}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    }
  }
  const account = await register(request, baseURL!);
  await verify(request, account.email, baseURL!);
  await login(request, account.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto('/settings/security');
      await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
      await expect(page.getByText(/linked accounts/i)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await page.screenshot({ path: `/tmp/jarxis-security-${theme}-${width}.png`, fullPage: true });
    }
  }
});
