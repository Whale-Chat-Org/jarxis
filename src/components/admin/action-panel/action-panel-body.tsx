import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

export function ActionPanelBody({ loading, children }: { loading?: boolean; children: ReactNode }) {
  return (
    <div data-slot="admin-panel-scroll-area" className="min-h-none flex-1 overflow-y-auto p-xl">
      {loading ? (
        <div role="status" aria-label="Loading…" className="space-y-md">
          <Skeleton className="h-control w-full" />
          <Skeleton className="h-control w-full" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
