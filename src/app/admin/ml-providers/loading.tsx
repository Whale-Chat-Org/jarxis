import { LoadingRegion, PageHeaderSkeleton, ListCardSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <LoadingRegion label="Loading providers…" className="flex min-w-none flex-col gap-stack">
      <PageHeaderSkeleton action={<Skeleton className="h-control w-bar-lg" />} />
      <div className="grid min-w-none gap-stack lg:grid-cols-2">
        <ListCardSkeleton />
        <ListCardSkeleton />
      </div>
      <ListCardSkeleton />
    </LoadingRegion>
  );
}
