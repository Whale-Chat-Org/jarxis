import { Skeleton } from '@/components/ui/skeleton';
import { LoadingRegion, PageHeaderSkeleton, RoleCardsSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading roles…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton action={<Skeleton className="h-control w-bar-lg" />} />
      <RoleCardsSkeleton />
    </LoadingRegion>
  );
}
