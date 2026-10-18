import { expect } from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, setRole, testDatabase, uniqueEmail, verify } from './helpers';

test('admin HTTP mutations enforce owner eligibility, password policy and nested role protection', async ({
  request,
  baseURL,
}) => {
  const owner = await register(request, baseURL!);
  await verify(request, owner.email, baseURL!);
  await makeOwner(owner.id);
  const administrator = await register(request, baseURL!);
  await verify(request, administrator.email, baseURL!);
  await setRole(administrator.id, 'administrator');
  const target = await register(request, baseURL!);
  await verify(request, target.email, baseURL!);
  await login(request, owner.email, baseURL!);

  const create = (extra: Record<string, unknown>) =>
    request.post('/api/auth/admin/create-user', {
      data: { name: 'Guard regression', email: uniqueEmail(), ...extra },
    });
  for (const password of ['', 'x'.repeat(11), 'x'.repeat(129)]) {
    const response = await create({ password });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_PASSWORD_LENGTH' });
  }
  for (const password of ['x'.repeat(12), 'x'.repeat(128), undefined]) {
    const response = await create(password === undefined ? {} : { password });
    expect(response.status(), await response.text()).toBe(200);
  }
  for (const roleShape of [{ role: 'owner' }, { data: { role: 'owner', emailVerified: false } }]) {
    const response = await create(roleShape);
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INACTIVE_OWNER' });
  }
  await login(request, administrator.email, baseURL!);
  const promotion = await request.post('/api/auth/admin/update-user', {
    data: { userId: target.id, data: { role: 'owner' } },
  });
  expect(promotion.status()).toBe(403);
  const ownerEdit = await request.post('/api/auth/admin/update-user', {
    data: { userId: owner.id, data: { name: 'Forbidden' } },
  });
  expect(ownerEdit.status()).toBe(403);

  await login(request, owner.email, baseURL!);
  const pool = testDatabase();
  // The isolated database is shared by serial acceptance cases. Restore every other
  // owner's original assignment after proving the last-owner check over real HTTP.
  const others = await pool.query<{ id: string; role: string }>(
    'SELECT id, role FROM app_user WHERE id <> $1 AND role LIKE $2',
    [owner.id, '%owner%'],
  );
  try {
    for (const row of others.rows)
      await pool.query('UPDATE app_user SET role = $2 WHERE id = $1', [row.id, 'user']);
    const response = await request.post('/api/auth/admin/update-user', {
      data: { userId: owner.id, data: { emailVerified: false } },
    });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'LAST_OWNER' });
    const stored = await pool.query('SELECT email_verified FROM app_user WHERE id = $1', [
      owner.id,
    ]);
    expect(stored.rows[0].email_verified).toBe(true);
  } finally {
    for (const row of others.rows)
      await pool.query('UPDATE app_user SET role = $2 WHERE id = $1', [row.id, row.role]);
    await pool.end();
  }
});
