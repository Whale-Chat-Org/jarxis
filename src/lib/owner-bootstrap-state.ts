import type { Transaction } from '@/db';
import { hasOwnerRole } from './role-keys';
import { isActiveUser } from './user-status';

export const SETUP_MARKER_ID = 'singleton';
export const SETUP_ADVISORY_LOCK = 72419831;
export type SetupMethod = 'web' | 'cli' | 'existing-owner' | 'migration-backfill';

export async function activeOwnerIds(connection: Pick<Transaction, 'user'>) {
  const candidates = await connection.user.findMany({
    where: { emailVerified: true, role: { contains: 'owner' } },
    select: { id: true, role: true, banned: true, banExpires: true, emailVerified: true },
  });
  return candidates
    .filter((user) => hasOwnerRole(user.role) && isActiveUser(user))
    .map((user) => user.id);
}

/** Shared with the CLI; completion permanently closes website setup. */
export async function recordSetupCompletion(
  tx: Transaction,
  method: SetupMethod,
  completedBy: string | null = null,
) {
  await tx.installationSetup.upsert({
    where: { id: SETUP_MARKER_ID },
    create: { id: SETUP_MARKER_ID, method, completedBy },
    update: {},
  });
}
