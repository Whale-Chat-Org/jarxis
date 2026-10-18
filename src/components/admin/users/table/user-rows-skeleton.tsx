'use client';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import { skeletonRowIds } from '@/lib/admin-user-skeletons';
export function UserRowsSkeleton() {
  return skeletonRowIds.map((id) => (
    <TableRow key={id}>
      <TableCell>
        <div className="flex items-center gap-md">
          <Skeleton className="size-2xl rounded-full" />
          <div className="flex flex-col gap-2xs">
            <Skeleton className="h-icon w-bar-xl" />
            <Skeleton className="h-md w-menu-xs" />
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-icon-lg w-2xl" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-icon-lg w-2xl" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="h-icon w-bar-md" />
      </TableCell>
    </TableRow>
  ));
}
