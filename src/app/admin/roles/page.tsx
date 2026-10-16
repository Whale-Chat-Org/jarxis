import { RolesManager } from '@/components/admin/roles-manager';
import { listRoles } from '@/lib/custom-roles';
import { adminPermissionCatalog, ownerOnly, permissionCatalog } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

export default async function RolesPage() {
  const grants = await requirePage('roles:read');
  const roles = await listRoles();
  const restricted = new Set<string>([
    ...ownerOnly,
    'user:delete',
    'user:set-role',
    'user:impersonate-admins',
  ]);
  const catalog = [
    ...Object.entries(permissionCatalog),
    ...Object.entries(adminPermissionCatalog),
  ].map(([key, description]) => ({ key, description, restricted: restricted.has(key) }));
  return (
    <RolesManager
      initialRoles={roles}
      catalog={catalog}
      canManage={grants.roles.includes('owner')}
    />
  );
}
