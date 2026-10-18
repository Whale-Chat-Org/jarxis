import { LoadingRegion, TableSkeleton } from '@/components/skeletons';
export function ApiKeysLoading() {
  return (
    <LoadingRegion label="Loading API keys…">
      <TableSkeleton columns={4} rows={5} />
    </LoadingRegion>
  );
}
