'use client';
import { DEFAULT_TABLE_SEARCH_DEBOUNCE_MS, getClampedTablePageIndex } from '@better-auth-ui/core';
import {
  type AdminAuthClient,
  type AdminListUsersParams,
  type AdminUser,
} from '@better-auth-ui/core/plugins/admin';
import { useAuth, useAuthPlugin } from '@better-auth-ui/react';
import { useAdminPermission, useAdminUsers } from '@better-auth-ui/react/plugins/admin';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { keepPreviousData } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';

import { createAdminColumnHelper, useAdminTable } from '@/components/admin/table/table';
import { usersRequestParams } from '@/components/admin/table/table-definitions';
import { useAdminTableState } from '@/components/admin/table/table-state';
import { adminPlugin } from '@/lib/auth/admin-plugin';
import type {
  AdminUsersProps,
  SearchField,
  SearchOperator,
  StatusFilter,
} from '@/types/admin-users';
const adminColumnHelper = createAdminColumnHelper<AdminUser>();
const adminColumns = adminColumnHelper.columns([
  adminColumnHelper.accessor('name', { id: 'name' }),
  adminColumnHelper.accessor('role', {
    id: 'role',
    enableSorting: false,
  }),
  adminColumnHelper.accessor('banned', {
    id: 'status',
    enableSorting: false,
  }),
  adminColumnHelper.accessor((user) => new Date(user.createdAt).getTime(), {
    id: 'createdAt',
  }),
]);
const EMPTY_USERS: AdminUser[] = [];
const INITIAL_ADMIN_SORTING: SortingState = [{ id: 'createdAt', desc: true }];

export function useAdminUsersList({
  currentUserId,
  canManageAccess,
  roles,
  onSelectedUserIdChange,
  selectedUserId: controlledSelectedUserId,
}: AdminUsersProps) {
  const auth = useAuth<AdminAuthClient>();
  const config = useAuthPlugin(adminPlugin);
  const { localization } = config;
  const [localSelectedUserId, setLocalSelectedUserId] = useState<string>();
  const tableState = useAdminTableState({
    initialSorting: INITIAL_ADMIN_SORTING,
    pageSize: config.pageSize,
  });
  const { columnFilters, globalFilter, pagination, setPagination, sorting } = tableState;
  const [searchField, setSearchField] = useState<SearchField>('email');
  const [searchOperator, setSearchOperator] = useState<SearchOperator>('contains');
  const [createOpen, setCreateOpen] = useState(false);
  const [debouncedSearch] = useDebouncedValue(globalFilter.trim(), {
    wait: DEFAULT_TABLE_SEARCH_DEBOUNCE_MS,
  });
  const status = String(
    columnFilters.find((filter) => filter.id === 'status')?.value ?? 'all',
  ) as StatusFilter;
  const primarySort = sorting[0];
  const sortBy = primarySort?.id === 'name' ? 'name' : 'createdAt';
  const sortDirection = primarySort?.desc ? 'desc' : 'asc';
  const isSelectionControlled = onSelectedUserIdChange !== undefined;
  const selectedUserId = isSelectionControlled ? controlledSelectedUserId : localSelectedUserId;

  const setSelectedUserId = (userId: string | undefined) => {
    if (!isSelectionControlled) setLocalSelectedUserId(userId);
    onSelectedUserIdChange?.(userId);
  };

  const params = useMemo<AdminListUsersParams>(
    () =>
      usersRequestParams({
        pageSize: pagination.pageSize,
        pageIndex: pagination.pageIndex,
        searchField,
        searchOperator,
        searchValue: debouncedSearch,
        sortBy,
        sortDirection,
        status,
      }),
    [
      debouncedSearch,
      pagination.pageIndex,
      pagination.pageSize,
      searchField,
      searchOperator,
      sortBy,
      sortDirection,
      status,
    ],
  );
  const permission = useAdminPermission(auth.authClient, { user: ['list'] });
  const users = useAdminUsers(auth.authClient, {
    enabled: permission.data?.success === true,
    params,
    placeholderData: keepPreviousData,
  });
  const canCreate = useAdminPermission(auth.authClient, { user: ['create'] });
  const canGet = useAdminPermission(auth.authClient, { user: ['get'] });
  const canSetRole = useAdminPermission(auth.authClient, { user: ['set-role'] });

  const total = users.data?.total ?? 0;

  useEffect(() => {
    if (!users.isSuccess) return;
    const pageIndex = getClampedTablePageIndex(pagination.pageIndex, pagination.pageSize, total);
    if (pageIndex !== pagination.pageIndex) {
      setPagination((current) => ({ ...current, pageIndex }));
    }
  }, [pagination.pageIndex, pagination.pageSize, setPagination, total, users.isSuccess]);
  const table = useAdminTable(
    {
      atoms: tableState.atoms,
      columns: adminColumns,
      data: users.data?.users ?? EMPTY_USERS,
      getRowId: (user) => user.id,
      manualFiltering: true,
      manualPagination: true,
      manualSorting: true,
      rowCount: total,
    },
    () => null,
  );
  const from = total ? pagination.pageIndex * pagination.pageSize + 1 : 0;
  const to = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize);

  return {
    localization,
    canCreate,
    setCreateOpen,
    createOpen,
    searchField,
    setSearchField,
    searchOperator,
    setSearchOperator,
    table,
    status,
    globalFilter,
    permission,
    users,
    canGet,
    selectedUserId,
    setSelectedUserId,
    canSetRole,
    currentUserId,
    canManageAccess,
    roles,
    pagination,
    total,
    from,
    to,
  };
}
