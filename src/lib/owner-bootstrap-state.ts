import type { Transaction } from '@/db';

export const SETUP_MARKER_ID = 'singleton';
export const SETUP_ADVISORY_LOCK = 72419831;
export type SetupMethod = 'web' | 'cli' | 'existing-owner' | 'migration-backfill';

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
