import { redirect } from 'next/navigation';

import { ApiKeysPanel } from '@/components/admin/api-keys/api-keys-panel';
import { db } from '@/db';
import { isAllowed } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

export default async function ApiKeysPage() {
  const access = await requirePage('providers:read');
  if (!access.roles.includes('owner')) redirect('/access-denied');
  const session = await db.session.findFirst({
    where: { id: access.sessionId, userId: access.userId, impersonatedBy: null },
    select: { id: true },
  });
  if (!session) redirect('/access-denied');

  // Same owner-only rule the management API applies on every request.
  return (
    <ApiKeysPanel canManage={isAllowed(access.permissions, access.roles, 'providers:manage')} />
  );
}
