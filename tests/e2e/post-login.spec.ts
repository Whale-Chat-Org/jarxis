import { expect } from '@playwright/test';

import { test } from './fixtures';
import { mailLink, password, register, setRole } from './helpers';

test('post-login redirect requires a live session', async ({ page }) => {
  await page.goto('/auth/post-login');
  await expect(page).toHaveURL(/\/auth\/sign-in(?:\?|$)/);
});

for (const role of ['user', 'viewer', 'administrator', 'owner']) {
  test(`${role} login uses its permitted default destination`, async ({
    page,
    request,
    baseURL,
  }) => {
    const { email, id } = await register(request, baseURL!);
    await page.goto(await mailLink(request, email, 'Verify your Jarxis email', baseURL!));
    if (role !== 'user') await setRole(id, role);

    await page.goto('/auth/sign-in');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(new URL(role === 'user' ? '/' : '/admin', baseURL!).href);

    if (role === 'user') {
      await page.getByRole('button', { name: /Acceptance User/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Administration' })).toHaveCount(0);
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
    }
  });
}

test('explicit account-settings redirect is preserved', async ({ page, request, baseURL }) => {
  const { email } = await register(request, baseURL!);
  await page.goto(await mailLink(request, email, 'Verify your Jarxis email', baseURL!));
  await page.goto('/auth/sign-in?redirectTo=%2Fsettings%2Faccount');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(new URL('/settings/account', baseURL!).href);
});
