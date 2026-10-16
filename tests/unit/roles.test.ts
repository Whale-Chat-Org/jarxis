import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findRoles: vi.fn(),
  queryRaw: vi.fn(),
  findPermissions: vi.fn(),
  countPermissions: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    role: { findMany: m.findRoles },
    permission: { findMany: m.findPermissions, count: m.countPermissions },
    $queryRaw: m.queryRaw,
  },
}));

const {
  assertCatalogued,
  effectivePermissions,
  listPermissions,
  listRoles,
  liveAdminRoles,
  validateRoleInput,
  validateSystemRoleInput,
  withLiveAdminRoles,
} = await import('@/lib/roles');

const grants = (...keys: string[]) => keys.map((permissionKey) => ({ permissionKey }));

beforeEach(() => {
  m.findRoles.mockReset().mockResolvedValue([]);
  m.queryRaw.mockReset().mockResolvedValue([]);
  m.findPermissions.mockReset().mockResolvedValue([]);
  m.countPermissions.mockReset();
});

describe('roles', () => {
  it('rejects owner permissions, unknown keys and reserved names', () => {
    for (const permission of [
      'roles:update',
      'roles:assign',
      'providers:manage',
      'user:delete',
      'user:set-role',
      'user:impersonate-admins',
      'imaginary:read',
    ]) {
      expect(() =>
        validateRoleInput({ name: 'Auditor', description: '', permissions: [permission] }),
      ).toThrow('unavailable permission');
      expect(() =>
        validateSystemRoleInput({ name: 'Viewer', description: '', permissions: [permission] }),
      ).toThrow('unavailable permission');
    }
    expect(() => validateRoleInput({ name: 'Owner', description: '', permissions: [] })).toThrow(
      'already in use',
    );
    expect(
      validateSystemRoleInput({
        name: 'Renamed',
        description: 'Reads',
        permissions: ['audit:read', 'audit:read'],
      }),
    ).toEqual({ description: 'Reads', permissions: ['audit:read'] });
  });

  it('requires every grant to be a catalogued, unrestricted permission row', async () => {
    await assertCatalogued([]);
    expect(m.countPermissions).not.toHaveBeenCalled();
    m.countPermissions.mockResolvedValueOnce(2);
    await assertCatalogued(['audit:read', 'users:read']);
    expect(m.countPermissions).toHaveBeenCalledWith({
      where: { key: { in: ['audit:read', 'users:read'] }, restricted: false },
    });
    m.countPermissions.mockResolvedValueOnce(1);
    await expect(assertCatalogued(['audit:read', 'users:read'])).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PERMISSION',
    });
  });

  it('pins owner and user to code and filters stored grants for the rest', () => {
    expect(
      effectivePermissions({ key: 'owner', system: true, permissions: grants('audit:read') }),
    ).toContain('roles:update');
    expect(
      effectivePermissions({ key: 'user', system: true, permissions: grants('audit:read') }),
    ).toEqual([]);
    expect(
      effectivePermissions({
        key: 'viewer',
        system: true,
        permissions: grants('audit:read', 'roles:update', 'imaginary:read'),
      }),
    ).toEqual(['audit:read']);
  });

  it('isolates live grants per request and ignores restricted stored permissions', async () => {
    m.findRoles.mockResolvedValueOnce([
      { key: 'custom_a', system: false, permissions: grants('audit:read', 'roles:update') },
      { key: 'viewer', system: true, permissions: grants('users:read') },
    ]);
    await withLiveAdminRoles(async () => {
      expect(liveAdminRoles.custom_a.authorize({ audit: ['read'] }).success).toBe(true);
      expect(liveAdminRoles.custom_a.authorize({ roles: ['update'] }).success).toBe(false);
      // An owner's edit to Viewer replaces the code default for this request.
      expect(liveAdminRoles.viewer.authorize({ audit: ['read'] }).success).toBe(false);
      expect(liveAdminRoles.owner.authorize({ roles: ['update'] }).success).toBe(true);
    });
    expect(m.findRoles).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { notIn: ['owner', 'user'] } } }),
    );
    expect(liveAdminRoles.custom_a).toBeUndefined();
    expect(liveAdminRoles.viewer.authorize({ audit: ['read'] }).success).toBe(true);
    expect(liveAdminRoles.constructor).toBeUndefined();
  });

  it('lists system roles first, then custom roles with user counts', async () => {
    m.findRoles.mockResolvedValueOnce([
      {
        key: 'custom_a',
        name: 'Auditor',
        description: '',
        system: false,
        permissions: grants('audit:read'),
      },
      {
        key: 'administrator',
        name: 'Administrator',
        description: 'Edited',
        system: true,
        permissions: grants('users:read'),
      },
      {
        key: 'custom_b',
        name: 'Reader',
        description: '',
        system: false,
        permissions: grants('roles:update'),
      },
    ]);
    m.queryRaw.mockResolvedValueOnce([
      { key: 'custom_a', count: 2n },
      { key: 'user', count: 5n },
    ]);
    const roles = await listRoles();
    expect(roles.map((role) => role.key)).toEqual([
      'user',
      'viewer',
      'administrator',
      'owner',
      'custom_a',
      'custom_b',
    ]);
    expect(roles[0]).toMatchObject({ system: true, editable: false, userCount: 5 });
    // Viewer is missing from an unseeded database and falls back to its code grant.
    expect(roles[1]).toMatchObject({ editable: true, userCount: 0 });
    expect(roles[1].permissions).toContain('audit:read');
    expect(roles[2]).toMatchObject({ description: 'Edited', permissions: ['users:read'] });
    expect(roles[3]).toMatchObject({ editable: false });
    expect(roles[3].permissions).toContain('roles:update');
    expect(roles[4]).toMatchObject({ system: false, editable: true, userCount: 2 });
    expect(roles[5]).toMatchObject({ userCount: 0, permissions: [] });
  });

  it('lists the stored permission catalog in code order, falling back to code', async () => {
    m.findPermissions.mockResolvedValueOnce([
      { key: 'user:list', description: 'List users', restricted: false },
      { key: 'dashboard:read', description: 'Overview', restricted: false },
    ]);
    expect((await listPermissions()).map((entry) => entry.key)).toEqual([
      'dashboard:read',
      'user:list',
    ]);
    const fallback = await listPermissions();
    expect(fallback[0]).toEqual({
      key: 'dashboard:read',
      description: 'View the administration overview',
      restricted: false,
    });
    expect(fallback.find((entry) => entry.key === 'user:delete')?.restricted).toBe(true);
  });
});
