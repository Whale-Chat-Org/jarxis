import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  sessionFind: vi.fn(),
  userFind: vi.fn(),
  customFind: vi.fn(),
  auditFind: vi.fn(),
  auditCount: vi.fn(),
  verifyAccess: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  env: { NODE_ENV: 'production' as string },
}));
vi.mock('@/db', () => ({
  db: {
    session: { findFirst: m.sessionFind },
    user: { findUnique: m.userFind },
    customRole: { findMany: m.customFind },
    auditLog: { findMany: m.auditFind, count: m.auditCount },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuth: () => ({ api: { getSession: m.getSession } }) }));
vi.mock('@/lib/tokens', () => ({ verifyAccess: m.verifyAccess }));
vi.mock('@/lib/env', () => ({ env: () => m.env }));
vi.mock('next/headers', () => ({ headers: m.headers }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }));

const rbac = await import('@/lib/rbac');
const { guardDocs } = await import('@/lib/docs-access');
const { listAudit } = await import('@/lib/admin-service');

beforeEach(() => {
  vi.clearAllMocks();
  m.customFind.mockResolvedValue([]);
  m.env.NODE_ENV = 'production';
});

const cookieHeaders = () => new Headers({ cookie: 'session=fake' });

describe('activeUserWhere', () => {
  it('requires verified email and no active ban', () => {
    const where = rbac.activeUserWhere();
    expect(where.emailVerified).toBe(true);
    expect(where.OR[0]).toEqual({ banned: false });
    expect(where.OR[1].banExpires?.lt).toBeInstanceOf(Date);
    expect(rbac.activeUserWhere()).not.toBe(where);
  });
});

describe('identify', () => {
  it('verifies bearer tokens and rejects non-bearer authorization schemes', async () => {
    m.verifyAccess.mockResolvedValue({ userId: 'u1', sessionId: 's1', familyId: 'f1' });
    await expect(rbac.identify(new Headers({ authorization: 'Bearer abc' }))).resolves.toEqual({
      userId: 'u1',
      sessionId: 's1',
      familyId: 'f1',
    });
    expect(m.verifyAccess).toHaveBeenCalledWith('abc');
    await expect(rbac.identify(new Headers({ authorization: 'Basic abc' }))).rejects.toMatchObject({
      status: 401,
    });
    expect(m.getSession).not.toHaveBeenCalled();
  });

  it('requires a Better Auth session that the database still considers active', async () => {
    m.getSession.mockResolvedValue(null);
    await expect(rbac.identify(cookieHeaders())).rejects.toMatchObject({ status: 401 });

    m.getSession.mockResolvedValue({ session: { id: 's1' } });
    m.sessionFind.mockResolvedValue(null);
    await expect(rbac.identify(cookieHeaders())).rejects.toMatchObject({ status: 401 });
    const where = m.sessionFind.mock.calls[0][0].where;
    expect(where.id).toBe('s1');
    expect(where.user.emailVerified).toBe(true);

    m.sessionFind.mockResolvedValue({ id: 's1', userId: 'u1' });
    await expect(rbac.identify(cookieHeaders())).resolves.toEqual({
      userId: 'u1',
      sessionId: 's1',
    });
  });
});

describe('grants and authorize', () => {
  it('resolves declared roles and ignores unknown ones (fail closed)', async () => {
    m.userFind.mockResolvedValue({ role: 'viewer, superuser' });
    const g = await rbac.grants('u1');
    expect(g.roles).toEqual(['viewer']);
    expect(g.permissions.has('audit:read')).toBe(true);
    expect(g.permissions.has('providers:manage')).toBe(false);

    m.userFind.mockResolvedValue(null);
    const none = await rbac.grants('ghost');
    expect(none.roles).toEqual([]);
    expect(none.permissions.size).toBe(0);
  });

  it('uses the provided transaction client', async () => {
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      customRole: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const g = await rbac.grants('u1', tx as never);
    expect(tx.user.findUnique).toHaveBeenCalled();
    expect(m.userFind).not.toHaveBeenCalled();
    expect(g.roles).toEqual(['owner']);
  });

  it('rejects inactive sessions with 401', async () => {
    m.sessionFind.mockResolvedValue(null);
    await expect(
      rbac.authorize({ userId: 'u1', sessionId: 's1' }, 'dashboard:read'),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects missing permissions and owner-only permissions for non-owners', async () => {
    m.sessionFind.mockResolvedValue({ id: 's1' });
    m.userFind.mockResolvedValue({ role: 'user' });
    await expect(
      rbac.authorize({ userId: 'u1', sessionId: 's1' }, 'dashboard:read'),
    ).rejects.toMatchObject({
      status: 403,
    });
    m.userFind.mockResolvedValue({ role: 'administrator' });
    await expect(
      rbac.authorize({ userId: 'u1', sessionId: 's1' }, 'roles:assign'),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      rbac.authorize({ userId: 'u1', sessionId: 's1' }, 'users:update'),
    ).resolves.toMatchObject({
      roles: ['administrator'],
    });
    m.userFind.mockResolvedValue({ role: 'owner' });
    await expect(
      rbac.authorize({ userId: 'u1', sessionId: 's1' }, 'providers:manage'),
    ).resolves.toMatchObject({
      roles: ['owner'],
    });
  });
});

describe('page guards', () => {
  beforeEach(() => {
    m.headers.mockResolvedValue(cookieHeaders());
    m.getSession.mockResolvedValue({ session: { id: 's1' } });
  });

  it('returns identity and grants for an authorized page', async () => {
    m.sessionFind.mockResolvedValue({ id: 's1', userId: 'u1' });
    m.userFind.mockResolvedValue({ role: 'viewer' });
    const page = await rbac.requirePage('dashboard:read');
    expect(page).toMatchObject({ userId: 'u1', sessionId: 's1', roles: ['viewer'] });
    const grants = await rbac.pageGrants();
    expect(grants.roles).toEqual(['viewer']);
  });

  it('redirects unauthenticated visitors to sign in', async () => {
    m.getSession.mockResolvedValue(null);
    await expect(rbac.requirePage('dashboard:read')).rejects.toThrow('REDIRECT:/auth/sign-in');
  });

  it('redirects unauthorized visitors to access denied', async () => {
    m.sessionFind.mockResolvedValue({ id: 's1', userId: 'u1' });
    m.userFind.mockResolvedValue({ role: 'user' });
    await expect(rbac.requirePage('dashboard:read')).rejects.toThrow('REDIRECT:/access-denied');
  });

  it('rethrows unexpected errors', async () => {
    m.getSession.mockRejectedValue(new Error('db down'));
    await expect(rbac.requirePage('dashboard:read')).rejects.toThrow('db down');
    m.getSession.mockRejectedValue(new HttpError(503, 'UNAVAILABLE', 'x'));
    await expect(rbac.requirePage('dashboard:read')).rejects.toMatchObject({ status: 503 });
  });
});

describe('guardDocs', () => {
  const req = () =>
    new Request('http://localhost:3000/api/docs', { headers: { cookie: 'session=fake' } });

  it('is open in development without identifying the caller', async () => {
    m.env.NODE_ENV = 'development';
    await guardDocs(req());
    expect(m.getSession).not.toHaveBeenCalled();
  });

  it('requires an owner outside development', async () => {
    m.getSession.mockResolvedValue({ session: { id: 's1' } });
    m.sessionFind.mockResolvedValue({ id: 's1', userId: 'u1' });
    m.userFind.mockResolvedValue({ role: 'administrator' });
    await expect(guardDocs(req())).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    m.userFind.mockResolvedValue({ role: 'owner' });
    await expect(guardDocs(req())).resolves.toBeUndefined();

    m.getSession.mockResolvedValue(null);
    await expect(guardDocs(req())).rejects.toMatchObject({ status: 401 });
  });
});

describe('listAudit', () => {
  it('paginates newest first', async () => {
    m.auditFind.mockResolvedValue([{ id: 'a' }]);
    m.auditCount.mockResolvedValue(41);
    await expect(listAudit(3, 10)).resolves.toEqual({
      data: [{ id: 'a' }],
      total: 41,
      page: 3,
      pageSize: 10,
    });
    expect(m.auditFind).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      skip: 20,
    });
    await listAudit();
    expect(m.auditFind).toHaveBeenLastCalledWith(expect.objectContaining({ take: 20, skip: 0 }));
  });
});
