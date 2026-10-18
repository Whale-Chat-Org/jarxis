import { LoadingRegion, PaginationSkeleton, TableSkeleton } from '@/components/skeletons';

export function AuditEventsLoading() {
  return (
    <LoadingRegion label="Loading audit events…" className="flex flex-col gap-stack">
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Audit Log</h2>
        <p className="text-body-sm text-muted-foreground">Loading…</p>
      </div>
      <TableSkeleton columns={5} rows={10} />
      <PaginationSkeleton />
    </LoadingRegion>
  );
}
