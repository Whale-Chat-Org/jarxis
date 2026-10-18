import { RolesPanel } from '@/components/admin/role/roles-panel';
import { requirePage } from '@/lib/rbac';
import { listPermissions, listRoles } from '@/lib/roles';

export default async function RolesPage() {
  const grants = await requirePage('roles:read');
  const [roles, catalog] = await Promise.all([listRoles(), listPermissions()]);
  return (
    <RolesPanel initialRoles={roles} catalog={catalog} canManage={grants.roles.includes('owner')} />
  );
}
