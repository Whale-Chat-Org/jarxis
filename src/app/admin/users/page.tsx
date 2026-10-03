import { UsersWorkspace } from '@/components/admin/users-workspace';
import { isAllowed } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

/**
 * Users & access.
 *
 * The page guard checks `users:read`; the "Accounts" tab is the Better Auth UI `AdminUsers`, which
 * additionally gates every control on the signed-in role's `user:*` permissions. `canManageAccess`
 * reflects the owner + `roles:assign` rule the admin plugin enforces on the server, so the Access
 * tab offers "Change role" only when the change can succeed.
 */
export default async function UsersPage() {
  const grants = await requirePage('users:read');
  const canManageAccess = isAllowed(grants.permissions, grants.roles, 'roles:assign');

  return <UsersWorkspace currentUserId={grants.userId} canManageAccess={canManageAccess} />;
}
