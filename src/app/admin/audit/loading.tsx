import {
  LoadingRegion,
  PageHeaderSkeleton,
  PaginationSkeleton,
  TableSkeleton,
} from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading audit log…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton />
      <TableSkeleton columns={5} rows={10} />
      <PaginationSkeleton />
    </LoadingRegion>
  );
}
