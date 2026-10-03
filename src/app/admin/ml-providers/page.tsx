import { redirect } from 'next/navigation';

import { MlProvidersPanel } from '@/components/admin/ml-providers-panel';
import { db } from '@/db';
import { isAllowed } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

export default async function MlProvidersPage() {
  const access = await requirePage('providers:read');
  if (!access.roles.includes('owner')) redirect('/access-denied');
  const session = await db.session.findFirst({
    where: { id: access.sessionId, userId: access.userId, impersonatedBy: null },
    select: { id: true },
  });
  if (!session) redirect('/access-denied');

  // Same owner-only rule the management API applies on every request.
  return (
    <MlProvidersPanel canManage={isAllowed(access.permissions, access.roles, 'providers:manage')} />
  );
}
