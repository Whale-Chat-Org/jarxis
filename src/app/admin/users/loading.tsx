import { Skeleton } from '@/components/ui/skeleton';
import {
  LoadingRegion,
  PageHeaderSkeleton,
  PaginationSkeleton,
  TableSkeleton,
} from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading users…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton
        action={
          <div className="flex items-center gap-sm">
            <Skeleton className="h-control w-full sm:w-search" />
            <Skeleton className="h-control w-select-sm shrink-0" />
          </div>
        }
      />
      {/* Maximum column count (the actions column is permission-dependent), so the
          skeleton never renders fewer cells than the table that replaces it. */}
      <TableSkeleton columns={6} rows={10} />
      <PaginationSkeleton />
    </LoadingRegion>
  );
}
