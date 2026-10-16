import { AdminUsers } from '@/components/auth/admin/admin-users';
import type { RoleView } from './roles-manager';

export type UsersWorkspaceProps = {
  /** The signed-in operator; passed through so their own row offers no role change. */
  currentUserId: string;
  /** Owner + `roles:assign`, decided on the server. The table also checks `user:set-role`. */
  canManageAccess: boolean;
  roles: RoleView[];
};

/** The Accounts table is the sole Users page content. */
export function UsersWorkspace({ currentUserId, canManageAccess, roles }: UsersWorkspaceProps) {
  return (
    <AdminUsers currentUserId={currentUserId} canManageAccess={canManageAccess} roles={roles} />
  );
}
