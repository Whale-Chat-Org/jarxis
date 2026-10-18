import { SetupCompleted } from '@/components/setup/setup-completed';
import type { Metadata } from 'next';
import { connection } from 'next/server';

import { OwnerSetup } from '@/components/setup/owner-setup';
// Resolves 'available' | 'completed' from the persistent installation marker and any existing
// owner. There is no configuration switch: the route is public until an owner exists.
import { ensureInitialOwnerSetupStatus } from '@/lib/initial-owner-setup';

export const metadata: Metadata = {
  title: 'First owner setup',
  robots: { index: false, follow: false },
};

/**
 * `/setup` — the public first-run owner bootstrap.
 *
 * Availability is decided per request on the server. `connection()` keeps the page out of the
 * prerendered shell, because the status depends on live database state and must never be cached
 * into a static response: a stale "available" shell would advertise a closed route, and a stale
 * "completed" shell would hide a legitimate first run.
 *
 * Anyone may open the form, but Owner access is granted only after the six-digit code emailed
 * to the submitted address is verified.
 */
export default async function SetupPage() {
  await connection();
  const status = await ensureInitialOwnerSetupStatus();

  if (status !== 'completed') return <OwnerSetup />;

  return <SetupCompleted />;
}
