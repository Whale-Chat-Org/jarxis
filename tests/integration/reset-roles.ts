import { db } from '@/db';
import { seedRbac } from '@/lib/rbac-seed';

/**
 * Empties users and audit events, removes custom roles and restores the seeded permissions and
 * system roles (including Viewer and Administrator grants) to their code defaults.
 */
export async function resetRoles() {
  await db.$executeRaw`TRUNCATE app_user, audit_logs CASCADE`;
  await db.role.deleteMany({ where: { system: false } });
  await seedRbac(db, { reset: true });
}
