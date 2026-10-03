import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { HttpError } from '@/lib/errors';

/**
 * Unit coverage for the emailed first-owner setup flow.
 *
 * Prisma is replaced by a tiny in-memory fake, so a rejected request can be shown never to write
 * anything, and Redis and the mailer are mocked: no live service and no real message is involved.
 * The six-digit code is only ever read back from the mocked `sendMail` call, never printed.
 */

const envValue = {
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  TRUST_PROXY: false,
};

const rateLimit = vi.fn();
const requestIP = vi.fn(() => 'shared');
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));

class KnownRequestError extends Error {
  constructor(
    public code: string,
    public meta?: { target?: unknown },
  ) {
    super('known request error');
  }
}

type Row = Record<string, unknown>;

/** Minimal Prisma `where` matcher: equality plus the filter operators this feature uses. */
function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return (value as Row[]).every((clause) => matches(row, clause));
    if (key === 'OR') return (value as Row[]).some((clause) => matches(row, clause));
    if (value instanceof Date) return row[key] instanceof Date && +(row[key] as Date) === +value;
    if (value !== null && typeof value === 'object') {
      const filter = value as Record<string, unknown>;
      if ('contains' in filter) return String(row[key] ?? '').includes(String(filter.contains));
      if ('equals' in filter) return row[key] === filter.equals;
      if ('not' in filter) return filter.not === null ? row[key] != null : row[key] !== filter.not;
      if ('lt' in filter) return (row[key] as number) < (filter.lt as number);
      if ('lte' in filter) return (row[key] as number) <= (filter.lte as number);
      if ('gt' in filter) return (row[key] as number) > (filter.gt as number);
      if ('gte' in filter) return (row[key] as number) >= (filter.gte as number);
      return false;
    }
    return row[key] === value;
  });
}

function applyUpdate(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      const op = value as Record<string, number>;
      if ('increment' in op) {
        row[key] = ((row[key] as number) ?? 0) + op.increment;
        continue;
      }
      if ('set' in op) {
        row[key] = (op as unknown as { set: unknown }).set;
        continue;
      }
    }
    row[key] = value;
  }
  row.updatedAt = new Date();
  return row;
}

function model(
  name: string,
  defaults: () => Row,
  unique: string[],
  /** Relation fields the service `select`s; Prisma returns them nested, so the fake must too. */
  relations: (row: Row) => Row = () => ({}),
) {
  const rows: Row[] = [];
  const read = (row: Row) => ({ ...row, ...relations(row) });
  const conflict = (candidate: Row, ignore?: Row) => {
    for (const field of unique) {
      if (candidate[field] == null) continue;
      const clash = rows.find((row) => row !== ignore && row[field] === candidate[field]);
      if (clash) throw new KnownRequestError('P2002', { target: [`${name}_${field}`] });
    }
  };
  const api = {
    rows,
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { ...defaults(), ...data };
      conflict(row);
      rows.push(row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? read(row) : null;
    }),
    findFirst: vi.fn(async ({ where }: { where?: Row } = {}) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? read(row) : null;
    }),
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) =>
      rows.filter((row) => matches(row, where)).map(read),
    ),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new KnownRequestError('P2025');
      conflict({ ...row, ...data }, row);
      return { ...applyUpdate(row, data) };
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Row; data: Row }) => {
      const found = rows.filter((row) => matches(row, where));
      found.forEach((row) => applyUpdate(row, data));
      return { count: found.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (row) return { ...applyUpdate(row, update) };
      return api.create({ data: create });
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = rows.findIndex((row) => matches(row, where));
      if (index < 0) throw new KnownRequestError('P2025');
      return { ...rows.splice(index, 1)[0] };
    }),
    count: vi.fn(
      async ({ where }: { where?: Row } = {}) => rows.filter((row) => matches(row, where)).length,
    ),
  };
  return api;
}

// Declared before `store` so the owner-setup relation hydrator can reference it without the
// circular type inference a self-referencing object literal would cause.
const user = model('app_user', () => ({ emailVerified: false, banned: false, role: null }), [
  'id',
  'email',
]);

const store = {
  user,
  account: model('account', () => ({}), ['id']),
  auditLog: model('audit_logs', () => ({ createdAt: new Date() }), ['id']),
  installationSetup: model('installation_setup', () => ({ completedBy: null }), ['id']),
  ownerSetupRequest: model(
    'owner_setup_requests',
    () => ({ attempts: 0, consumedAt: null, lastSentAt: null, createdAt: new Date() }),
    ['id', 'userId'],
    // The service reads `request.user.email` to recompute the keyed digest, so the relation must
    // resolve to the live user row exactly as Prisma's nested `select` would.
    (row) => {
      const owner = user.rows.find((candidate) => candidate.id === row.userId);
      return { user: owner ? { ...owner } : null };
    },
  ),
};

const queryRaw = vi.fn(async () => []);
const transaction = vi.fn(async (work: unknown) =>
  typeof work === 'function'
    ? (work as (client: unknown) => Promise<unknown>)(client)
    : Promise.all(work as Promise<unknown>[]),
);
// The fake is handed to transaction callbacks unchanged, so the service may use `db` or `tx`.
const client = { ...store, $queryRaw: queryRaw, $executeRaw: queryRaw, $transaction: transaction };

function reset() {
  for (const table of Object.values(store)) table.rows.length = 0;
}
/** Any row anywhere means the request reached the database. */
const dbUntouched = () =>
  Object.values(store).every((table) => table.rows.length === 0) &&
  transaction.mock.calls.length === 0;

vi.mock('@/lib/env', () => ({ env: () => envValue }));
vi.mock('@/lib/redis', () => ({ rateLimit, requestIP }));
vi.mock('@/lib/mailer', () => ({ sendMail }));
vi.mock('@/db', () => ({
  db: client,
  Prisma: { PrismaClientKnownRequestError: KnownRequestError },
}));

const { setupInput, setupResendInput, setupVerifyInput } = await import('@/lib/setup-validation');
const {
  getInitialOwnerSetupStatus,
  resendInitialOwnerSetup,
  startInitialOwnerSetup,
  verifyInitialOwnerSetup,
  SETUP_MARKER_ID,
} = await import('@/lib/initial-owner-setup');
const setupRoute = await import('@/app/api/setup/route');
const verifyRoute = await import('@/app/api/setup/verify/route');
const resendRoute = await import('@/app/api/setup/resend/route');

const password = 'Correct-Horse-Battery-1';
const valid = { name: 'Olivia Owner', email: 'owner@example.com', password };

function request(url: string, payload: unknown, init: RequestInit = {}) {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...init,
  });
}

/** The mailed code, read from the mocked mailer. Never logged. */
function mailedCode(call = sendMail.mock.calls.length - 1) {
  const mail = sendMail.mock.calls.at(call)?.[0] as { subject: string; text: string } | undefined;
  expect(mail, 'A verification mail must be sent').toBeTruthy();
  const code = /\b\d{6}\b/.exec(mail!.text)?.[0];
  expect(Boolean(code), 'The mail must carry a six-digit code').toBe(true);
  return code!;
}

/** Purpose label the service binds into every code digest. */
const PURPOSE = 'owner-setup:v1';

/** The keyed digest the service must store: HMAC-SHA256 over the whole bound tuple. */
function digest(parts: unknown[]) {
  return createHmac('sha256', envValue.BETTER_AUTH_SECRET)
    .update(JSON.stringify(parts), 'utf8')
    .digest('hex');
}

async function start(overrides: Partial<typeof valid> = {}) {
  const result = await startInitialOwnerSetup(setupInput.parse({ ...valid, ...overrides }));
  return { ...result, code: mailedCode() };
}

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  rateLimit.mockResolvedValue(undefined);
  requestIP.mockReturnValue('shared');
  sendMail.mockResolvedValue(undefined);
  queryRaw.mockResolvedValue([]);
});

describe('setup input validation', () => {
  it('normalizes the name and email before they reach the database', () => {
    const parsed = setupInput.parse({
      ...valid,
      name: '  Olivia Owner  ',
      email: '  Owner@Example.COM ',
    });
    expect(parsed.name).toBe('Olivia Owner');
    expect(parsed.email).toBe('owner@example.com');
  });

  it('rejects unknown keys, bad emails and out-of-range values', () => {
    expect(() => setupInput.parse({ ...valid, role: 'owner' })).toThrow();
    // The flow is no longer secret-gated, so a setup secret is just an unknown key.
    expect(() => setupInput.parse({ ...valid, setupSecret: 's'.repeat(32) })).toThrow();
    expect(() => setupInput.parse({ ...valid, email: 'not-an-email' })).toThrow();
    expect(() => setupInput.parse({ ...valid, email: `${'a'.repeat(250)}@example.com` })).toThrow();
    expect(() => setupInput.parse({ ...valid, name: '   ' })).toThrow();
    expect(() => setupInput.parse({ ...valid, name: 'n'.repeat(101) })).toThrow();
    expect(() => setupInput.parse({ ...valid, password: 'short-11chr' })).toThrow();
    expect(() => setupInput.parse({ ...valid, password: 'p'.repeat(129) })).toThrow();
  });

  it('requires a UUID request id and a six-digit code to verify or resend', () => {
    const requestId = randomUUID();
    expect(setupVerifyInput.parse({ requestId, code: '012345' })).toEqual({
      requestId,
      code: '012345',
    });
    expect(() => setupVerifyInput.parse({ requestId: 'not-a-uuid', code: '012345' })).toThrow();
    expect(() => setupVerifyInput.parse({ requestId, code: '12345' })).toThrow();
    expect(() => setupVerifyInput.parse({ requestId, code: '12345a' })).toThrow();
    expect(() => setupVerifyInput.parse({ requestId, code: '012345', extra: 1 })).toThrow();
    expect(setupResendInput.parse({ requestId })).toEqual({ requestId });
    expect(() => setupResendInput.parse({ requestId, code: '012345' })).toThrow();
  });
});

describe('availability', () => {
  it('reports available on a fresh installation', async () => {
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('available');
  });

  it('reports completed when the marker exists', async () => {
    store.installationSetup.rows.push({ id: SETUP_MARKER_ID, method: 'web' });
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('completed');
  });

  it('persists the marker when an owner exists without one', async () => {
    store.user.rows.push({ id: 'u1', role: 'user,owner' });
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('completed');
    expect(store.installationSetup.rows).toEqual([
      expect.objectContaining({ id: SETUP_MARKER_ID, completedBy: 'u1' }),
    ]);
  });

  it('does not treat a role that merely contains "owner" as owner membership', async () => {
    store.user.rows.push({ id: 'u1', role: 'co-owner' });
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('available');
    expect(store.installationSetup.rows).toHaveLength(0);
  });

  it('stays available while a setup request is only pending', async () => {
    await start();
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('available');
  });
});

describe('starting setup', () => {
  it('creates an unverified ordinary user, a credential account and a pending request', async () => {
    const before = Date.now();
    const result = await startInitialOwnerSetup(setupInput.parse(valid));

    const user = store.user.rows[0];
    expect(user).toMatchObject({ email: valid.email, name: valid.name, emailVerified: false });
    expect(user.role).toBe('user');

    const account = store.account.rows[0];
    expect(account.providerId).toBe('credential');
    expect(account.accountId).toBe(user.id);
    expect(account.password).not.toBe(password);

    const pending = store.ownerSetupRequest.rows[0];
    expect(pending.userId).toBe(user.id);
    expect(String(pending.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(pending.attempts).toBe(0);
    expect(pending.consumedAt).toBeNull();
    expect(+(pending.lastSentAt as Date)).toBeGreaterThanOrEqual(before);
    const ttl = +(pending.expiresAt as Date) - before;
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000);

    // Nothing owner-shaped exists yet.
    expect(store.installationSetup.rows).toHaveLength(0);
    expect(store.auditLog.rows).toHaveLength(0);
    expect(result).toEqual({
      requestId: pending.id,
      email: valid.email,
      expiresAt: pending.expiresAt,
      resendAvailableAt: expect.any(Date),
      deliverySent: true,
    });
  });

  it('mails a six-digit code and stores only a keyed digest of it', async () => {
    const { requestId, code } = await start();
    const mail = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe(valid.email);
    expect(mail.subject).toBe('Verify your Jarxis Owner email');
    expect(mail.text).toContain(code);
    expect(mail.text).not.toContain(password);

    const hash = String(store.ownerSetupRequest.rows[0].codeHash);
    expect(hash).not.toContain(code);
    // A keyed digest, not a bare hash an attacker could recompute from the code alone.
    expect(hash).not.toBe(createHash('sha256').update(code).digest('hex'));

    // The MAC input binds the purpose label, the request id, the recipient and the code, so a
    // stored digest is useless for any other request, address or flow.
    expect(hash).toBe(digest([PURPOSE, requestId, valid.email, code]));
    expect(hash).not.toBe(digest([PURPOSE, randomUUID(), valid.email, code]));
    expect(hash).not.toBe(digest([PURPOSE, requestId, 'someone-else@example.com', code]));
    expect(hash).not.toBe(digest(['other-purpose:v1', requestId, valid.email, code]));
    expect(hash).not.toBe(digest([PURPOSE, requestId, valid.email, '000000']));
  });

  it('keeps the pending request and reports no delivery when the provider fails', async () => {
    sendMail.mockRejectedValue(new Error('Email delivery failed'));
    const result = await startInitialOwnerSetup(setupInput.parse(valid));
    expect(result.deliverySent).toBe(false);
    expect(store.ownerSetupRequest.rows).toHaveLength(1);
    expect(store.installationSetup.rows).toHaveLength(0);
    expect(store.user.rows[0].role).toBe('user');
  });

  it('never promotes an existing account and reports a taken email as a conflict', async () => {
    store.user.rows.push({ id: 'existing', email: valid.email, role: 'user', emailVerified: true });
    await expect(startInitialOwnerSetup(setupInput.parse(valid))).rejects.toMatchObject({
      status: 409,
    });
    expect(store.user.rows).toHaveLength(1);
    expect(store.user.rows[0].role).toBe('user');
    expect(store.ownerSetupRequest.rows).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses once setup is closed', async () => {
    store.installationSetup.rows.push({ id: SETUP_MARKER_ID, method: 'web' });
    await expect(startInitialOwnerSetup(setupInput.parse(valid))).rejects.toMatchObject({
      status: 409,
    });
    expect(store.user.rows).toHaveLength(0);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('verifying the code', () => {
  it('grants owner, verifies the email, consumes the request and writes the marker', async () => {
    const { requestId, code } = await start();
    await expect(verifyInitialOwnerSetup({ requestId, code })).resolves.toBeTruthy();

    const user = store.user.rows[0];
    expect(user.role).toBe('owner');
    expect(user.emailVerified).toBe(true);
    expect(store.ownerSetupRequest.rows[0].consumedAt).toBeInstanceOf(Date);

    const audit = store.auditLog.rows[0];
    expect(audit.action).toBe('owner.bootstrap');
    expect(audit.targetId).toBe(user.id);
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(JSON.stringify(audit)).not.toContain(code);

    expect(store.installationSetup.rows).toEqual([
      expect.objectContaining({ id: SETUP_MARKER_ID, completedBy: user.id }),
    ]);
    // Serialized by the bootstrap advisory lock.
    expect(queryRaw.mock.calls.flat().some((sql) => JSON.stringify(sql).includes('72419831'))).toBe(
      true,
    );
    await expect(getInitialOwnerSetupStatus()).resolves.toBe('completed');
  });

  it('rejects a wrong code, keeps the request pending and records the attempt', async () => {
    const { requestId, code } = await start();
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(verifyInitialOwnerSetup({ requestId, code: wrong })).rejects.toMatchObject({
      status: 400,
    });
    expect(store.ownerSetupRequest.rows[0].attempts).toBe(1);
    expect(store.ownerSetupRequest.rows[0].consumedAt).toBeNull();
    expect(store.user.rows[0].role).toBe('user');
    expect(store.installationSetup.rows).toHaveLength(0);
    // The correct code still works while attempts remain.
    await expect(verifyInitialOwnerSetup({ requestId, code })).resolves.toBeTruthy();
  });

  it('answers 429 on the fifth wrong code, not 400', async () => {
    const { requestId, code } = await start();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(verifyInitialOwnerSetup({ requestId, code: wrong })).rejects.toMatchObject({
        status: 400,
      });
      expect(store.ownerSetupRequest.rows[0].attempts).toBe(attempt);
    }
    // The attempt that reaches the limit exhausts the request, so it is rate-limited, not invalid.
    await expect(verifyInitialOwnerSetup({ requestId, code: wrong })).rejects.toMatchObject({
      status: 429,
    });
    expect(store.ownerSetupRequest.rows[0].attempts).toBe(5);
    expect(store.user.rows[0].role).toBe('user');
  });

  it('refuses every further attempt once five wrong codes are recorded', async () => {
    const { requestId, code } = await start();
    store.ownerSetupRequest.rows[0].attempts = 5;
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 429,
    });
    expect(store.user.rows[0].role).toBe('user');
    expect(store.installationSetup.rows).toHaveLength(0);
  });

  it('rejects an expired code', async () => {
    const { requestId, code } = await start();
    store.ownerSetupRequest.rows[0].expiresAt = new Date(Date.now() - 1_000);
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 400,
    });
    expect(store.user.rows[0].role).toBe('user');
  });

  it('rejects a replay of a consumed request', async () => {
    const { requestId, code } = await start();
    await verifyInitialOwnerSetup({ requestId, code });
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 409,
    });
    expect(store.user.rows.filter((row) => row.role === 'owner')).toHaveLength(1);
  });

  it('reports an unknown request id as missing', async () => {
    await expect(
      verifyInitialOwnerSetup({ requestId: randomUUID(), code: '123456' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(store.user.rows).toHaveLength(0);
  });
});

describe('resending the code', () => {
  it('issues a new code, resets attempts and invalidates the previous code', async () => {
    const { requestId, code } = await start();
    store.ownerSetupRequest.rows[0].attempts = 3;
    store.ownerSetupRequest.rows[0].lastSentAt = new Date(Date.now() - 120_000);
    store.ownerSetupRequest.rows[0].expiresAt = new Date(Date.now() - 1);

    const beforeResend = Date.now();
    const result = await resendInitialOwnerSetup({ requestId });
    const next = mailedCode();
    expect(next).not.toBe(code);
    expect(result).toEqual({
      requestId,
      email: valid.email,
      expiresAt: expect.any(Date),
      resendAvailableAt: expect.any(Date),
      deliverySent: true,
    });
    expect(+result.expiresAt).toBeGreaterThanOrEqual(beforeResend + 10 * 60 * 1000);
    expect(store.ownerSetupRequest.rows[0].attempts).toBe(0);

    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 400,
    });
    await expect(verifyInitialOwnerSetup({ requestId, code: next })).resolves.toBeTruthy();
  });

  it('enforces a sixty-second cooldown', async () => {
    const { requestId } = await start();
    await expect(resendInitialOwnerSetup({ requestId })).rejects.toMatchObject({ status: 429 });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown request id as missing', async () => {
    await expect(resendInitialOwnerSetup({ requestId: randomUUID() })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('POST /api/setup', () => {
  it('accepts the submission and returns metadata only', async () => {
    const response = await setupRoute.POST(request('/api/setup', valid));
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain(password);
    expect(text).not.toContain(mailedCode());
    expect(JSON.parse(text)).toEqual({
      requestId: store.ownerSetupRequest.rows[0].id,
      email: valid.email,
      expiresAt: expect.any(String),
      resendAvailableAt: expect.any(String),
      deliverySent: true,
    });
  });

  it('still answers 202 with deliverySent false when the provider fails', async () => {
    sendMail.mockRejectedValue(new Error('Email delivery failed'));
    const response = await setupRoute.POST(request('/api/setup', valid));
    expect(response.status).toBe(202);
    expect((await response.json()).deliverySent).toBe(false);
    expect(store.ownerSetupRequest.rows).toHaveLength(1);
  });

  it('rate limits per source IP before processing the body', async () => {
    rateLimit.mockRejectedValue(new HttpError(429, 'RATE_LIMITED', 'Too many requests'));
    const response = await setupRoute.POST(request('/api/setup', 'not json at all'));
    expect(response.status).toBe(429);
    expect(rateLimit).toHaveBeenCalled();
    expect(dbUntouched()).toBe(true);
  });

  it('rejects a foreign origin before the rate limit or the database', async () => {
    const response = await setupRoute.POST(
      request('/api/setup', valid, { headers: { Origin: 'http://evil.example' } }),
    );
    expect(response.status).toBe(403);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(dbUntouched()).toBe(true);
  });

  it('rejects an invalid body with a validation error and no database work', async () => {
    const response = await setupRoute.POST(request('/api/setup', { ...valid, password: 'short' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(dbUntouched()).toBe(true);
  });

  it('exposes availability over GET', async () => {
    const response = await setupRoute.GET(new Request('http://localhost:3000/api/setup'));
    expect(await response.json()).toEqual({ status: 'available' });
  });
});

describe('POST /api/setup/verify', () => {
  it('confirms the owner without echoing the code', async () => {
    const { requestId, code } = await start();
    const response = await verifyRoute.POST(request('/api/setup/verify', { requestId, code }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(code);
    expect(text).not.toContain(password);
    // The route echoes the new owner's identity, never the code, the password or the digest.
    expect(JSON.parse(text)).toEqual({
      success: true,
      owner: { id: store.user.rows[0].id, name: valid.name, email: valid.email },
    });
    expect(store.user.rows[0].role).toBe('owner');
  });

  it('answers 400 for a wrong code and 404 for an unknown request', async () => {
    const { requestId, code } = await start();
    const wrong = code === '000000' ? '111111' : '000000';
    expect(
      (await verifyRoute.POST(request('/api/setup/verify', { requestId, code: wrong }))).status,
    ).toBe(400);
    expect(
      (
        await verifyRoute.POST(
          request('/api/setup/verify', { requestId: randomUUID(), code: '123456' }),
        )
      ).status,
    ).toBe(404);
  });

  it('rejects a malformed code before touching the database', async () => {
    const response = await verifyRoute.POST(
      request('/api/setup/verify', { requestId: randomUUID(), code: 'abc' }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(dbUntouched()).toBe(true);
  });

  it('rate limits before reading the body', async () => {
    rateLimit.mockRejectedValue(new HttpError(429, 'RATE_LIMITED', 'Too many requests'));
    const response = await verifyRoute.POST(request('/api/setup/verify', 'junk'));
    expect(response.status).toBe(429);
    expect(dbUntouched()).toBe(true);
  });
});

describe('POST /api/setup/resend', () => {
  it('returns the same metadata shape and no code', async () => {
    const { requestId } = await start();
    store.ownerSetupRequest.rows[0].lastSentAt = new Date(Date.now() - 120_000);
    const response = await resendRoute.POST(request('/api/setup/resend', { requestId }));
    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).not.toContain(mailedCode());
    expect(JSON.parse(text)).toEqual({
      requestId,
      email: valid.email,
      expiresAt: expect.any(String),
      resendAvailableAt: expect.any(String),
      deliverySent: true,
    });
  });

  it('answers 429 inside the cooldown window', async () => {
    const { requestId } = await start();
    const response = await resendRoute.POST(request('/api/setup/resend', { requestId }));
    expect(response.status).toBe(429);
  });
});
