'use client';
import { AdminDataTable } from '@/components/admin/table/data-table';
import { SortButton } from '@/components/admin/table/sort-button';
import { adminTableDefinitions } from '@/components/admin/table/table-definitions';
import { AdminTablePagination } from '@/components/admin/table/table-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/admin-user-utils';
import type { ApiKeysState } from '@/types/admin-api-keys';
export function ApiKeysTable({ state }: { state: ApiKeysState }) {
  return (
    <AdminDataTable
      definition={adminTableDefinitions.apiKeys}
      rows={state.query.data?.keys ?? []}
      headers={{
        createdAt: (
          <SortButton
            sorted={state.filters.sortDirection}
            onClick={() =>
              state.updateFilters({
                sortDirection: state.filters.sortDirection === 'asc' ? 'desc' : 'asc',
              })
            }
          >
            Created
          </SortButton>
        ),
      }}
      rowProps={(key) => ({
        'aria-selected': state.selectedId === key.id,
        className: 'cursor-pointer',
        onClick: () => state.setSelectedId(key.id),
      })}
      cells={{
        name: (key) => (
          <Button
            variant="link"
            className="h-auto max-w-form p-none font-medium"
            onClick={(event) => {
              event.stopPropagation();
              state.setSelectedId(key.id);
            }}
          >
            <span className="truncate">{key.name}</span>
          </Button>
        ),
        prefix: (key) => <span className="font-mono text-caption">{key.prefix}…</span>,
        status: (key) => <Badge variant="secondary">{key.revokedAt ? 'Revoked' : 'Active'}</Badge>,
        createdAt: (key) => formatDate(key.createdAt),
      }}
      footer={
        <AdminTablePagination
          pageIndex={state.pageIndex}
          pageSize={state.pageSize}
          total={state.total}
          fetching={state.query.isFetching}
          onPageChange={state.setPageIndex}
        />
      }
    />
  );
}
