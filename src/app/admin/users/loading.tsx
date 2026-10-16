import { AccessFiltersSkeleton, AccessListSkeleton } from '@/components/admin/access-skeleton';
import { LoadingRegion } from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading users and access…" className="flex flex-col gap-stack">
      <AccessFiltersSkeleton />
      <AccessListSkeleton />
    </LoadingRegion>
  );
}
