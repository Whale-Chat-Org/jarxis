import type { ReactNode } from 'react';
import { z } from 'zod';

export type AdminTableDefinition<Row> = {
  id: string;
  presentation: 'table' | 'cards' | 'summary';
  stateOwner: 'local' | 'url' | 'none';
  getRowId: (row: Row) => string;
  columns: readonly { id: string; label: string; className?: string }[];
  defaults: { pageSize?: number; sortBy?: string; sortDirection?: 'asc' | 'desc' };
  controls: readonly string[];
  actions: readonly string[];
  empty: ReactNode;
  mapQuery?: typeof usersRequestParams;
};

const id = (row: { id: string }) => row.id;
const key = (row: { key: string }) => row.key;
export const adminTableDefinitions = {
  users: {
    mapQuery: usersRequestParams,
    id: 'users',
    presentation: 'table',
    stateOwner: 'local',
    getRowId: id,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'role', label: 'Role' },
      { id: 'status', label: 'Status' },
      { id: 'createdAt', label: 'Created', className: 'hidden lg:table-cell' },
    ],
    defaults: { sortBy: 'createdAt', sortDirection: 'desc' },
    controls: [
      'pageIndex',
      'pageSize',
      'searchValue',
      'searchField',
      'searchOperator',
      'status',
      'sortBy',
      'sortDirection',
    ],
    actions: ['view', 'create', 'edit', 'set-role'],
    empty: 'No users found.',
  },
  roles: {
    id: 'roles',
    presentation: 'table',
    stateOwner: 'local',
    getRowId: key,
    columns: [
      { id: 'name', label: 'Role' },
      { id: 'type', label: 'Type' },
      { id: 'permissions', label: 'Permissions', className: 'hidden md:table-cell' },
      { id: 'users', label: 'Users', className: 'hidden md:table-cell' },
      { id: 'actions', label: 'Actions', className: 'w-col-actions' },
    ],
    defaults: {},
    controls: [],
    actions: ['view', 'create', 'edit', 'duplicate', 'delete'],
    empty: 'No roles found.',
  },
  audit: {
    id: 'audit',
    presentation: 'table',
    stateOwner: 'url',
    getRowId: id,
    columns: [
      { id: 'action', label: 'Action' },
      { id: 'actor', label: 'Actor' },
      { id: 'target', label: 'Target' },
      { id: 'when', label: 'When' },
      { id: 'details', label: 'Details', className: 'w-col-actions' },
    ],
    defaults: { pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc' },
    controls: ['pageIndex'],
    actions: ['view'],
    empty: 'No audit events recorded yet.',
  },
  providers: {
    id: 'providers',
    presentation: 'cards',
    stateOwner: 'local',
    getRowId: id,
    columns: [],
    defaults: {},
    controls: ['modelSearch', 'expandedIds'],
    actions: ['view', 'create', 'edit', 'refresh', 'models', 'delete'],
    empty: 'No providers configured.',
  },
  apiKeys: {
    id: 'api-keys',
    presentation: 'table',
    stateOwner: 'local',
    getRowId: id,
    columns: [
      { id: 'name', label: 'Name' },
      { id: 'prefix', label: 'Prefix' },
      { id: 'status', label: 'Status' },
      { id: 'createdAt', label: 'Created', className: 'hidden lg:table-cell' },
    ],
    defaults: { pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc' },
    controls: ['pageIndex', 'search', 'searchField', 'status', 'sortDirection'],
    actions: ['view', 'create', 'edit', 'revoke'],
    empty: 'No API keys found.',
  },
  overview: {
    id: 'overview',
    presentation: 'summary',
    stateOwner: 'none',
    getRowId: id,
    columns: [],
    defaults: { pageSize: 5 },
    controls: [],
    actions: ['view'],
    empty: 'No recent activity.',
  },
} as const satisfies Record<string, AdminTableDefinition<{ id: string } & { key: string }>>;

export function parseAuditPage(value: string | string[] | undefined) {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function clampPageIndex(index: number, pageSize: number, total: number) {
  return Math.max(0, Math.min(index, Math.max(0, Math.ceil(total / pageSize) - 1)));
}

const usersQuery = z.object({
  pageIndex: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  searchValue: z.string(),
  searchField: z.enum(['email', 'name']),
  searchOperator: z.enum(['contains', 'starts_with', 'ends_with']),
  status: z.enum(['all', 'active', 'banned']),
  sortBy: z.enum(['name', 'createdAt']),
  sortDirection: z.enum(['asc', 'desc']),
});
export function usersRequestParams(input: z.input<typeof usersQuery>) {
  const state = usersQuery.parse(input);
  return {
    limit: state.pageSize,
    offset: state.pageIndex * state.pageSize,
    searchField: state.searchField,
    searchOperator: state.searchOperator,
    searchValue: state.searchValue.trim() || undefined,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    ...(state.status === 'all'
      ? {}
      : {
          filterField: 'banned',
          filterOperator: 'eq' as const,
          filterValue: state.status === 'banned',
        }),
  };
}
