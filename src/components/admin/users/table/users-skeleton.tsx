import {
  ListCardSkeleton,
  LoadingRegion,
  PaginationSkeleton,
  TableSkeleton,
} from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/** One search box, matching the directory's only filter. */
export function UsersFiltersSkeleton() {
  return <Skeleton className="h-control w-full" />;
}

export function UsersListSkeleton() {
  return (
    <LoadingRegion label="Loading users…" className="flex flex-col gap-stack">
      <div className="hidden lg:block">
        <TableSkeleton columns={4} rows={10} />
      </div>
      <div className="flex flex-col gap-sm lg:hidden">
        {[0, 1, 2].map((index) => (
          <ListCardSkeleton key={index} lines={3} />
        ))}
      </div>
      <PaginationSkeleton />
    </LoadingRegion>
  );
}
