import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingRegion, PageHeaderSkeleton } from '@/components/skeletons';

/**
 * Mirrors the roles layout: intro with the assign-link action, then one card per role on mobile
 * and the capability comparison table on desktop.
 */
export default function Loading() {
  return (
    <LoadingRegion label="Loading roles…" className="flex flex-col gap-section">
      <PageHeaderSkeleton action={<Skeleton className="h-control w-bar-5xl" />} />

      <div className="flex flex-col gap-lg lg:hidden">
        {['owner', 'administrator', 'viewer', 'user'].map((role) => (
          <Card key={role}>
            <CardHeader className="gap-sm">
              <Skeleton className="h-lg-plus w-bar-lg" />
              <Skeleton className="h-lg w-bar-4xl max-w-full" />
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => (
                <div key={id} className="flex items-center justify-between gap-lg">
                  <Skeleton className="h-lg w-1/2" />
                  <Skeleton className="h-lg w-bar-xs shrink-0" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="hidden rounded-lg border p-lg lg:block">
        <div className="flex flex-col gap-md">
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => (
            <Skeleton key={id} className="h-lg w-full" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
