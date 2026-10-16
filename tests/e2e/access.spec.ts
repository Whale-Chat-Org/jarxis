import { expect } from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, originHeaders, register, verify } from './helpers';

/** End-to-end coverage for stored roles and the single Users table. */
test('owner manages a custom role and assigns it from the Users table', async ({
  page,
  context,
  request,
  browser,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  const member = await register(request, baseURL!);
  const roleName = `Auditor ${member.id.slice(0, 8)}`;
  const renamedRole = `${roleName} Lite`;
  await verify(request, member.email, baseURL!);
  await login(request, owner.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);

  await page.goto('/admin/roles');
  await page.getByRole('button', { name: 'Create role' }).click();
  const editor = page.getByRole('dialog', { name: 'Create role' });
  await editor.getByRole('textbox', { name: 'Name' }).fill(roleName);
  await editor.getByRole('textbox', { name: 'Description' }).fill('Reads audit records');
  await editor.getByRole('checkbox', { name: /View the administration overview/ }).check();
  await editor
    .getByRole('checkbox', { name: /View security and administrative audit events/ })
    .check();
  await expect(editor.getByRole('checkbox', { name: /Manage ML providers/ })).toBeDisabled();
  await editor.getByRole('button', { name: 'Save role' }).click();
  await expect(page.getByRole('dialog', { name: 'Create role' })).toHaveCount(0);
  const created = await request.get('/api/admin/roles');
  expect(created.status()).toBe(200);
  const roles = (await created.json()).roles as Array<{ key: string; name: string }>;
  const key = roles.find((role) => role.name === roleName)?.key;
  expect(key).toMatch(/^custom_/);

  await page.goto('/admin/users');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Users & access' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search by email' }).fill(member.email);
  const row = page.getByRole('row').filter({ hasText: member.email });
  await expect(row).toHaveCount(1);
  const roleSelect = row.getByRole('combobox', { name: 'Role for Acceptance User' });
  await roleSelect.click();
  await page.getByRole('option', { name: roleName }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Change role?');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // The member's name contains "User", so assert on the role control, not the row text.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(roleSelect).toHaveText('User');
  await roleSelect.click();
  await page.getByRole('option', { name: roleName }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(roleSelect).toHaveText(roleName);

  const memberContext = await browser.newContext({ baseURL });
  try {
    await login(memberContext.request, member.email, baseURL!);
    const allowed = await memberContext.request.get('/admin/audit');
    expect(allowed.status()).toBe(200);
    const blocked = await memberContext.request.post('/api/admin/roles', {
      headers: originHeaders(baseURL!),
      data: { name: 'Forbidden', description: '', permissions: [] },
    });
    expect(blocked.status()).toBe(403);
  } finally {
    await memberContext.close();
  }

  await page.goto('/admin/roles');
  const card = page.locator('[data-slot="card"]').filter({ hasText: roleName });
  await expect(card).toContainText('Custom role · 1 user');
  await expect(card.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(card).toContainText('Move 1 user to another role before deleting it.');
  const refused = await request.delete(`/api/admin/roles/${key}`, {
    headers: originHeaders(baseURL!),
  });
  expect(refused.status()).toBe(409);
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit role' });
  await edit.getByRole('textbox', { name: 'Name' }).fill(renamedRole);
  await edit.getByRole('button', { name: 'Save role' }).click();
  await page.goto('/admin/users');
  await page.getByRole('textbox', { name: 'Search by email' }).fill(member.email);
  const renamedRow = page.getByRole('row').filter({ hasText: member.email });
  await expect(renamedRow).toContainText(renamedRole);
  const renamedSelect = renamedRow.getByRole('combobox', { name: 'Role for Acceptance User' });
  await renamedSelect.click();
  await page.getByRole('option', { name: 'User', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change role' }).click();
  // Wait for the save to land before the roles page counts the role's users.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(renamedSelect).toHaveText('User');
  await page.goto('/admin/roles');
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: renamedRole })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete role' }).click();
  await expect(page.locator('[data-slot="card"]').filter({ hasText: renamedRole })).toHaveCount(0);
  expect(key).toBeTruthy();
});
