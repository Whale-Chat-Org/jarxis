import { test } from './fixtures';
import { expect } from '@playwright/test';
import { login, makeOwner, register, setRole, verify } from './helpers';

/**
 * Acceptance coverage for the administration area after the Better Auth admin plugin migration:
 * the shadcn `Sidebar` shell, the registry `AdminUsers` table, and the read-only roles page.
 *
 * Role *editing* no longer exists — roles are declared in `src/lib/permissions.ts` — so the
 * previous `/api/v1/roles` CRUD assertions are gone. Owner/last-owner enforcement lives in
 * `src/lib/auth/admin-guards.ts` and is covered by tests/integration/security.test.ts.
 */
test('owner browses the admin shell, user management and the role catalog', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { email, id } = await register(request, baseURL!);
  await verify(request, email, baseURL!);
  await makeOwner(id);
  await login(request, email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');

  // The shadcn Sidebar shell: the rail, the inset header trigger and the footer account menu.
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('[data-slot="sidebar-footer"]')).toBeVisible();
  // The SidebarInset header trigger, not the SidebarRail resize affordance: both share the
  // same accessible name, and the rail is also visible at this desktop viewport width.
  const sidebarTrigger = page.getByRole('main').getByRole('button', { name: 'Toggle Sidebar' });
  await expect(sidebarTrigger).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Collapsing to the icon rail is a property of the primitive, not of local markup.
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute(
    'data-state',
    'expanded',
  );
  await sidebarTrigger.click();
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute(
    'data-state',
    'collapsed',
  );
  await sidebarTrigger.click();
  await expect(page.locator('[data-slot="sidebar-wrapper"]')).toHaveAttribute(
    'data-state',
    'expanded',
  );

  // The registry table renders through the admin plugin's own endpoints.
  await sidebar.getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/admin\/users(?:\?|$)/);
  await expect(page.getByRole('table')).toBeVisible();
  for (const column of ['Name', 'Role', 'Status', 'Created']) {
    await expect(page.getByRole('columnheader', { name: column })).toBeVisible();
  }
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.filter({ hasText: email })).toHaveCount(1);

  // Search narrows the table through a server round trip.
  await page.getByRole('textbox', { name: 'Search by email' }).fill(email);
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: email })).toHaveCount(1);

  // Roles are code-declared and the page is read-only.
  await sidebar.getByRole('link', { name: 'Roles' }).click();
  await expect(page).toHaveURL(/\/admin\/roles(?:\?|$)/);
  for (const role of ['Owner', 'Administrator', 'Viewer', 'User']) {
    await expect(page.getByText(role, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /create role/i })).toHaveCount(0);

  // Permissions documents both catalogues.
  await sidebar.getByRole('link', { name: 'Permissions' }).click();
  await expect(page).toHaveURL(/\/admin\/permissions(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Application' })).toBeVisible();

  // No horizontal overflow at a laptop width.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
});

test('a viewer gets a read-only user table', async ({ page, context, request, baseURL }) => {
  const { email, id } = await register(request, baseURL!);
  await verify(request, email, baseURL!);
  await setRole(id, 'viewer');
  await login(request, email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: email })).toHaveCount(1);
  // `user:create` is owner/administrator only, so the control is absent for a viewer.
  await expect(page.getByRole('button', { name: 'Create user' })).toHaveCount(0);
});

test('the sidebar collapses into a sheet on a narrow viewport', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { email, id } = await register(request, baseURL!);
  await verify(request, email, baseURL!);
  await makeOwner(id);
  await login(request, email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');

  // The primitive renders the mobile rail inside a Sheet, which the trigger opens.
  await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/admin\/users(?:\?|$)/);
  // The primitive does not auto-close the mobile sheet on navigation; only its own trigger does.
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await expect(sheet).toBeHidden();
});
