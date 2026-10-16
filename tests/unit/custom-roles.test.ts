import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findMany: vi.fn(), findUsers: vi.fn() }));
vi.mock('@/db', () => ({
  db: { customRole: { findMany: m.findMany }, user: { findMany: m.findUsers } },
}));

const { listRoles, liveAdminRoles, validateRoleInput, withLiveAdminRoles } =
  await import('@/lib/custom-roles');

beforeEach(() => {
  m.findMany.mockReset().mockResolvedValue([]);
  m.findUsers.mockReset().mockResolvedValue([]);
});

describe('custom roles', () => {
  it('rejects owner permissions and unknown keys', () => {
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
    }
    expect(() => validateRoleInput({ name: 'Owner', description: '', permissions: [] })).toThrow(
      'already in use',
    );
  });

  it('isolates live grants per request and ignores corrupt stored permissions', async () => {
    m.findMany.mockResolvedValueOnce([
      { key: 'custom_a', permissions: ['audit:read', 'roles:update'] },
    ]);
    await withLiveAdminRoles(async () => {
      expect(liveAdminRoles.custom_a.authorize({ audit: ['read'] }).success).toBe(true);
      expect(liveAdminRoles.custom_a.authorize({ roles: ['update'] }).success).toBe(false);
    });
    expect(liveAdminRoles.custom_a).toBeUndefined();
    expect(liveAdminRoles.constructor).toBeUndefined();
    m.findMany.mockResolvedValueOnce([{ key: 'custom_a', permissions: ['users:read'] }]);
    await withLiveAdminRoles(async () => {
      expect(liveAdminRoles.custom_a.authorize({ audit: ['read'] }).success).toBe(false);
      expect(liveAdminRoles.custom_a.authorize({ users: ['read'] }).success).toBe(true);
    });
  });

  it('lists locked system roles first, then custom roles with their user counts', async () => {
    m.findMany.mockResolvedValueOnce([
      { key: 'custom_a', name: 'Auditor', description: '', permissions: ['audit:read'] },
      { key: 'custom_b', name: 'Reader', description: '', permissions: 'corrupt' },
    ]);
    m.findUsers.mockResolvedValueOnce([
      { role: 'custom_a' },
      { role: 'viewer, custom_a,custom_a' },
      { role: null },
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
    expect(roles.slice(0, 4).every((role) => role.system && !('userCount' in role))).toBe(true);
    expect(roles.find((role) => role.key === 'owner')?.permissions).toContain('roles:update');
    expect(roles[4]).toMatchObject({ system: false, userCount: 2, permissions: ['audit:read'] });
    expect(roles[5]).toMatchObject({ userCount: 0, permissions: [] });
  });
});
