import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminPermissionCatalog, permissionCatalog } from '@/lib/permissions';
import { seedRbac } from '@/lib/rbac-seed';

const tx = {
  permission: { upsert: vi.fn(), deleteMany: vi.fn() },
  role: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
};
const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) } as never;
const total = Object.keys(permissionCatalog).length + Object.keys(adminPermissionCatalog).length;
const grantsFor = (key: string) =>
  tx.rolePermission.createMany.mock.calls
    .map(([arg]) => arg.data as { roleKey: string; permissionKey: string }[])
    .filter((rows) => rows[0]?.roleKey === key);

beforeEach(() => {
  vi.clearAllMocks();
  tx.permission.deleteMany.mockResolvedValue({ count: 0 });
  tx.role.findUnique.mockResolvedValue(null);
});

describe('seedRbac', () => {
  it('upserts the catalog, removes stale keys and creates missing system roles', async () => {
    tx.permission.deleteMany.mockResolvedValueOnce({ count: 1 });
    const result = await seedRbac(db);
    expect(result).toEqual({
      permissions: total,
      removedPermissions: 1,
      createdRoles: ['user', 'viewer', 'administrator', 'owner'],
    });
    expect(tx.permission.upsert).toHaveBeenCalledTimes(total);
    expect(tx.permission.upsert).toHaveBeenCalledWith({
      where: { key: 'user:delete' },
      create: { key: 'user:delete', description: 'Delete users (owner only)', restricted: true },
      update: { description: 'Delete users (owner only)', restricted: true },
    });
    expect(tx.role.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'viewer', normalizedName: 'viewer', system: true }),
    });
    expect(grantsFor('viewer')[0].map((row) => row.permissionKey)).toContain('audit:read');
    expect(tx.rolePermission.deleteMany).toHaveBeenLastCalledWith({
      where: {
        roleKey: { notIn: ['owner', 'user'] },
        permissionKey: { in: expect.arrayContaining(['roles:update', 'user:delete']) },
      },
    });
  });

  it('keeps owner edits to Viewer and Administrator but resets Owner to code', async () => {
    tx.role.findUnique.mockResolvedValue({ key: 'existing' });
    expect((await seedRbac(db)).createdRoles).toEqual([]);
    expect(tx.role.update).toHaveBeenCalledWith({
      where: { key: 'viewer' },
      data: { name: 'Viewer', normalizedName: 'viewer', system: true },
    });
    expect(grantsFor('viewer')).toHaveLength(0);
    expect(grantsFor('administrator')).toHaveLength(0);
    expect(grantsFor('owner')[0].map((row) => row.permissionKey)).toContain('roles:update');
  });

  it('restores Viewer and Administrator on reset', async () => {
    tx.role.findUnique.mockResolvedValue({ key: 'existing' });
    await seedRbac(db, { reset: true });
    expect(tx.role.update).toHaveBeenCalledWith({
      where: { key: 'viewer' },
      data: expect.objectContaining({ description: 'Read-only access to administration screens.' }),
    });
    expect(grantsFor('viewer')).toHaveLength(1);
    expect(grantsFor('administrator')).toHaveLength(1);
  });
});
