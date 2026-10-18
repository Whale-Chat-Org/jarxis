import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, verify } from './helpers';
const endpoint = '/api/admin/providers/keys';
const sizes = [
  [375, 667],
  [440, 956],
  [768, 1024],
  [960, 1440],
  [1280, 800],
  [1440, 900],
] as const;
const panel = (page: Page, title: string) =>
  page
    .locator('[data-slot="admin-panel"]:visible')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
async function bounded(frame: Locator, width: number, height: number) {
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-layout', 'inspector');
  await expect(frame).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  const box = (await frame.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  const footer = frame.locator('[data-slot="admin-panel-footer"]');
  await expect(footer).toBeVisible();
  expect(
    (await footer.boundingBox())!.y + (await footer.boundingBox())!.height,
  ).toBeLessThanOrEqual(height + 1);
}
test('API Keys create, copy, rename and revoke retain metadata and clear the secret', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  await login(request, owner.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/api-keys');
  await page.getByRole('button', { name: 'Create API key', exact: true }).click();
  const create = panel(page, 'Create API key');
  await create.getByLabel('Name', { exact: true }).fill('E2E deployment');
  await create.getByLabel('Name', { exact: true }).press('Enter');
  const issued = panel(page, 'Save your API key');
  await expect(issued).toBeVisible();
  const secret = await issued.getByLabel('API key', { exact: true }).inputValue();
  expect(secret.length).toBeGreaterThan(20);
  await issued.getByRole('button', { name: 'Copy key' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  await issued.getByRole('button', { name: 'Done' }).click();
  await expect(issued).toBeHidden();
  await page.getByRole('button', { name: 'E2E deployment', exact: true }).click();
  const view = panel(page, 'E2E deployment');
  await expect(view).toBeVisible();
  await expect(view.getByLabel('API key', { exact: true })).toHaveCount(0);
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = panel(page, 'Edit API key');
  await edit.getByLabel('Name', { exact: true }).fill('E2E renamed');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  const renamed = panel(page, 'E2E renamed');
  await renamed.getByRole('button', { name: 'Revoke', exact: true }).click();
  const revoke = panel(page, 'Revoke API key?');
  await revoke.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(revoke).toBeHidden();
  await expect(renamed.getByText('Revoked', { exact: true }).first()).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await renamed.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'E2E renamed', exact: true })).toBeVisible();
  const denied = await request.get('/api/llm/v1/models', {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(denied.status()).toBe(401);
  await page.getByLabel('Search by name').fill('does-not-exist');
  await expect(page.getByText('No API keys found.')).toBeVisible();
  await page.getByLabel('Search by name').fill('E2E renamed');
  await expect(page.getByRole('button', { name: 'E2E renamed', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Active', exact: true }).click();
  await expect(page.getByText('No API keys found.')).toBeVisible();
  await page.goto('/admin/providers');
  await expect(page.getByText('Gateway keys', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Issue key' })).toHaveCount(0);
});
test('API Keys panels fit six viewports in light and dark themes', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.setTimeout(180000);
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  await login(request, owner.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);
  const created = await request.post(endpoint, { data: { name: 'Responsive API key' } });
  expect(created.status()).toBe(201);
  for (const theme of ['light', 'dark'])
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.goto('/admin/api-keys');
      await page.evaluate((value) => localStorage.setItem('theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await page.getByRole('button', { name: 'Create API key', exact: true }).click();
      const create = panel(page, 'Create API key');
      await bounded(create, width, height);
      await create.getByLabel('Name', { exact: true }).fill('Unsaved draft');
      await page.screenshot({ path: `test-results/api-keys-${theme}-${width}-create.png` });
      await create.getByRole('button', { name: 'Cancel' }).click();
      await expect(create).toBeHidden();
      await page.getByRole('button', { name: 'Responsive API key', exact: true }).click();
      const view = panel(page, 'Responsive API key');
      await bounded(view, width, height);
      await page.screenshot({ path: `test-results/api-keys-${theme}-${width}-view.png` });
      await view.getByRole('button', { name: 'Edit', exact: true }).click();
      const edit = panel(page, 'Edit API key');
      await bounded(edit, width, height);
      await edit.getByLabel('Name', { exact: true }).fill('Unsaved draft');
      await page.screenshot({ path: `test-results/api-keys-${theme}-${width}-edit.png` });
      await edit.getByRole('button', { name: 'Cancel' }).click();
      await expect(edit).toBeHidden();
      await view.getByRole('button', { name: 'Revoke', exact: true }).click();
      const revoke = panel(page, 'Revoke API key?');
      await bounded(revoke, width, height);
      await page.screenshot({ path: `test-results/api-keys-${theme}-${width}-revoke.png` });
      await revoke.getByRole('button', { name: 'Cancel' }).click();
      await expect(revoke).toBeHidden();
      await view.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(view).toBeHidden();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
    }
});
