import { AccessFiltersSkeleton, AccessListSkeleton } from '@/components/admin/access-skeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingRegion, PageHeaderSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading users and access…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton />
      <div className="flex gap-2xs">
        <Skeleton className="h-control w-bar-xl" />
        <Skeleton className="h-control w-bar-3xl" />
      </div>
      <AccessFiltersSkeleton />
      <AccessListSkeleton />
    </LoadingRegion>
  );
}
