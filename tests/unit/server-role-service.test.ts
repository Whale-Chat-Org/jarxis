import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  const tx = {
    role: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    rolePermission: { createMany: vi.fn(), deleteMany: vi.fn() },
    permission: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    PrismaClientKnownRequestError,
    tx,
    findSession: vi.fn(),
    identify: vi.fn(),
    grants: vi.fn(),
    authorize: vi.fn(),
    rateLimit: vi.fn(),
  };
});

vi.mock('@/db', () => ({
  db: {
    session: { findFirst: m.findSession },
    $transaction: (run: (tx: typeof m.tx) => unknown) => run(m.tx),
  },
  Prisma: { PrismaClientKnownRequestError: m.PrismaClientKnownRequestError },
}));
vi.mock('@/lib/rbac', () => ({ identify: m.identify, grants: m.grants, authorize: m.authorize }));
vi.mock('@/lib/redis', () => ({ rateLimit: m.rateLimit }));

const service = await import('@/lib/role-service');

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/admin/roles', { headers });
const input = { name: 'Auditor', description: 'Reads audit', permissions: ['audit:read'] };

beforeEach(() => {
  vi.clearAllMocks();
  m.identify.mockResolvedValue({ userId: 'owner-1', sessionId: 'session-1' });
  m.grants.mockResolvedValue({ roles: ['viewer'], permissions: new Set(['roles:read']) });
  m.authorize.mockResolvedValue({ roles: ['owner'], permissions: new Set(['roles:update']) });
  m.findSession.mockResolvedValue({ id: 'session-1' });
  m.tx.role.findUnique.mockResolvedValue({
    key: 'custom_a',
    name: 'Auditor',
    description: 'Reads audit',
    permissions: [{ permissionKey: 'audit:read' }],
  });
  m.tx.permission.count.mockImplementation(({ where }) => where.key.in.length);
  m.tx.$queryRaw.mockResolvedValue([{ count: 0n }]);
});

describe('role access guards', () => {
  it('lets role or user readers list roles but rejects bearer tokens and others', async () => {
    await expect(service.requireRoleReader(request())).resolves.toBeUndefined();
    m.grants.mockResolvedValueOnce({ roles: ['x'], permissions: new Set(['users:read']) });
    await expect(service.requireRoleReader(request())).resolves.toBeUndefined();
    m.grants.mockResolvedValueOnce({ roles: ['user'], permissions: new Set() });
    await expect(service.requireRoleReader(request())).rejects.toMatchObject({ status: 403 });
    await expect(
      service.requireRoleReader(request({ authorization: 'Bearer token' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('allows only a real owner session, rate limited', async () => {
    await expect(service.requireRoleOwner(request())).resolves.toBe('owner-1');
    expect(m.findSession).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ impersonatedBy: null }) }),
    );
    expect(m.rateLimit).toHaveBeenCalledWith('role-management:owner-1', 60, 60);

    await expect(
      service.requireRoleOwner(request({ authorization: 'Bearer token' })),
    ).rejects.toMatchObject({ status: 401 });
    m.findSession.mockResolvedValueOnce(null);
    await expect(service.requireRoleOwner(request())).rejects.toMatchObject({ status: 403 });
    m.authorize.mockResolvedValueOnce({ roles: ['admin'], permissions: new Set() });
    await expect(service.requireRoleOwner(request())).rejects.toMatchObject({
      status: 403,
      message: 'Owner access required',
    });
  });
});

describe('role mutations', () => {
  it('creates a role with a custom key, its grants and an audit entry', async () => {
    m.tx.role.create.mockImplementation(({ data }) => ({ ...data }));
    const role = await service.createRole('owner-1', input);
    expect(role?.key).toMatch(/^custom_/);
    expect(m.tx.role.create.mock.calls[0][0].data).not.toHaveProperty('permissions');
    expect(m.tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleKey: role?.key, permissionKey: 'audit:read' }],
    });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role.create',
        changes: { before: null, after: { name: 'Auditor', permissions: ['audit:read'] } },
      }),
    });
  });

  it('refuses grants missing from the permissions table', async () => {
    m.tx.permission.count.mockResolvedValueOnce(0);
    await expect(service.createRole('owner-1', input)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PERMISSION',
    });
    expect(m.tx.role.create).not.toHaveBeenCalled();
  });

  it('turns a duplicate name into a 409 and rethrows other failures', async () => {
    m.tx.role.create.mockRejectedValueOnce(new m.PrismaClientKnownRequestError('P2002'));
    await expect(service.createRole('owner-1', input)).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_NAME_TAKEN',
    });
    m.tx.role.create.mockRejectedValueOnce(new Error('down'));
    await expect(service.createRole('owner-1', input)).rejects.toThrow('down');
  });

  it('updates a custom role, replaces its grants and records before and after', async () => {
    m.tx.role.update.mockImplementation(({ data }) => ({ ...data }));
    await service.updateRole('owner-1', 'custom_a', {
      ...input,
      name: 'Auditor Lite',
      permissions: ['users:read'],
    });
    expect(m.tx.role.update.mock.calls[0][0].data).toMatchObject({
      name: 'Auditor Lite',
      normalizedName: 'auditor lite',
    });
    expect(m.tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleKey: 'custom_a' } });
    expect(m.tx.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleKey: 'custom_a', permissionKey: 'users:read' }],
    });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role.update',
        changes: {
          before: { name: 'Auditor', description: 'Reads audit', permissions: ['audit:read'] },
          after: { name: 'Auditor Lite', description: 'Reads audit', permissions: ['users:read'] },
        },
      }),
    });
  });

  it('edits Viewer and Administrator without renaming them', async () => {
    m.tx.role.findUnique.mockResolvedValueOnce({
      key: 'viewer',
      name: 'Viewer',
      description: 'Read-only',
      permissions: [{ permissionKey: 'audit:read' }],
    });
    m.tx.role.update.mockResolvedValue({ name: 'Viewer', description: 'Audit only' });
    await service.updateRole('owner-1', 'viewer', {
      name: 'Owner',
      description: 'Audit only',
      permissions: ['audit:read'],
    });
    expect(m.tx.role.update).toHaveBeenCalledWith({
      where: { key: 'viewer' },
      data: { description: 'Audit only' },
    });
    await expect(
      service.updateRole('owner-1', 'administrator', { ...input, permissions: ['user:delete'] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses locked and missing roles and never deletes a system role', async () => {
    for (const key of ['owner', 'user'])
      await expect(service.updateRole('owner-1', key, input)).rejects.toMatchObject({
        status: 403,
        code: 'SYSTEM_ROLE',
      });
    for (const key of ['administrator', 'viewer'])
      await expect(service.deleteRole('owner-1', key)).rejects.toMatchObject({ status: 403 });
    m.tx.role.findUnique.mockResolvedValue(null);
    await expect(service.updateRole('owner-1', 'custom_x', input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.deleteRole('owner-1', 'custom_x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses to delete a role in use with the user count', async () => {
    m.tx.$queryRaw.mockResolvedValueOnce([{ count: 1n }]);
    await expect(service.deleteRole('owner-1', 'custom_a')).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_IN_USE',
      message: '1 user must change role first',
    });
    m.tx.$queryRaw.mockResolvedValueOnce([{ count: 3n }]);
    await expect(service.deleteRole('owner-1', 'custom_a')).rejects.toThrow(
      '3 users must change role first',
    );
    expect(m.tx.role.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused role and audits it', async () => {
    await service.deleteRole('owner-1', 'custom_a');
    expect(m.tx.role.delete).toHaveBeenCalledWith({ where: { key: 'custom_a' } });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role.delete',
        changes: { before: { name: 'Auditor', permissions: ['audit:read'] }, after: null },
      }),
    });
  });
});
