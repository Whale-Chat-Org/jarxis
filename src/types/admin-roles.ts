import type { useRolesManagement } from '@/components/admin/role/use-roles-management';
import type { RoleView } from '@/lib/admin-contracts';
export type CatalogEntry = { key: string; description: string; restricted: boolean };
export type Draft = {
  key?: string;
  system: boolean;
  readOnly: boolean;
  name: string;
  description: string;
  permissions: string[];
};

export type RolesManagerProps = {
  initialRoles: RoleView[];
  catalog: CatalogEntry[];
  canManage: boolean;
};
export type RolesManagementState = ReturnType<typeof useRolesManagement>;
