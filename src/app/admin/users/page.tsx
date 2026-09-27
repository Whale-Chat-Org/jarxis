import { AdminUsers } from '@/components/auth/admin/admin-users';
import { requirePage } from '@/lib/rbac';

/**
 * User administration is the Better Auth UI `AdminUsers` component.
 *
 * The page guard checks the application permission; the component additionally gates every control
 * on the signed-in role's `user:*` permissions, so a viewer sees a read-only table.
 */
export default async function UsersPage() {
  await requirePage('users:read');

  return <AdminUsers />;
}
