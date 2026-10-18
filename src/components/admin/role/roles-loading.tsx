import { LoadingRegion, PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors the roles layout: intro with the create action, then the roles table. */
export function RolesLoading() {
  return (
    <LoadingRegion label="Loading roles…" className="flex flex-col gap-section">
      <PageHeaderSkeleton action={<Skeleton className="h-control w-bar-lg" />} />
      <TableSkeleton columns={5} rows={4} />
    </LoadingRegion>
  );
}
