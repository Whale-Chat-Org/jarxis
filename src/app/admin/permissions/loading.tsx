import { LoadingRegion, PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading permissions…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton />
      <TableSkeleton columns={3} rows={8} />
    </LoadingRegion>
  );
}
