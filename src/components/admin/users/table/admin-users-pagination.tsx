'use client';
import { AdminTablePagination } from '@/components/admin/table/table-pagination';
import type { UsersPaginationState } from '@/types/admin-users';
export function AdminUsersPagination({ state }: { state: UsersPaginationState }) {
  const { pagination, total, users, localization, table, from, to } = state;
  return (
    <AdminTablePagination
      pageIndex={pagination.pageIndex}
      pageSize={pagination.pageSize}
      total={total}
      fetching={users.isFetching}
      previousLabel={localization.previousPage}
      nextLabel={localization.nextPage}
      onPageChange={(index) => table.setPageIndex(index)}
      rangeText={localization.usersPaginationRange
        .replace('{{from}}', String(from))
        .replace('{{to}}', String(to))
        .replace('{{total}}', String(total))}
    />
  );
}
