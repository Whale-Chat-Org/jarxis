import { db, Prisma, type Transaction } from '@/db';
import { hashPassword } from 'better-auth/crypto';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import 'server-only';
import { createCredentialAccount } from './credential-account';
import { env } from './env';
import { HttpError } from './errors';
import { sendMail } from './mailer';
import {
  SETUP_ADVISORY_LOCK,
  SETUP_MARKER_ID,
  recordSetupCompletion as writeMarker,
} from './owner-bootstrap-state';
import { hasOwnerRole } from './role-keys';
import type { SetupInput } from './setup-validation';
import { isBanActive } from './user-status';
export {
  recordSetupCompletion,
  SETUP_ADVISORY_LOCK,
  SETUP_MARKER_ID,
} from './owner-bootstrap-state';

/**
 * First-owner setup by emailed verification code.
 *
 * `POST /api/setup` is a public, one-shot path on a fresh installation: anyone may submit a name,
 * email and password, but the account only becomes the owner once a six-digit code sent to that
 * mailbox is presented back. Control of the mailbox is the proof, so no shared setup secret is
 * involved and none is read from the environment.
 *
 * Guarantees:
 *
 * 1. The code is never stored. Only an HMAC-SHA256 digest keyed by `BETTER_AUTH_SECRET` is
 *    persisted, bound to a purpose string and to the opaque request id, so a digest is useless
 *    outside its own request and cannot be replayed against another flow.
 * 2. A permanent singleton `installation_setup` row records that setup is closed. It is written
 *    in the same transaction that promotes the owner, is never deleted, and refuses later runs.
 * 3. Any pre-existing owner — active or not, verified or not — closes the flow. The marker is
 *    persisted when such an owner is seen, even if the surrounding operation is then rejected:
 *    the transaction commits the marker and the rejection is thrown afterwards.
 * 4. Every start, verify and resend serializes on the shared advisory lock, so concurrent
 *    verifications of the same code produce exactly one winner.
 *
 * The flow never promotes an existing account: a taken email is a conflict, not an upgrade, and a
 * banned account is never made owner.
 *
 * `pnpm owner` is deliberately *not* gated on the marker: it is the documented recovery path for
 * an installation whose owners were lost, and it already requires shell access to the deployment.
 */

export type InitialOwnerSetupStatus = 'completed' | 'available';

/** Codes live for ten minutes; a resend issues a new code and a new window. */
const CODE_TTL_MS = 10 * 60 * 1000;
/** Five wrong codes burn the request; attempts are committed even when the call is rejected. */
const MAX_ATTEMPTS = 5;
/** One email per minute per request. */
const RESEND_COOLDOWN_MS = 60 * 1000;

export type StartedSetup = {
  requestId: string;
  email: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  /** `false` when the account exists but the email could not be delivered; retry via resend. */
  deliverySent: boolean;
};

/** Six digits from a cryptographic source, zero-padded so every code is the same length. */
function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Purpose- and request-scoped HMAC of the code.
 *
 * The purpose label and request id are inside the MAC input, so a digest only ever matches the
 * code of the request it was issued for, and cannot collide with any other use of the secret.
 */
function codeDigest(requestId: string, code: string, email: string) {
  return createHmac('sha256', env().BETTER_AUTH_SECRET)
    .update(JSON.stringify(['owner-setup:v1', requestId, email, code]), 'utf8')
    .digest('hex');
}

function codeMatches(requestId: string, code: string, expected: string, email: string) {
  const actual = Buffer.from(codeDigest(requestId, code, email), 'utf8');
  const stored = Buffer.from(expected, 'utf8');
  if (actual.length !== stored.length) return false;
  return timingSafeEqual(actual, stored);
}

async function lock(tx: Transaction) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK})::text`;
}

async function findExistingOwner(tx: Transaction) {
  const candidates = await tx.user.findMany({
    where: { role: { contains: 'owner' } },
    select: { id: true, role: true },
  });
  const owner = candidates.find((user) => hasOwnerRole(user.role));
  if (owner) return owner;
  // Older installations may have lost every owner before this feature was installed.
  const bootstrap = await tx.auditLog.findFirst({
    where: { action: 'owner.bootstrap' },
    select: { targetId: true },
    orderBy: { createdAt: 'asc' },
  });
  return bootstrap ? { id: bootstrap.targetId } : null;
}

/**
 * Whether setup is still open, writing the marker if the installation already has an owner.
 *
 * Returns `true` when the caller may continue. A `false` result means the marker is now present,
 * so the caller must reject *after* the transaction commits to keep that marker.
 */
async function setupStillOpen(tx: Transaction) {
  const marker = await tx.installationSetup.findUnique({ where: { id: SETUP_MARKER_ID } });
  if (marker) return false;
  const owner = await findExistingOwner(tx);
  if (!owner) return true;
  // Persist the marker so this installation never offers the flow again.
  await writeMarker(tx, 'existing-owner', owner.id);
  return false;
}

function closed(): never {
  throw new HttpError(409, 'SETUP_COMPLETED', 'First-owner setup has already been completed');
}

function missing(): never {
  throw new HttpError(404, 'SETUP_REQUEST_NOT_FOUND', 'No pending setup request');
}

/**
 * Whether the web setup flow may run.
 *
 * Lock-serialized so two concurrent probes agree, and self-healing: an installation that already
 * has an owner but no marker (for example one bootstrapped by the CLI before this feature, or
 * seeded directly) gets the marker written here so the flow stays closed.
 */
export async function ensureInitialOwnerSetupStatus(): Promise<InitialOwnerSetupStatus> {
  return db.$transaction(async (tx) => {
    await lock(tx);
    return (await setupStillOpen(tx)) ? 'available' : 'completed';
  });
}

async function deliverCode(email: string, code: string) {
  try {
    await sendMail({
      to: email,
      subject: 'Verify your Jarxis Owner email',
      text: [
        'Someone is setting up the owner account for this Jarxis installation.',
        '',
        `Verification code: ${code}`,
        '',
        'Enter this code to finish setup. It expires in 10 minutes.',
        'If this was not you, ignore this email and no account will be activated.',
      ].join('\n'),
    });
    return true;
  } catch {
    // The mailer already sanitized and logged the failure. The candidate account and its pending
    // request stay in place, uncommitted to owner, so the caller can retry with a resend.
    return false;
  }
}

/**
 * Start setup: create the unverified candidate owner and email a code.
 *
 * One transaction under the advisory lock performs every check and every write: the marker gate,
 * the existing-owner gate, the unverified `user` row, its `credential` account row (the same
 * shape Better Auth's sign-up writes, so the password signs in normally once verified) and the
 * pending request holding the code digest. No role, audit row or marker is written here — nothing
 * about this call grants privilege until the code is verified.
 */
export async function startInitialOwnerSetup(input: SetupInput): Promise<StartedSetup> {
  // Hashing happens before the transaction so slow key derivation does not hold the lock.
  const password = await hashPassword(input.password);
  const code = generateCode();
  try {
    const result = await db.$transaction(async (tx) => {
      await lock(tx);
      // A `false` result may have just written the marker; reject once this commits.
      if (!(await setupStillOpen(tx))) return null;

      // Never promote an existing account: setup only ever creates its own candidate.
      const taken = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (taken)
        throw new HttpError(409, 'EMAIL_CONFLICT', 'That email address is already registered');

      const now = new Date();
      const requestId = randomUUID();
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          // Unverified until the emailed code comes back; the owner guards require a verified,
          // unbanned owner, so this account can do nothing in the meantime.
          emailVerified: false,
          role: 'user',
        },
        select: { id: true, email: true },
      });
      await createCredentialAccount(tx, user.id, password);
      const request = await tx.ownerSetupRequest.create({
        data: {
          id: requestId,
          userId: user.id,
          codeHash: codeDigest(requestId, code, user.email),
          expiresAt: new Date(now.getTime() + CODE_TTL_MS),
          lastSentAt: now,
        },
        select: { id: true, expiresAt: true, lastSentAt: true },
      });
      return { request, email: user.email };
    });
    if (!result) closed();
    return {
      requestId: result.request.id,
      email: result.email,
      expiresAt: result.request.expiresAt,
      resendAvailableAt: new Date(
        (result.request.lastSentAt ?? new Date()).getTime() + RESEND_COOLDOWN_MS,
      ),
      deliverySent: await deliverCode(result.email, code),
    };
  } catch (error) {
    throw asSanitizedConflict(error);
  }
}

/**
 * Resend the code: issue a fresh code, reset the attempt counter and invalidate the previous one.
 *
 * Also the recovery path when the first email failed to send: the account already exists, so the
 * caller just asks for another code once the cooldown has passed.
 */
export async function resendInitialOwnerSetup({
  requestId,
}: {
  requestId: string;
}): Promise<StartedSetup> {
  let code = generateCode();
  const result = await db.$transaction(async (tx) => {
    await lock(tx);
    if (!(await setupStillOpen(tx))) return { outcome: 'closed' as const };

    const request = await tx.ownerSetupRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        codeHash: true,
        consumedAt: true,
        lastSentAt: true,
        user: { select: { email: true } },
      },
    });
    // A consumed request is indistinguishable from an unknown one to the caller.
    if (!request || request.consumedAt) return { outcome: 'missing' as const };
    const now = new Date();
    const availableAt = new Date((request.lastSentAt?.getTime() ?? 0) + RESEND_COOLDOWN_MS);
    if (availableAt > now) return { outcome: 'cooldown' as const };

    // A resend invalidates the previous code even if the random generator repeats it.
    while (codeDigest(request.id, code, request.user.email) === request.codeHash)
      code = generateCode();

    const updated = await tx.ownerSetupRequest.update({
      where: { id: request.id },
      // The new digest replaces the old one, so the previous code stops working immediately.
      data: {
        codeHash: codeDigest(request.id, code, request.user.email),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
        attempts: 0,
        lastSentAt: now,
      },
      select: { id: true, expiresAt: true, lastSentAt: true },
    });
    return { outcome: 'sent' as const, request: updated, email: request.user.email };
  });

  if (result.outcome === 'closed') closed();
  if (result.outcome === 'missing') missing();
  if (result.outcome === 'cooldown')
    throw new HttpError(429, 'RESEND_COOLDOWN', 'Please wait before requesting another code');
  return {
    requestId: result.request.id,
    email: result.email,
    expiresAt: result.request.expiresAt,
    resendAvailableAt: new Date(
      (result.request.lastSentAt ?? new Date()).getTime() + RESEND_COOLDOWN_MS,
    ),
    deliverySent: await deliverCode(result.email, code),
  };
}

/**
 * Verify the emailed code and promote the candidate to owner.
 *
 * The comparison, the attempt accounting and every promotion write happen in one lock-serialized
 * transaction, so concurrent submissions of the same code yield exactly one winner. Wrong
 * attempts are committed before the rejection is thrown, so a guesser cannot roll back the
 * counter by abandoning the request.
 */
export async function verifyInitialOwnerSetup({
  requestId,
  code,
}: {
  requestId: string;
  code: string;
}) {
  const result = await db.$transaction(async (tx) => {
    await lock(tx);
    if (!(await setupStillOpen(tx))) return { outcome: 'closed' as const };

    const request = await tx.ownerSetupRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        codeHash: true,
        expiresAt: true,
        attempts: true,
        consumedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            banned: true,
            banExpires: true,
          },
        },
      },
    });
    if (!request || request.consumedAt) return { outcome: 'missing' as const };

    const now = new Date();
    if (request.expiresAt <= now) return { outcome: 'expired' as const };
    if (request.attempts >= MAX_ATTEMPTS) return { outcome: 'exhausted' as const };

    if (!codeMatches(request.id, code, request.codeHash, request.user.email)) {
      const { attempts } = await tx.ownerSetupRequest.update({
        where: { id: request.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      // Committed, then rejected outside the transaction.
      return attempts >= MAX_ATTEMPTS
        ? { outcome: 'exhausted' as const }
        : { outcome: 'invalid' as const };
    }

    // A banned account is never granted the owner role.
    if (isBanActive(request.user, now)) return { outcome: 'missing' as const };

    const user = await tx.user.update({
      where: { id: request.user.id },
      data: { emailVerified: true, role: 'owner' },
      select: { id: true, name: true, email: true },
    });
    await tx.ownerSetupRequest.update({
      where: { id: request.id },
      data: { consumedAt: now },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: 'initial-setup',
        action: 'owner.bootstrap',
        targetId: user.id,
        // Whitelisted fields only: never the code, its digest, the password or its hash.
        changes: { role: 'owner', method: 'web', emailVerified: true },
      },
    });
    await writeMarker(tx, 'web', user.id);
    return { outcome: 'verified' as const, user };
  });

  switch (result.outcome) {
    case 'verified':
      return result.user;
    case 'closed':
      return closed();
    case 'missing':
      return missing();
    case 'expired':
      throw new HttpError(400, 'CODE_EXPIRED', 'That code has expired. Request a new one.');
    case 'exhausted':
      throw new HttpError(429, 'CODE_ATTEMPTS_EXHAUSTED', 'Too many incorrect codes');
    default:
      throw new HttpError(400, 'CODE_INVALID', 'That code is not valid');
  }
}

/**
 * A unique-constraint race is reported as a sanitized conflict, never as a raw provider error
 * carrying table, column or parameter details.
 */
function asSanitizedConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = JSON.stringify(error.meta?.target ?? '');
    if (target.includes('installation_setup'))
      return new HttpError(409, 'SETUP_COMPLETED', 'First-owner setup has already been completed');
    return new HttpError(409, 'EMAIL_CONFLICT', 'That email address is already registered');
  }
  return error;
}
