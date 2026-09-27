import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db';
import { isActiveUser } from '../src/lib/user-status';

/**
 * Bootstrap the first owner.
 *
 * Roles are code-declared (`src/lib/permissions.ts`), so this writes the `role` column directly
 * instead of a `user_roles` row. The advisory lock and the last-owner check are unchanged.
 */
const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error('Usage: pnpm owner verified-user@example.com');
try {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72419831)::text`;
    const existing = await tx.user.findMany({
      where: { emailVerified: true, role: { contains: 'owner' } },
      select: { id: true, role: true, banned: true, banExpires: true, emailVerified: true },
    });
    const activeOwners = existing.filter(
      (user) => (user.role ?? '').split(',').includes('owner') && isActiveUser(user),
    );
    if (activeOwners.length)
      throw new Error(
        'An active owner already exists. Use the administration UI to assign additional owners.',
      );
    await tx.$queryRaw`SELECT id FROM app_user WHERE email = ${email} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { email } });
    if (!u || !isActiveUser(u)) throw new Error('Register and verify an active account first.');
    const assigned = (u.role ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
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
  });
  console.log('First owner assigned');
} finally {
  await db.$disconnect();
}
