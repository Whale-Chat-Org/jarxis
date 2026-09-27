import {
  ListCardSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  StatCardsSkeleton,
} from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading overview…" className="flex flex-col gap-section">
      <PageHeaderSkeleton />
      <StatCardsSkeleton />
      <ListCardSkeleton />
    </LoadingRegion>
  );
}
