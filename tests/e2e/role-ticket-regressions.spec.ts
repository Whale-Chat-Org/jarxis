import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test } from './fixtures';
import { login, makeOwner, register, setRole, testDatabase, verify } from './helpers';

async function createRole(request: APIRequestContext, permissions: string[]) {
  const name = `Regression ${randomUUID().slice(0, 8)}`;
  const response = await request.post('/api/admin/roles', {
    data: { name, description: '', permissions },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).role as { key: string; name: string };
}

test('custom-role callers cannot impersonate or reset passwords across broader grants', async ({
  request,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  const actor = await register(request, baseURL!);
  const target = await register(request, baseURL!);
  await verify(request, actor.email, baseURL!);
  await verify(request, target.email, baseURL!);
  await login(request, owner.email, baseURL!);
  const narrow = await createRole(request, ['user:impersonate', 'user:set-password']);
  const broad = await createRole(request, ['audit:read']);
  await setRole(actor.id, narrow.key);
  await setRole(target.id, broad.key);
  await login(request, actor.email, baseURL!);
  for (const path of ['impersonate-user', 'set-user-password']) {
    const response = await request.post(`/api/auth/admin/${path}`, {
      data: { userId: target.id, newPassword: 'Regression-Reset!58392' },
    });
    expect(response.status(), await response.text()).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'TARGET_PERMISSIONS_EXCEED_ACTOR' });
  }
  // A rejected reset must leave the original credentials usable.
  await login(request, target.email, baseURL!);
});

test('sidebar refreshes live grants on soft navigation and hides Users without user:list', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  const member = await register(request, baseURL!);
  await verify(request, member.email, baseURL!);
  await login(request, owner.email, baseURL!);
  const role = await createRole(request, ['dashboard:read', 'audit:read', 'users:read']);
  await setRole(member.id, role.key);
  await login(request, member.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: 'Audit Log', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  const pool = testDatabase();
  try {
    await pool.query('INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2)', [
      role.key,
      'user:list',
    ]);
    await page.getByRole('link', { name: 'Audit Log', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search by email' })).toBeVisible();
    await pool.query(
      'DELETE FROM role_permissions WHERE role_key=$1 AND permission_key IN ($2,$3)',
      [role.key, 'user:list', 'audit:read'],
    );
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Audit Log', exact: true })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/access-denied$/);
  } finally {
    await pool.end();
  }
});

test('a stale role-delete dialog shows the live member count at all supported viewports', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  const member = await register(request, baseURL!);
  await verify(request, member.email, baseURL!);
  await login(request, owner.email, baseURL!);
  const role = await createRole(request, ['audit:read']);
  await context.addCookies((await request.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/roles');
  await page.getByRole('button', { name: `Actions for ${role.name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await setRole(member.id, role.key);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Delete role', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('1 user still has this role.');
  for (const [width, height] of [
    [375, 667],
    [440, 956],
    [768, 1024],
    [960, 1440],
    [1280, 800],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
