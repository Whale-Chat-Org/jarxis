import { randomBytes } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, verify } from './helpers';

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
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
  const footer = frame.locator('[data-slot="admin-panel-footer"]');
  await expect(footer).toBeVisible();
  const bottom = await footer.boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(height + 1);
  await expect(frame.locator('[data-slot="admin-panel-scroll-area"]')).toBeVisible();
}

test('role create, view and edit share the frame in both themes at six viewports', async ({
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
  for (const theme of ['light', 'dark'])
    for (const [width, height] of sizes) {
      const ip = randomBytes(3);
      await page.setExtraHTTPHeaders({
        Origin: baseURL!,
        'X-Real-IP': `10.${ip[0]}.${ip[1]}.${ip[2]}`,
      });
      await page.setViewportSize({ width, height });
      await page.goto('/admin/roles');
      await page.evaluate((value) => localStorage.setItem('theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      await page.getByRole('button', { name: 'Create role', exact: true }).click();
      const create = panel(page, 'Create role');
      await bounded(create, width, height);
      await create.getByLabel('Name', { exact: true }).fill('Unsaved role');
      await expect(create.getByRole('button', { name: 'Save role', exact: true })).toBeEnabled();
      await page.screenshot({ path: `test-results/unified-role-${theme}-${width}-create.png` });
      await create.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(create).toBeHidden();
      await page.getByRole('button', { name: 'Owner', exact: true }).click();
      const view = panel(page, 'Owner');
      await bounded(view, width, height);
      await expect(view.getByLabel('Name', { exact: true })).toBeDisabled();
      await view.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(view).toBeHidden();
      await page.getByRole('button', { name: 'Viewer', exact: true }).click();
      const edit = panel(page, 'Edit role');
      await bounded(edit, width, height);
      await edit.getByLabel('Description', { exact: true }).fill('Unsaved role draft');
      await expect(edit.getByRole('button', { name: 'Save role', exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/unified-role-${theme}-${width}-edit.png` });
      await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(edit).toBeHidden();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
    }
});
