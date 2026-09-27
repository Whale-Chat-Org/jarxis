import { format } from 'date-fns';
import Link from 'next/link';
import { Suspense } from 'react';

import { LoadingRegion, PaginationSkeleton, TableSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listAudit } from '@/lib/admin-service';
import { requirePage } from '@/lib/rbac';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const pageSize = 20;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage('audit:read');
  const sp = await searchParams;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  return (
    <div className="flex flex-col gap-stack">
      <Suspense
        key={page}
        fallback={
          <LoadingRegion label="Loading audit events…" className="flex flex-col gap-stack">
            <div>
              <h2 className="text-heading font-semibold tracking-tight">Audit Log</h2>
              <p className="text-body-sm text-muted-foreground">Loading…</p>
            </div>
            <TableSkeleton columns={5} rows={10} />
            <PaginationSkeleton />
          </LoadingRegion>
        }
      >
        <AuditTable page={page} />
      </Suspense>
    </div>
  );
}

async function AuditTable({ page }: { page: number }) {
  const result = await listAudit(page, pageSize);
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

  return (
    <>
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Audit Log</h2>
        <p className="text-body-sm text-muted-foreground">
          {result.total} recorded administrative action
          {result.total === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="w-col-actions">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-empty-row text-center text-body-sm text-muted-foreground"
                >
                  No audit events recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              result.data.map(
                (entry: {
                  id: string;
                  action: string;
                  actorId: string;
                  targetId: string;
                  changes: unknown;
                  createdAt: Date | string;
                }) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.action}</TableCell>
                    <TableCell className="font-mono text-caption text-muted-foreground">
                      {entry.actorId}
                    </TableCell>
                    <TableCell className="font-mono text-caption text-muted-foreground">
                      {entry.targetId}
                    </TableCell>
                    <TableCell className="text-caption text-muted-foreground">
                      {format(new Date(entry.createdAt), 'PPpp')}
                    </TableCell>
                    <TableCell>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="link" size="sm">
                            View
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <pre className="mt-sm max-w-form overflow-x-auto rounded-md bg-muted p-sm text-caption">
                            {JSON.stringify(entry.changes, null, 2)}
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-body-sm text-muted-foreground">
          Page {page} of {totalPages}
        </p>
        <div className="flex items-center gap-sm">
          {page <= 1 ? (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          {page >= totalPages ? (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
