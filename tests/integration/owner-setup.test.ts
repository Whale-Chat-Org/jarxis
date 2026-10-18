import { verifyPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Database behaviour of the emailed first-owner setup flow.
 *
 * Destructive: truncates app_user, audit_logs and installation_setup (which cascades the pending
 * owner setup requests). Requires the dedicated jarxis_test database enforced by
 * tests/integration/setup.ts.
 *
 * The mailer is mocked, so this file never contacts Brevo and never delivers a message. The
 * six-digit code is read back from the captured `sendMail` argument and is never printed.
 */

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/mailer', () => ({ sendMail }));

const { db } = await import('@/db');
const {
  ensureInitialOwnerSetupStatus,
  recordSetupCompletion,
  resendInitialOwnerSetup,
  startInitialOwnerSetup,
  verifyInitialOwnerSetup,
  SETUP_MARKER_ID,
} = await import('@/lib/initial-owner-setup');
const { setupInput } = await import('@/lib/setup-validation');
const { grants, activeUserWhere } = await import('@/lib/rbac');

const password = 'Correct-Horse-Battery-1';
const input = (overrides: Record<string, unknown> = {}) =>
  setupInput.parse({
    name: '  Olivia Owner ',
    email: '  Owner@Example.COM ',
    password,
    ...overrides,
  });

/** The last mailed code, taken from the mock. Never logged. */
function capturedCode(index = sendMail.mock.calls.length - 1) {
  const mail = sendMail.mock.calls.at(index)?.[0] as { text: string } | undefined;
  expect(mail, 'A verification mail must have been sent').toBeTruthy();
  const code = /\b\d{6}\b/.exec(mail!.text)?.[0];
  expect(Boolean(code), 'The mail must carry a six-digit code').toBe(true);
  return code!;
}

async function start(overrides: Record<string, unknown> = {}) {
  const started = await startInitialOwnerSetup(input(overrides));
  return { ...started, code: capturedCode() };
}

async function makeUser(overrides: Partial<{ role: string; email: string }> = {}) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      name: 'Existing User',
      email: overrides.email ?? `${id}@example.test`,
      emailVerified: true,
      role: overrides.role ?? 'user',
    },
  });
}

/** Does a stored account pass the "usable account" gate every authenticated path applies? */
async function isUsable(userId: string) {
  const row = await db.user.findFirst({ where: { id: userId, ...activeUserWhere() } });
  return Boolean(row);
}

beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  vi.clearAllMocks();
  sendMail.mockResolvedValue(undefined);
  await db.$executeRaw`TRUNCATE app_user, audit_logs, installation_setup CASCADE`;
});
afterAll(async () => {
  await db.$disconnect();
});

describe('starting setup', () => {
  it('stores an unverified ordinary user, a usable credential hash and a hashed code', async () => {
    const started = await startInitialOwnerSetup(input());
    const code = capturedCode();

    const user = await db.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    expect(user.name).toBe('Olivia Owner');
    expect(user.emailVerified).toBe(false);
    expect(user.banned).toBe(false);
    expect(user.role ?? '').not.toContain('owner');
    // A pending candidate is not a usable account: authenticated paths must deny it.
    expect(await isUsable(user.id)).toBe(false);
    expect((await grants(user.id)).roles).not.toContain('owner');

    const account = await db.account.findFirstOrThrow({
      where: { userId: user.id, providerId: 'credential' },
    });
    expect(account.accountId).toBe(user.id);
    // Better Auth must be able to verify this hash, so the password signs in once verified.
    expect(await verifyPassword({ hash: account.password!, password })).toBe(true);
    expect(await verifyPassword({ hash: account.password!, password: 'wrong-password-1' })).toBe(
      false,
    );

    const pending = await db.ownerSetupRequest.findUniqueOrThrow({
      where: { id: started.requestId },
    });
    expect(pending.userId).toBe(user.id);
    expect(pending.attempts).toBe(0);
    expect(pending.consumedAt).toBeNull();
    expect(pending.lastSentAt).toBeInstanceOf(Date);
    expect(pending.codeHash).not.toContain(code);
    expect(+pending.expiresAt - Date.now()).toBeGreaterThan(8 * 60_000);

    // Only metadata leaves the service; the code is not part of the result.
    expect(JSON.stringify(started)).not.toContain(code);
    expect(started.deliverySent).toBe(true);

    // Nothing owner-shaped is written before verification.
    expect(await db.installationSetup.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'owner.bootstrap' } })).toBe(0);
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('available');
  });

  it('never promotes an existing email and rolls back completely', async () => {
    const existing = await makeUser({ email: 'owner@example.com' });
    await expect(startInitialOwnerSetup(input())).rejects.toMatchObject({ status: 409 });

    expect((await db.user.findUniqueOrThrow({ where: { id: existing.id } })).role).toBe('user');
    expect(await db.user.count()).toBe(1);
    expect(await db.account.count()).toBe(0);
    expect(await db.ownerSetupRequest.count()).toBe(0);
    expect(await db.installationSetup.count()).toBe(0);
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('available');
  });

  it('keeps the pending request when delivery fails so a resend can recover', async () => {
    sendMail.mockRejectedValueOnce(new Error('Email delivery failed'));
    const started = await startInitialOwnerSetup(input());
    expect(started.deliverySent).toBe(false);
    expect(await db.ownerSetupRequest.count()).toBe(1);
    expect(await db.installationSetup.count()).toBe(0);

    // Past the cooldown, a resend delivers a working code and completes the flow.
    await db.ownerSetupRequest.update({
      where: { id: started.requestId },
      data: { lastSentAt: new Date(Date.now() - 120_000) },
    });
    sendMail.mockResolvedValue(undefined);
    const resent = await resendInitialOwnerSetup({ requestId: started.requestId });
    expect(resent.deliverySent).toBe(true);
    await expect(
      verifyInitialOwnerSetup({ requestId: started.requestId, code: capturedCode() }),
    ).resolves.toBeTruthy();
    expect((await db.user.findFirstOrThrow()).role).toContain('owner');
  });
});

describe('verifying the code', () => {
  it('grants owner, verifies the email, consumes the request, audits and closes setup', async () => {
    const { requestId, code } = await start();
    await verifyInitialOwnerSetup({ requestId, code });

    const owner = await db.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    expect(owner.role).toContain('owner');
    expect(owner.emailVerified).toBe(true);
    expect(await isUsable(owner.id)).toBe(true);
    expect((await grants(owner.id)).roles).toContain('owner');

    const pending = await db.ownerSetupRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(pending.consumedAt).toBeInstanceOf(Date);

    const audit = await db.auditLog.findFirstOrThrow({ where: { targetId: owner.id } });
    expect(audit.action).toBe('owner.bootstrap');
    expect(JSON.stringify(audit.changes)).not.toContain(password);
    expect(JSON.stringify(audit.changes)).not.toContain(code);

    const marker = await db.installationSetup.findUniqueOrThrow({ where: { id: SETUP_MARKER_ID } });
    expect(marker.completedBy).toBe(owner.id);
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('completed');
  });

  it('persists five wrong attempts and then refuses even the correct code', async () => {
    const { requestId, code } = await start();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(verifyInitialOwnerSetup({ requestId, code: wrong })).rejects.toMatchObject({
        status: attempt < 5 ? 400 : 429,
      });
      // The attempt counter commits even though the request itself was rejected.
      expect(
        (await db.ownerSetupRequest.findUniqueOrThrow({ where: { id: requestId } })).attempts,
      ).toBe(attempt);
    }
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 429,
    });
    const user = await db.user.findFirstOrThrow();
    expect(user.role ?? '').not.toContain('owner');
    expect(user.emailVerified).toBe(false);
    expect(await db.installationSetup.count()).toBe(0);
  });

  it('rejects an expired code and leaves the candidate unverified', async () => {
    const { requestId, code } = await start();
    await db.ownerSetupRequest.update({
      where: { id: requestId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 400,
    });
    const user = await db.user.findFirstOrThrow();
    expect(user.emailVerified).toBe(false);
    expect(user.role ?? '').not.toContain('owner');
    expect(await db.installationSetup.count()).toBe(0);
  });

  it('lets exactly one of two concurrent correct verifications win', async () => {
    const { requestId, code } = await start();
    const results = await Promise.allSettled([
      verifyInitialOwnerSetup({ requestId, code }),
      verifyInitialOwnerSetup({ requestId, code }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.installationSetup.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'owner.bootstrap' } })).toBe(1);
    expect(await db.user.count({ where: { role: { contains: 'owner' } } })).toBe(1);
  });

  it('lets exactly one of two different pending candidates win a concurrent verification', async () => {
    // Setup stays open while requests are only pending, so two visitors can both hold a code.
    const first = await start();
    const second = await start({ email: 'second@example.com' });
    expect(second.requestId).not.toBe(first.requestId);
    expect(await db.ownerSetupRequest.count()).toBe(2);

    const results = await Promise.allSettled([
      verifyInitialOwnerSetup({ requestId: first.requestId, code: first.code }),
      verifyInitialOwnerSetup({ requestId: second.requestId, code: second.code }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected');
    // The late verification is refused because setup is now closed, not silently ignored.
    expect(loser).toMatchObject({ reason: { status: 409 } });

    // Exactly one owner, one marker and one audit row, whichever request got there first.
    const owners = await db.user.findMany({ where: { role: { contains: 'owner' } } });
    expect(owners).toHaveLength(1);
    expect(owners[0].emailVerified).toBe(true);
    expect(await db.installationSetup.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'owner.bootstrap' } })).toBe(1);

    // The loser's candidate account stays an unverified ordinary user it cannot use.
    const others = await db.user.findMany({ where: { id: { not: owners[0].id } } });
    expect(others).toHaveLength(1);
    expect(others[0].role ?? '').not.toContain('owner');
    expect(others[0].emailVerified).toBe(false);
    expect(await isUsable(others[0].id)).toBe(false);

    const marker = await db.installationSetup.findUniqueOrThrow({ where: { id: SETUP_MARKER_ID } });
    expect(marker.completedBy).toBe(owners[0].id);
  });

  it('rejects the original code once the recipient address is changed', async () => {
    const { requestId, code } = await start();
    const candidate = await db.user.findFirstOrThrow();

    // The digest is bound to the address the code was mailed to, so moving the account to another
    // mailbox cannot be combined with the code already delivered to the old one.
    await db.user.update({ where: { id: candidate.id }, data: { email: 'attacker@example.com' } });
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 400,
    });

    const after = await db.user.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(after.role ?? '').not.toContain('owner');
    expect(after.emailVerified).toBe(false);
    expect(await isUsable(after.id)).toBe(false);
    expect(await db.installationSetup.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'owner.bootstrap' } })).toBe(0);
    // The failed attempt is still accounted for, and the request stays pending for a resend.
    const pending = await db.ownerSetupRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(pending.attempts).toBe(1);
    expect(pending.consumedAt).toBeNull();
  });

  it('rejects a replay of a consumed request', async () => {
    const { requestId, code } = await start();
    await verifyInitialOwnerSetup({ requestId, code });
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.auditLog.count({ where: { action: 'owner.bootstrap' } })).toBe(1);
  });

  it('rolls back the grant when the audit write fails, and a retry still succeeds', async () => {
    // A CHECK constraint on audit_logs.action forces the audit write — the step after the role
    // grant — to fail, proving the whole verification transaction rolls back.
    const first = await start();
    await db.$executeRaw`ALTER TABLE audit_logs ADD CONSTRAINT audit_action_probe CHECK (action <> 'owner.bootstrap')`;
    try {
      await expect(
        verifyInitialOwnerSetup({ requestId: first.requestId, code: first.code }),
      ).rejects.toThrow();
    } finally {
      await db.$executeRaw`ALTER TABLE audit_logs DROP CONSTRAINT audit_action_probe`;
    }
    const pending = await db.ownerSetupRequest.findUniqueOrThrow({
      where: { id: first.requestId },
    });
    expect(pending.consumedAt).toBeNull();
    const candidate = await db.user.findFirstOrThrow();
    expect(candidate.role ?? '').not.toContain('owner');
    expect(candidate.emailVerified).toBe(false);
    expect(await db.installationSetup.count()).toBe(0);
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('available');

    // The same code still verifies once the failure is gone.
    await expect(
      verifyInitialOwnerSetup({ requestId: first.requestId, code: first.code }),
    ).resolves.toBeTruthy();
    expect(await db.installationSetup.count()).toBe(1);
  });

  it('refuses to promote a banned candidate account', async () => {
    const { requestId, code } = await start();
    const candidate = await db.user.findFirstOrThrow();
    await db.user.update({ where: { id: candidate.id }, data: { banned: true } });
    await expect(verifyInitialOwnerSetup({ requestId, code })).rejects.toThrow();
    const after = await db.user.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(after.role ?? '').not.toContain('owner');
    expect(await isUsable(after.id)).toBe(false);
    expect(await db.installationSetup.count()).toBe(0);
  });
});

describe('resending the code', () => {
  it('enforces the cooldown, then issues a new code that replaces the old one', async () => {
    const first = await start();
    await expect(resendInitialOwnerSetup({ requestId: first.requestId })).rejects.toMatchObject({
      status: 429,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);

    await db.ownerSetupRequest.update({
      where: { id: first.requestId },
      data: { attempts: 3, lastSentAt: new Date(Date.now() - 120_000) },
    });
    const resent = await resendInitialOwnerSetup({ requestId: first.requestId });
    const next = capturedCode();
    expect(next).not.toBe(first.code);
    expect(JSON.stringify(resent)).not.toContain(next);

    const pending = await db.ownerSetupRequest.findUniqueOrThrow({
      where: { id: first.requestId },
    });
    expect(pending.attempts).toBe(0);
    expect(+pending.expiresAt).toBeGreaterThan(+first.expiresAt);

    await expect(
      verifyInitialOwnerSetup({ requestId: first.requestId, code: first.code }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyInitialOwnerSetup({ requestId: first.requestId, code: next }),
    ).resolves.toBeTruthy();
  });
});

describe('availability and the marker', () => {
  it('commits completion when a submission arrives for an installation that already has an owner', async () => {
    const owner = await makeUser({ role: 'user, owner' });
    await expect(startInitialOwnerSetup(input())).rejects.toMatchObject({ status: 409 });
    expect(await db.installationSetup.count()).toBe(1);
    await db.user.delete({ where: { id: owner.id } });
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('completed');
  });

  it('does not reopen after the bootstrap owner is banned and then deleted', async () => {
    const { requestId, code } = await start();
    await verifyInitialOwnerSetup({ requestId, code });
    const owner = await db.user.findFirstOrThrow();
    await db.user.update({ where: { id: owner.id }, data: { banned: true } });
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('completed');
    await db.user.delete({ where: { id: owner.id } });
    await expect(startInitialOwnerSetup(input())).rejects.toMatchObject({ status: 409 });
    // Deleting the candidate's user cascades its pending request away.
    expect(await db.ownerSetupRequest.count()).toBe(0);
  });

  it('closes setup when historical bootstrap evidence survives a deleted owner', async () => {
    await db.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: 'bootstrap-cli',
        action: 'owner.bootstrap',
        targetId: 'deleted-owner',
        changes: {},
      },
    });
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('completed');
    expect(await db.installationSetup.count()).toBe(1);
  });

  it('closes and persists completion for a pre-existing inactive owner', async () => {
    const owner = await makeUser({ role: 'owner' });
    await db.user.update({ where: { id: owner.id }, data: { banned: true, emailVerified: false } });

    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('completed');
    const marker = await db.installationSetup.findUniqueOrThrow({ where: { id: SETUP_MARKER_ID } });
    expect(marker.method).toBe('existing-owner');
    expect(marker.completedBy).toBe(owner.id);

    await expect(startInitialOwnerSetup(input())).rejects.toMatchObject({ status: 409 });
  });

  it('ignores a role that merely contains the word owner', async () => {
    await makeUser({ role: 'co-owner' });
    await expect(ensureInitialOwnerSetupStatus()).resolves.toBe('available');
    expect(await db.installationSetup.count()).toBe(0);
  });

  it('keeps the marker a singleton that the CLI path can write idempotently', async () => {
    const owner = await makeUser({ role: 'owner' });
    await db.$transaction(async (tx) => recordSetupCompletion(tx, 'cli', owner.id));
    await db.$transaction(async (tx) => recordSetupCompletion(tx, 'cli', owner.id));
    expect(await db.installationSetup.count()).toBe(1);
    await expect(
      db.installationSetup.create({ data: { id: 'second', method: 'web' } }),
    ).rejects.toThrow();
  });
});
