import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from '../src/db';
import type { RoleName } from '../src/lib/permissions';
// Development-only fixtures. Refuses production and non-local databases.
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'postgres']);
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed users in production');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const host = new URL(url).hostname;
if (!localHosts.has(host)) throw new Error('Refusing to seed users into a non-local database');
// Deliberately fixed and development-only. The host/production guards above prevent remote use.
const password = 'Jarxis-Local!58392';
const fixtures = [
  { email: 'owner@jarxis.test', name: 'Olivia Owner', role: 'owner' },
  { email: 'admin@jarxis.test', name: 'Adam Administrator', role: 'administrator' },
  { email: 'viewer@jarxis.test', name: 'Vera Viewer', role: 'viewer' },
  { email: 'member@jarxis.test', name: 'Max Member', role: 'user' },
  { email: 'banned@jarxis.test', name: 'Dana Banned', role: 'viewer', banned: true },
  { email: 'unverified@jarxis.test', name: 'Uma Unverified', role: 'user', emailVerified: false },
] as const satisfies readonly {
  email: string;
  name: string;
  /** Code-declared role name; `role` on app_user is authoritative. */
  role: RoleName;
  banned?: boolean;
  emailVerified?: boolean;
}[];
try {
  const hash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72419831)::text`;
    for (const f of fixtures) {
      const state = {
        name: f.name,
        emailVerified: 'emailVerified' in f ? f.emailVerified : true,
        banned: 'banned' in f ? f.banned : false,
        role: f.role,
      };
      const user = await tx.user.upsert({
        where: { email: f.email },
        create: { id: randomUUID(), email: f.email, ...state },
        update: { ...state, updatedAt: new Date() },
      });
      const account = await tx.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
      });
      if (account)
        await tx.account.update({
          where: { id: account.id },
          data: { password: hash, updatedAt: new Date() },
        });
      else
        await tx.account.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
            password: hash,
          },
        });
      // Password changes revoke existing sessions and API token families.
      await tx.tokenFamily.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: 'seed-users-cli',
          action: 'user.seed',
          targetId: user.id,
          changes: { role: f.role, banned: state.banned },
        },
      });
    }
  });
  for (const f of fixtures)
    console.log(`${f.email.padEnd(24)} ${f.role}${'banned' in f && f.banned ? ' (banned)' : ''}`);
  console.log('Development users seeded with the password declared in scripts/seed-users.ts');
} finally {
  await db.$disconnect();
}
