'use client';
import { ShieldAlertIcon } from 'lucide-react';

import { AdminDataTable } from '@/components/admin/table/data-table';
import { SortButton } from '@/components/admin/table/sort-button';
import { AdminState } from '@/components/admin/admin-state';
import { adminTableDefinitions } from '@/components/admin/table/table-definitions';
import { UserRoleCell } from '@/components/admin/users/table/user-role-cell';
import { UserAvatar } from '@/components/auth/user/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/admin-user-utils';
import type { UsersTableState } from '@/types/admin-users';

import { UserRowsSkeleton } from './user-rows-skeleton';
import { UserTableSkeleton } from './user-table-skeleton';
export function AdminUsersTable({ state }: { state: UsersTableState }) {
  const {
    permission,
    users,
    localization,
    table,
    selectedUserId,
    canGet,
    setSelectedUserId,
    currentUserId,
    canManageAccess,
    canSetRole,
    roles,
  } = state;
  return (
    <>
      {permission.isPending ? (
        <UserTableSkeleton />
      ) : !permission.data?.success ? (
        <AdminState
          icon={<ShieldAlertIcon />}
          title={localization.accessDenied}
          description={localization.accessDeniedDescription}
        />
      ) : users.isError ? (
        <AdminState
          icon={<ShieldAlertIcon />}
          title={localization.loadUsersError}
          description={localization.loadUsersErrorDescription}
          action={
            <Button variant="outline" onClick={() => users.refetch()}>
              {localization.retry}
            </Button>
          }
        />
      ) : (
        <AdminDataTable
          definition={adminTableDefinitions.users}
          rows={table.getRowModel().rows.map((row) => row.original)}
          headers={{
            name: (
              <SortButton
                onClick={table.getColumn('name')?.getToggleSortingHandler()}
                sorted={table.getColumn('name')?.getIsSorted() ?? false}
              >
                {localization.name}
              </SortButton>
            ),
            role: localization.role,
            status: localization.status,
            createdAt: (
              <SortButton
                onClick={table.getColumn('createdAt')?.getToggleSortingHandler()}
                sorted={table.getColumn('createdAt')?.getIsSorted() ?? false}
              >
                {localization.created}
              </SortButton>
            ),
          }}
          rowProps={(user) => ({
            'aria-selected': selectedUserId === user.id,
            className: canGet.data?.success ? 'cursor-pointer' : undefined,
            onClick: canGet.data?.success ? () => setSelectedUserId(user.id) : undefined,
          })}
          body={users.isPending ? <UserRowsSkeleton /> : undefined}
          empty={
            <>
              <strong className="block font-medium">{localization.noUsers}</strong>
              <span>{localization.noUsersDescription}</span>
            </>
          }
          cells={{
            name: (user) => (
              <>
                <div className="flex items-center gap-md">
                  <UserAvatar className="size-2xl" user={user} />
                  <div className="min-w-none">
                    {canGet.data?.success ? (
                      <Button
                        className="h-auto min-w-none justify-start p-none font-medium"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedUserId(user.id);
                        }}
                        variant="link"
                      >
                        <span className="truncate">{user.name}</span>
                      </Button>
                    ) : (
                      <span className="truncate">{user.name}</span>
                    )}
                    <div className="truncate text-caption text-muted-foreground">{user.email}</div>
                  </div>
                </div>
              </>
            ),
            role: (user) => (
              <>
                <UserRoleCell
                  user={user}
                  currentUserId={currentUserId}
                  canManageAccess={canManageAccess && canSetRole.data?.success === true}
                  roles={roles}
                />
              </>
            ),
            status: (user) => (
              <>
                <Badge variant={user.banned ? 'destructive' : 'secondary'}>
                  {user.banned ? localization.banned : localization.active}
                </Badge>
              </>
            ),
            createdAt: (user) => <>{formatDate(user.createdAt)}</>,
          }}
        />
      )}
    </>
  );
}
