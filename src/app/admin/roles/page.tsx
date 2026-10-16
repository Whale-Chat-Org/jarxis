import { RolesManager } from '@/components/admin/roles-manager';
import { listPermissions, listRoles } from '@/lib/roles';
import { requirePage } from '@/lib/rbac';

export default async function RolesPage() {
  const grants = await requirePage('roles:read');
  const [roles, catalog] = await Promise.all([listRoles(), listPermissions()]);
  return (
    <RolesManager
      initialRoles={roles}
      catalog={catalog}
      canManage={grants.roles.includes('owner')}
    />
  );
}
