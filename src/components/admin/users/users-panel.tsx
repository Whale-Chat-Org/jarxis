'use client';
import { UserPlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdminUsersProps } from '@/types/admin-users';
import { CreateUserDialog } from '@/components/admin/users/action-panel/create/create-user-dialog';
import { UserInspector } from '@/components/admin/users/action-panel/shared/user-inspector';
import { AdminUsersFilters } from '@/components/admin/users/table/admin-users-filters';
import { AdminUsersPagination } from '@/components/admin/users/table/admin-users-pagination';
import { AdminUsersTable } from '@/components/admin/users/table/admin-users-table';
import { useAdminUsersList } from '@/components/admin/users/table/use-admin-users-list';
export type { AdminUsersProps } from '@/types/admin-users';

/** Composes the directory and panels; the list hook owns interactive state. */
export function UsersPanel(props: AdminUsersProps) {
  const state = useAdminUsersList(props);
  const {
    canCreate,
    localization,
    setCreateOpen,
    createOpen,
    selectedUserId,
    canGet,
    setSelectedUserId,
  } = state;
  return (
    <section className={props.className}>
      <div className="flex flex-col gap-lg">
        <div className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
          {canCreate.isPending ? (
            <Skeleton className="h-control-sm w-bar-lg" />
          ) : canCreate.data?.success ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlusIcon />
              {localization.createUser}
            </Button>
          ) : null}
        </div>
        <AdminUsersFilters state={state} />
        <AdminUsersTable state={state} />
        <AdminUsersPagination state={state} />
      </div>
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} roles={props.roles} />
      <UserInspector
        roles={props.roles}
        canGetUser={canGet.data?.success === true}
        open={Boolean(selectedUserId) && canGet.data?.success === true}
        onOpenChange={(open) => !open && setSelectedUserId(undefined)}
        userId={selectedUserId}
      />
    </section>
  );
}
