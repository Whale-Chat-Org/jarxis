'use client';
import { Table, TableBody } from '@/components/ui/table';

import { UserRowsSkeleton } from './user-rows-skeleton';
export function UserTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableBody>
          <UserRowsSkeleton />
        </TableBody>
      </Table>
    </div>
  );
}
