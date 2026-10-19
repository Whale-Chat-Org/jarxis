import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  session: vi.fn(),
  grants: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  // Expose the raw handler so it can be called with a plain context.
  createAuthMiddleware: (fn: unknown) => fn,
  getAuthoritativeSessionFromCtx: m.session,
}));
vi.mock('@/lib/rbac', () => ({ grants: m.grants }));
vi.mock('@/db', () => ({
  db: {
    user: { findUnique: m.findUnique, findMany: m.findMany },
    tokenFamily: { updateMany: m.updateMany },
    auditLog: { create: m.auditCreate },
  },
}));

const guards = await import('@/lib/auth/admin-guards');
type Ctx = { path?: string; body?: unknown; context?: Record<string, unknown> };
const guard = guards.adminMutationGuard as unknown as (ctx: Ctx) => Promise<void>;
const audit = guards.adminAuditHook as unknown as (ctx: Ctx) => Promise<void>;

const active = { banned: false, banExpires: null, emailVerified: true };
const owner = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  role: 'owner',
  ...active,
  ...extra,
});
const admin = (id: string) => ({ id, role: 'administrator', ...active });

function actor(user: unknown) {
  m.session.mockResolvedValue(user ? { user } : null);
}
function users(...rows: Array<{ id: string } & Record<string, unknown>>) {
  m.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
  );
  m.findMany.mockResolvedValue(rows);
}
async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as APIError;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('adminMutationGuard', () => {
  it('ignores endpoints that do not mutate a user', async () => {
    await guard({ path: '/admin/list-users', body: {} });
    await guard({ body: {} });
    expect(m.session).not.toHaveBeenCalled();
  });

  it('guards nested role updates and unverification of the last owner', async () => {
    actor(owner('o1'));
    users(owner('o1'));
    for (const data of [{ role: 'administrator' }, { emailVerified: false }]) {
      const error = await rejection(
        guard({ path: '/admin/update-user', body: { userId: 'o1', data } }),
      );
      expect(error.body?.code).toBe('LAST_OWNER');
    }
    users(owner('o1'), { id: 'u1', role: 'user', ...active, emailVerified: false });
    expect(
      (
        await rejection(
          guard({ path: '/admin/update-user', body: { userId: 'u1', data: { role: 'owner' } } }),
        )
      ).body?.code,
    ).toBe('INACTIVE_OWNER');
    await guard({
      path: '/admin/update-user',
      body: { userId: 'u1', data: { role: 'owner', emailVerified: true } },
    });
  });

  it('enforces owner eligibility on both create-user role shapes', async () => {
    actor(owner('o1'));
    for (const body of [
      { role: 'owner' },
      { data: { role: ['owner'] } },
      { role: 'owner', data: { emailVerified: true, banned: true } },
    ]) {
      expect((await rejection(guard({ path: '/admin/create-user', body }))).body?.code).toBe(
        'INACTIVE_OWNER',
      );
    }
    await guard({
      path: '/admin/create-user',
      body: { role: 'owner', data: { emailVerified: true } },
    });
    actor(admin('a1'));
    expect(
      (
        await rejection(
          guard({
            path: '/admin/create-user',
            body: { role: 'owner', data: { emailVerified: true } },
          }),
        )
      ).body?.code,
    ).toBe('OWNER_PROTECTED');
  });

  it('checks supplied create-user passwords but permits credentialless accounts', async () => {
    actor(owner('o1'));
    for (const length of [0, 1, 11, 129]) {
      expect(
        (
          await rejection(
            guard({ path: '/admin/create-user', body: { password: 'p'.repeat(length) } }),
          )
        ).body?.code,
      ).toBe('INVALID_PASSWORD_LENGTH');
    }
    for (const length of [12, 128])
      await guard({ path: '/admin/create-user', body: { password: 'p'.repeat(length) } });
    await guard({ path: '/admin/create-user', body: {} });
  });

  it('requires an authoritative session for guarded endpoints', async () => {
    actor(null);
    const error = await rejection(guard({ path: '/admin/ban-user', body: { userId: 'u' } }));
    expect(error).toBeInstanceOf(APIError);
    expect(error.statusCode).toBe(401);
  });

  it('lets the endpoint answer when the target is absent or unknown', async () => {
    actor(admin('a1'));
    users();
    await guard({ path: '/admin/ban-user', body: {} });
    await guard({ path: '/admin/ban-user', body: { userId: '' } });
    await guard({ path: '/admin/ban-user', body: 'not-an-object' });
    expect(m.findUnique).not.toHaveBeenCalled();
    await guard({ path: '/admin/ban-user', body: { userId: 'missing' } });
    expect(m.findUnique).toHaveBeenCalledTimes(1);
  });

  it('forbids a non-owner from modifying an owner', async () => {
    actor(admin('a1'));
    users(owner('o1'), owner('o2'));
    for (const path of ['/admin/update-user', '/admin/ban-user', '/admin/revoke-user-sessions']) {
      const error = await rejection(guard({ path, body: { userId: 'o1' } }));
      expect(error.statusCode).toBe(403);
      expect(error.body?.code).toBe('OWNER_PROTECTED');
    }
  });

  it("lets only an owner set an owner's password", async () => {
    const path = '/admin/set-user-password';
    actor(admin('a1'));
    users(owner('o1'), admin('a2'));
    const error = await rejection(
      guard({ path, body: { userId: 'o1', newPassword: 'p'.repeat(16) } }),
    );
    expect(error.statusCode).toBe(403);
    expect(error.body?.code).toBe('OWNER_PROTECTED');
    await guard({ path, body: { userId: 'a2', newPassword: 'p'.repeat(16) } });

    actor(owner('o2'));
    users(owner('o1'), owner('o2'));
    await guard({ path, body: { userId: 'o1', newPassword: 'p'.repeat(16) } });
    // Setting a password does not remove access, so the last-owner count is never consulted.
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it.each(['/admin/impersonate-user', '/admin/set-user-password'])(
    'blocks broader target grants on %s and permits subsets',
    async (path) => {
      actor({ id: 'narrow', role: 'custom_narrow' });
      users({ id: 'broad', role: 'custom_broad', ...active });
      const permissions = new Map([
        ['narrow', new Set(['user:impersonate', 'user:set-password'])],
        ['broad', new Set(['audit:read'])],
      ]);
      m.grants.mockImplementation(async (id: string) => ({ permissions: permissions.get(id) }));
      const body = { userId: 'broad', newPassword: 'p'.repeat(16) };
      const error = await rejection(guard({ path, body }));
      expect(error.statusCode).toBe(403);
      expect(error.body?.code).toBe('TARGET_PERMISSIONS_EXCEED_ACTOR');
      permissions.set('broad', new Set(['user:impersonate']));
      await guard({ path, body });
      permissions.set('broad', permissions.get('narrow')!);
      await guard({ path, body });
      permissions.set('narrow', new Set());
      await expect(guard({ path, body })).rejects.toMatchObject({ statusCode: 403 });
      permissions.set('broad', new Set());
      await guard({ path, body });
    },
  );

  it.each(['owner', 'administrator', 'custom_narrow,administrator'])(
    'preserves %s caller behavior on sensitive endpoints',
    async (role) => {
      actor({ id: 'actor', role });
      users({ id: 'target', role: 'custom_broad', ...active });
      for (const path of ['/admin/impersonate-user', '/admin/set-user-password']) {
        await guard({ path, body: { userId: 'target' } });
      }
      expect(m.grants).not.toHaveBeenCalled();
    },
  );

  it('treats an actor with an unknown role as a non-owner (fail closed)', async () => {
    actor({ id: 'x', role: 'superuser' });
    users(owner('o1'), owner('o2'));
    expect(
      (await rejection(guard({ path: '/admin/set-role', body: { userId: 'o1', role: 'owner' } })))
        .statusCode,
    ).toBe(403);
    actor({ id: 'x' });
    expect(
      (await rejection(guard({ path: '/admin/ban-user', body: { userId: 'o1' } }))).statusCode,
    ).toBe(403);
    actor('string-user');
    expect(
      (await rejection(guard({ path: '/admin/ban-user', body: { userId: 'o1' } }))).statusCode,
    ).toBe(403);
  });

  it('allows a non-owner to manage a non-owner account', async () => {
    actor(admin('a1'));
    users(admin('a2'));
    await guard({ path: '/admin/ban-user', body: { userId: 'a2' } });
    await guard({ path: '/admin/set-role', body: { userId: 'a2', role: 'viewer' } });
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('only grants owner to an active, verified account', async () => {
    actor(owner('o1'));
    users(owner('o1'), {
      id: 'u1',
      role: 'user',
      banned: false,
      banExpires: null,
      emailVerified: false,
    });
    let error = await rejection(
      guard({ path: '/admin/set-role', body: { userId: 'u1', role: 'owner' } }),
    );
    expect(error.statusCode).toBe(409);
    expect(error.body?.code).toBe('INACTIVE_OWNER');

    users(owner('o1'), {
      id: 'u1',
      role: 'user',
      banned: true,
      banExpires: null,
      emailVerified: true,
    });
    error = await rejection(
      guard({ path: '/admin/set-role', body: { userId: 'u1', role: ['viewer', 'owner'] } }),
    );
    expect(error.body?.code).toBe('INACTIVE_OWNER');

    users(owner('o1'), { id: 'u1', role: 'user', ...active });
    await guard({ path: '/admin/set-role', body: { userId: 'u1', role: 'owner' } });
  });

  it('blocks removing access from the last active owner', async () => {
    actor(owner('o1'));
    users(owner('o1'));
    const cases: Ctx[] = [
      { path: '/admin/set-role', body: { userId: 'o1', role: 'administrator' } },
      { path: '/admin/set-role', body: { userId: 'o1', role: ['viewer'] } },
      { path: '/admin/ban-user', body: { userId: 'o1' } },
      { path: '/admin/remove-user', body: { userId: 'o1' } },
      { path: '/admin/revoke-user-session', body: { userId: 'o1' } },
      { path: '/admin/revoke-user-sessions', body: { userId: 'o1' } },
      { path: '/admin/update-user', body: { userId: 'o1', data: { banned: true } } },
    ];
    for (const ctx of cases) {
      const error = await rejection(guard(ctx));
      expect(error.statusCode).toBe(409);
      expect(error.body?.code).toBe('LAST_OWNER');
    }
  });

  it('allows non-removing changes to the last owner', async () => {
    actor(owner('o1'));
    users(owner('o1'));
    await guard({ path: '/admin/set-role', body: { userId: 'o1', role: ['owner', 'viewer'] } });
    await guard({ path: '/admin/update-user', body: { userId: 'o1', data: { name: 'New' } } });
    await guard({ path: '/admin/update-user', body: { userId: 'o1' } });
    await guard({ path: '/admin/unban-user', body: { userId: 'o1' } });
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('does not count banned, lapsed or unverified owners as active', async () => {
    actor(owner('o1'));
    users(
      owner('o1'),
      owner('o2', { banned: true, banExpires: null }),
      owner('o3', { emailVerified: false }),
      { id: 'o4', role: 'owner-ish', ...active },
    );
    const error = await rejection(guard({ path: '/admin/ban-user', body: { userId: 'o1' } }));
    expect(error.body?.code).toBe('LAST_OWNER');
  });

  it('allows removing an owner while another active owner remains', async () => {
    actor(owner('o1'));
    users(owner('o1'), owner('o2', { banned: true, banExpires: new Date(Date.now() - 1000) }));
    await guard({ path: '/admin/remove-user', body: { userId: 'o1' } });
    // A target owner who is not active is not protected by the count.
    users(owner('o1'), owner('o2', { banned: true, banExpires: null }));
    await guard({ path: '/admin/remove-user', body: { userId: 'o2' } });
  });
});

describe('userStatusHooks', () => {
  it('revokes live token families when a user is banned', async () => {
    await guards.userStatusHooks.update.after({ id: 'u1', banned: false });
    expect(m.updateMany).not.toHaveBeenCalled();
    await guards.userStatusHooks.update.after({ id: 'u1', banned: true });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('skips the owner check when deleting a non-owner', async () => {
    await guards.userStatusHooks.delete.before({ id: 'u1', role: 'user' }, undefined);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('forbids deleting an owner without an owner session', async () => {
    for (const context of [undefined, 'x', {}, { context: { session: { user: admin('a1') } } }]) {
      const error = await rejection(guards.userStatusHooks.delete.before(owner('o1'), context));
      expect(error.statusCode).toBe(403);
    }
  });

  it('refuses to delete the last active owner and allows otherwise', async () => {
    const context = { context: { session: { user: owner('o2') } } };
    m.findMany.mockResolvedValue([owner('o1')]);
    const error = await rejection(guards.userStatusHooks.delete.before(owner('o1'), context));
    expect(error.statusCode).toBe(409);
    expect(error.body?.code).toBe('LAST_OWNER');

    m.findMany.mockResolvedValue([owner('o1'), owner('o2')]);
    await guards.userStatusHooks.delete.before(owner('o1'), context);
  });
});

describe('adminAuditHook', () => {
  const logger = { error: vi.fn() };
  const ctx = (path: string, body: unknown, returned: unknown = { ok: true }): Ctx => ({
    path,
    body,
    context: { returned, logger },
  });

  it('ignores unaudited paths and failed mutations', async () => {
    await audit(ctx('/admin/list-users', {}));
    await audit({ body: {}, context: { returned: {}, logger } });
    await audit(ctx('/admin/ban-user', { userId: 'u1' }, new APIError('FORBIDDEN')));
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('records only allow-listed fields, never passwords', async () => {
    m.session.mockResolvedValue({ user: { id: 'o1' } });
    await audit(
      ctx('/admin/update-user', {
        userId: 'u1',
        role: 'viewer',
        banReason: 'spam',
        banExpiresIn: 60,
        password: 'fake-secret',
        newPassword: 'fake-secret',
        data: {
          name: 'N',
          email: 'e@example.com',
          emailVerified: true,
          banned: true,
          banReason: 'r',
          banExpires: 'd',
          password: 'fake-secret',
          image: 'x',
        },
      }),
    );
    const data = m.auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: 'o1', action: 'user.update', targetId: 'u1' });
    expect(data.changes).toEqual({
      path: '/admin/update-user',
      role: 'viewer',
      banReason: 'r',
      banExpiresIn: 60,
      name: 'N',
      email: 'e@example.com',
      emailVerified: true,
      banned: true,
      banExpires: 'd',
    });
    expect(JSON.stringify(data)).not.toContain('fake-secret');
  });

  it('marks unban, removal and impersonation, and defaults ids', async () => {
    m.session.mockResolvedValue({ user: { id: 'o1' } });
    await audit(ctx('/admin/unban-user', { userId: 'u1' }));
    expect(m.auditCreate.mock.calls[0][0].data.changes).toEqual({
      path: '/admin/unban-user',
      banned: false,
    });
    await audit(ctx('/admin/remove-user', { userId: 'u1' }));
    expect(m.auditCreate.mock.calls[1][0].data.changes).toEqual({
      path: '/admin/remove-user',
      confirmed: true,
    });
    await audit(ctx('/admin/impersonate-user', { userId: 'u1', data: 'scalar' }));
    expect(m.auditCreate.mock.calls[2][0].data.action).toBe('user.impersonate');

    // No target in the body: the actor is the target.
    await audit(ctx('/admin/stop-impersonating', undefined));
    expect(m.auditCreate.mock.calls[3][0].data).toMatchObject({
      actorId: 'o1',
      targetId: 'o1',
      changes: { path: '/admin/stop-impersonating' },
    });

    m.session.mockResolvedValue(null);
    await audit(ctx('/admin/create-user', { email: 'x@example.com' }));
    expect(m.auditCreate.mock.calls[4][0].data).toMatchObject({
      actorId: 'unknown',
      targetId: 'unknown',
    });
  });

  it('logs and swallows audit failures so a committed mutation is not a 500', async () => {
    m.session.mockResolvedValue({ user: { id: 'o1' } });
    m.auditCreate.mockRejectedValue(new Error('db down'));
    await expect(audit(ctx('/admin/ban-user', { userId: 'u1' }))).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Admin audit record failed', { kind: 'Error' });
  });
});
