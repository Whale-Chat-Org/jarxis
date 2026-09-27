import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { mailLink, newPassword, password, register } from './helpers';

async function signIn(page: Page, email: string, secret: string) {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(secret);
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/auth/sign-in/email') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
}

test('email links, browser login, access denial, forgot/reset password and logout', async ({
  page,
  request,
  baseURL,
}) => {
  const { email } = await register(request, baseURL!);
  await page.goto(await mailLink(request, email, 'Verify your Jarxis email', baseURL!));
  await signIn(page, email, password);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
  // Signed in but with no role: the admin plugin denies every administrative permission.
  const denied = await page.request.post('/api/auth/admin/has-permission', {
    data: { permissions: { user: ['list'] } },
  });
  expect(denied.ok()).toBeTruthy();
  expect((await denied.json()).success).toBe(false);

  await page.goto('/auth/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  const forgot = page.waitForResponse(
    (r) => r.url().includes('/api/auth/request-password-reset') && r.request().method() === 'POST',
  );
  await page.locator('button[type="submit"]').click();
  expect((await forgot).ok()).toBeTruthy();
  await page.goto(await mailLink(request, email, 'Reset your Jarxis password', baseURL!));
  await expect(page).toHaveURL(/\/auth\/reset-password\?.*token=/);
  // confirmPassword is not enabled in this app's emailAndPassword config (see
  // src/components/providers.tsx), so the reset form only renders a single password field.
  await page.locator('#password').fill(newPassword);
  const reset = page.waitForResponse(
    (r) => r.url().includes('/api/auth/reset-password') && r.request().method() === 'POST',
  );
  await page.locator('button[type="submit"]').click();
  expect((await reset).ok()).toBeTruthy();
  expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();
  await signIn(page, email, newPassword);
  await page.goto('/auth/sign-out');
  await expect(page).toHaveURL(/\/auth\/sign-in(?:\?|$)/);
  expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/auth\/sign-in(?:\?|$)/);
});
