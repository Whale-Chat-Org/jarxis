import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

const m = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn(), deleteMany: vi.fn() },
    tokenFamily: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  refreshLookup: vi.fn(),
  familyLookup: vi.fn(),
  sessionLookup: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn(m.tx),
    refreshToken: { findUnique: m.refreshLookup },
    tokenFamily: { findFirst: m.familyLookup },
    session: { findFirst: m.sessionLookup },
  },
}));

const { issueTokens, rotateTokens, verifyAccess, revokeFamily, tokenHash } =
  await import('@/lib/tokens');

const ISSUER = 'http://localhost:3000';
const JWT_SECRET = 'b'.repeat(64);
const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 1000);
const activeUser = { id: 'u1', emailVerified: true, banned: false, banExpires: null };
const family = (extra: Record<string, unknown> = {}) => ({
  id: 'f1',
  userId: 'u1',
  sessionId: 's1',
  expiresAt: future(),
  revokedAt: null,
  ...extra,
});

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_URL: ISSUER,
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    JWT_SECRET,
    BREVO_API_KEY: 'xkeysib-test',
    MAIL_FROM: 'Jarxis <noreply@example.com>',
  });
});
beforeEach(() => {
  vi.resetAllMocks();
});

function sign(
  claims: Record<string, unknown>,
  opts: { secret?: string; aud?: string; iss?: string; alg?: string } = {},
) {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'HS256', typ: 'JWT' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'jarxis-api')
    .setIssuedAt()
    .setExpirationTime('5m');
  if (typeof claims.sub === 'string') jwt = jwt.setSubject(claims.sub);
  return jwt.sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
}

describe('issueTokens', () => {
  it('locks the user, creates a family capped at 30 days and stores only the hash', async () => {
    const sessionExpiry = new Date(Date.now() + 90 * 86400000);
    m.tx.user.findUnique.mockResolvedValue(activeUser);
    m.tx.session.findFirst.mockResolvedValue({ id: 's1', expiresAt: sessionExpiry });
    m.tx.tokenFamily.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    const result = await issueTokens('u1', 'session-token');

    expect(m.tx.$queryRaw).toHaveBeenCalledTimes(1);
    const created = m.tx.tokenFamily.create.mock.calls[0][0].data;
    expect(created.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 86400000);
    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: 600 });
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const stored = m.tx.refreshToken.create.mock.calls[0][0].data;
    expect(stored).toEqual({ hash: tokenHash(result.refreshToken), familyId: created.id });
    expect(stored.hash).not.toBe(result.refreshToken);

    // The issued access token verifies against the same family and session.
    m.familyLookup.mockResolvedValue({ ...family({ id: created.id }), user: activeUser });
    m.sessionLookup.mockResolvedValue({ id: 's1', expiresAt: future() });
    await expect(verifyAccess(result.accessToken)).resolves.toEqual({
      userId: 'u1',
      sessionId: 's1',
      familyId: created.id,
    });
  });

  it('rejects inactive or missing users and missing sessions', async () => {
    m.tx.user.findUnique.mockResolvedValue(null);
    await expect(issueTokens('u1', 't')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_TOKEN',
    });
    m.tx.user.findUnique.mockResolvedValue({ ...activeUser, emailVerified: false });
    await expect(issueTokens('u1', 't')).rejects.toMatchObject({ status: 401 });
    m.tx.user.findUnique.mockResolvedValue({ ...activeUser, banned: true });
    await expect(issueTokens('u1', 't')).rejects.toMatchObject({ status: 401 });
    m.tx.user.findUnique.mockResolvedValue(activeUser);
    m.tx.session.findFirst.mockResolvedValue(null);
    await expect(issueTokens('u1', 't')).rejects.toMatchObject({ status: 401 });
    expect(m.tx.tokenFamily.create).not.toHaveBeenCalled();
  });
});

describe('rotateTokens', () => {
  const raw = 'r'.repeat(64);
  function known() {
    m.refreshLookup.mockResolvedValue({ hash: tokenHash(raw), family: family() });
    m.tx.user.findUnique.mockResolvedValue(activeUser);
    m.tx.tokenFamily.findUnique.mockResolvedValue(family());
    m.tx.refreshToken.findUnique.mockResolvedValue({ hash: tokenHash(raw), consumedAt: null });
    m.tx.session.findFirst.mockResolvedValue({ id: 's1', expiresAt: future() });
  }

  it('rejects an unknown token without opening a transaction', async () => {
    m.refreshLookup.mockResolvedValue(null);
    await expect(rotateTokens(raw)).rejects.toMatchObject({ status: 401 });
    expect(m.refreshLookup).toHaveBeenCalledWith({
      where: { hash: tokenHash(raw) },
      include: { family: true },
    });
    expect(m.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('consumes the presented token and issues a new pair', async () => {
    known();
    const result = await rotateTokens(raw);
    expect(m.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(m.tx.refreshToken.update).toHaveBeenCalledWith({
      where: { hash: tokenHash(raw) },
      data: { consumedAt: expect.any(Date) },
    });
    expect(result.refreshToken).not.toBe(raw);
    expect(m.tx.refreshToken.create.mock.calls[0][0].data.familyId).toBe('f1');
  });

  it('revokes the whole family and its session on replay', async () => {
    known();
    m.tx.refreshToken.findUnique.mockResolvedValue({
      hash: tokenHash(raw),
      consumedAt: new Date(),
    });
    await expect(rotateTokens(raw)).rejects.toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
    expect(m.tx.tokenFamily.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(m.tx.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(m.tx.refreshToken.create).not.toHaveBeenCalled();
  });

  it.each([
    ['family missing', () => m.tx.tokenFamily.findUnique.mockResolvedValue(null)],
    ['token missing', () => m.tx.refreshToken.findUnique.mockResolvedValue(null)],
    ['user missing', () => m.tx.user.findUnique.mockResolvedValue(null)],
    ['user banned', () => m.tx.user.findUnique.mockResolvedValue({ ...activeUser, banned: true })],
    [
      'family revoked',
      () => m.tx.tokenFamily.findUnique.mockResolvedValue(family({ revokedAt: new Date() })),
    ],
    [
      'family expired',
      () => m.tx.tokenFamily.findUnique.mockResolvedValue(family({ expiresAt: past() })),
    ],
    ['session gone', () => m.tx.session.findFirst.mockResolvedValue(null)],
  ])('rejects when %s', async (_label, arrange) => {
    known();
    arrange();
    await expect(rotateTokens(raw)).rejects.toMatchObject({ status: 401 });
    expect(m.tx.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('verifyAccess', () => {
  const claims = { sub: 'u1', sid: 's1', fid: 'f1' };
  function valid() {
    m.familyLookup.mockResolvedValue({ ...family(), user: activeUser });
    m.sessionLookup.mockResolvedValue({ id: 's1', expiresAt: future() });
  }

  it('rejects tokens with a bad signature, issuer, audience or garbage', async () => {
    valid();
    for (const token of [
      await sign(claims, { secret: 'c'.repeat(64) }),
      await sign(claims, { iss: 'https://evil.test' }),
      await sign(claims, { aud: 'other' }),
      'not-a-jwt',
    ])
      await expect(verifyAccess(token)).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_TOKEN',
      });
    expect(m.familyLookup).not.toHaveBeenCalled();
  });

  it('rejects tokens missing required claims', async () => {
    for (const partial of [
      { sid: 's1', fid: 'f1' },
      { sub: 'u1', fid: 'f1' },
      { sub: 'u1', sid: 's1' },
    ])
      await expect(verifyAccess(await sign(partial))).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['family missing', () => m.familyLookup.mockResolvedValue(null)],
    ['session missing', () => m.sessionLookup.mockResolvedValue(null)],
    [
      'user inactive',
      () =>
        m.familyLookup.mockResolvedValue({
          ...family(),
          user: { ...activeUser, emailVerified: false },
        }),
    ],
    [
      'family revoked',
      () =>
        m.familyLookup.mockResolvedValue({
          ...family({ revokedAt: new Date() }),
          user: activeUser,
        }),
    ],
    [
      'family expired',
      () =>
        m.familyLookup.mockResolvedValue({ ...family({ expiresAt: past() }), user: activeUser }),
    ],
    ['session expired', () => m.sessionLookup.mockResolvedValue({ id: 's1', expiresAt: past() })],
  ])('rejects when %s', async (_label, arrange) => {
    valid();
    arrange();
    await expect(verifyAccess(await sign(claims))).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a valid token bound to a live family', async () => {
    valid();
    await expect(verifyAccess(await sign(claims))).resolves.toEqual({
      userId: 'u1',
      sessionId: 's1',
      familyId: 'f1',
    });
    expect(m.familyLookup).toHaveBeenCalledWith({
      where: { id: 'f1', userId: 'u1', sessionId: 's1' },
      include: { user: true },
    });
  });
});

describe('revokeFamily', () => {
  it('revokes the family and deletes its session', async () => {
    m.tx.tokenFamily.findFirst.mockResolvedValue(family());
    await revokeFamily('u1', 'f1');
    expect(m.tx.tokenFamily.findFirst).toHaveBeenCalledWith({ where: { id: 'f1', userId: 'u1' } });
    expect(m.tx.tokenFamily.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(m.tx.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('is a no-op for another user family', async () => {
    m.tx.tokenFamily.findFirst.mockResolvedValue(null);
    await revokeFamily('u2', 'f1');
    expect(m.tx.tokenFamily.update).not.toHaveBeenCalled();
    expect(m.tx.session.deleteMany).not.toHaveBeenCalled();
  });
});
