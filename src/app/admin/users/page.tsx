import { redirect } from 'next/navigation';

import { UsersPanel } from '@/components/admin/users/users-panel';
import { isAllowed } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';
import { listRoles } from '@/lib/roles';

/**
 * Users.
 *
 * The page guard requires both `users:read` and `user:list`; the Better Auth UI `UsersPanel` table checks its own
 * `user:*` controls. `canManageAccess` reflects the owner + `roles:assign` rule, and the table
 * checks `user:set-role` before showing the role picker.
 */
export default async function UsersPage() {
  const grants = await requirePage('users:read');
  if (!grants.permissions.has('user:list')) redirect('/access-denied');
  const canManageAccess = isAllowed(grants.permissions, grants.roles, 'roles:assign');
  const roles = await listRoles();

  return (
    <UsersPanel currentUserId={grants.userId} canManageAccess={canManageAccess} roles={roles} />
  );
}
