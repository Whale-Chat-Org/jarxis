import { LoadingRegion } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <LoadingRegion label="Loading chat" className="flex h-svh bg-background">
      <div className="hidden w-sidebar shrink-0 space-y-stack border-r border-border bg-sidebar p-page md:block">
        <Skeleton className="h-control w-bar-lg" />
        <Skeleton className="h-control w-full" />
        <Skeleton className="h-control w-full" />
      </div>
      <div className="flex min-w-none flex-1 flex-col">
        <div className="flex h-header items-center border-b border-border px-page">
          <Skeleton className="h-control-xs w-bar-xl" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-section p-page">
          <Skeleton className="h-control w-bar-5xl" />
          <Skeleton className="h-empty-row w-full max-w-panel rounded-3xl" />
        </div>
      </div>
    </LoadingRegion>
  );
}
