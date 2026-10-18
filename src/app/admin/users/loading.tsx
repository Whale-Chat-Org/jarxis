import {
  UsersFiltersSkeleton,
  UsersListSkeleton,
} from '@/components/admin/users/table/users-skeleton';
import { LoadingRegion } from '@/components/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading users and access…" className="flex flex-col gap-stack">
      <UsersFiltersSkeleton />
      <UsersListSkeleton />
    </LoadingRegion>
  );
}
