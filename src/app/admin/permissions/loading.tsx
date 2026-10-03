import { LoadingRegion, PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons';

/**
 * Mirrors the permissions layout: intro, then two sections (Administration and Application) each
 * rendering the two-column table (permission with its key, and scope).
 */
export default function Loading() {
  return (
    <LoadingRegion label="Loading permissions…" className="flex flex-col gap-stack">
      <PageHeaderSkeleton />
      <TableSkeleton columns={2} rows={6} />
      <TableSkeleton columns={2} rows={6} />
    </LoadingRegion>
  );
}
