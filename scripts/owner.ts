import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db';
import {
  activeOwnerIds,
  recordSetupCompletion,
  SETUP_ADVISORY_LOCK,
} from '../src/lib/owner-bootstrap-state';
import { parseRoleKeys } from '../src/lib/role-keys';
import { isActiveUser } from '../src/lib/user-status';

/**
 * Bootstrap the first owner.
 *
 * Roles are code-declared (`src/lib/permissions.ts`), so this writes the `role` column directly
 * instead of a `user_roles` row. The advisory lock and the active-owner check are unchanged.
 *
 * This remains the recovery path for an installation that lost its owners, so it deliberately
 * does *not* refuse to run when the `installation_setup` marker exists — that marker only closes
 * the unauthenticated web flow. A successful bootstrap writes the marker, because an installation
 * with an owner must never offer the web flow again.
 */
const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error('Usage: pnpm owner verified-user@example.com');
try {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK})::text`;
    const activeOwners = await activeOwnerIds(tx);
    if (activeOwners.length)
      throw new Error(
        'An active owner already exists. Use the administration UI to assign additional owners.',
      );
    await tx.$queryRaw`SELECT id FROM app_user WHERE email = ${email} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { email } });
    if (!u || !isActiveUser(u)) throw new Error('Register and verify an active account first.');
    const assigned = parseRoleKeys(u.role);
    if (!assigned.includes('owner')) assigned.push('owner');
    await tx.user.update({
      where: { id: u.id },
      data: { role: assigned.join(','), updatedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: 'bootstrap-cli',
        action: 'owner.bootstrap',
        targetId: u.id,
        changes: { role: assigned.join(',') },
      },
    });
    // Permanently closes the unauthenticated web setup flow, in the same transaction.
    await recordSetupCompletion(tx, 'cli', u.id);
  });
  console.log('First owner assigned');
} finally {
  await db.$disconnect();
}
