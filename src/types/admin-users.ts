import type { useCreateUser } from '@/components/admin/users/action-panel/create/use-create-user';
import type { useUserInspectorData } from '@/components/admin/users/action-panel/shared/use-user-inspector-data';
import type { useUserInspector } from '@/components/admin/users/action-panel/shared/user-inspector-state';
import type { useAdminUsersList } from '@/components/admin/users/table/use-admin-users-list';
import type { RoleView } from '@/lib/admin-contracts';
type UsersListState = ReturnType<typeof useAdminUsersList>;
export type UsersFiltersState = Pick<
  UsersListState,
  | 'localization'
  | 'searchField'
  | 'setSearchField'
  | 'searchOperator'
  | 'setSearchOperator'
  | 'table'
  | 'status'
  | 'globalFilter'
>;
export type UsersTableState = Pick<
  UsersListState,
  | 'permission'
  | 'users'
  | 'localization'
  | 'table'
  | 'selectedUserId'
  | 'canGet'
  | 'setSelectedUserId'
  | 'currentUserId'
  | 'canManageAccess'
  | 'canSetRole'
  | 'roles'
>;
export type UsersPaginationState = Pick<
  UsersListState,
  'pagination' | 'total' | 'users' | 'localization' | 'table' | 'from' | 'to'
>;

export type CreateUserProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleView[];
};
export type CreateUserState = ReturnType<typeof useCreateUser>;

export type DangerousAction = 'ban' | 'delete' | 'impersonate' | 'revokeAll';
export type UserInspectorProps = {
  canGetUser: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  roles: RoleView[];
};
export type UserInspectorData = ReturnType<typeof useUserInspectorData>;
export type UserInspectorState = ReturnType<typeof useUserInspector>;
export type InspectorHeaderState = UserInspectorState['header'];
export type InspectorProfileFieldsState = UserInspectorState['profile']['fields'];
export type InspectorAccountState = UserInspectorState['profile']['account'];
export type InspectorSecurityState = UserInspectorState['profile']['security'];
export type InspectorFooterState = UserInspectorState['profile']['footer'];
export type InspectorSessionsState = UserInspectorState['sessions'];
export type InspectorDangerState = UserInspectorState['danger'];

export type AdminUsersProps = {
  className?: string;
  currentUserId: string;
  canManageAccess: boolean;
  roles: RoleView[];
  onSelectedUserIdChange?: (userId: string | undefined) => void;
  selectedUserId?: string;
};

export type SearchField = 'email' | 'name';
export type SearchOperator = 'contains' | 'ends_with' | 'starts_with';
export type StatusFilter = 'all' | 'active' | 'banned';
