import { UsersWorkspace } from '@/components/admin/users-workspace';
import { listRoles } from '@/lib/custom-roles';
import { isAllowed } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

/**
 * Users & access.
 *
 * The page guard checks `users:read`; the Better Auth UI `AdminUsers` table checks its own
 * `user:*` controls. `canManageAccess` reflects the owner + `roles:assign` rule, and the table
 * checks `user:set-role` before showing the role picker.
 */
export default async function UsersPage() {
  const grants = await requirePage('users:read');
  const canManageAccess = isAllowed(grants.permissions, grants.roles, 'roles:assign');
  const roles = await listRoles();

  return (
    <UsersWorkspace currentUserId={grants.userId} canManageAccess={canManageAccess} roles={roles} />
  );
}
