import { format } from 'date-fns';

import { AdminDataTable } from '@/components/admin/table/data-table';
import { adminTableDefinitions, clampPageIndex } from '@/components/admin/table/table-definitions';
import { AdminTablePagination } from '@/components/admin/table/table-pagination';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { listAudit } from '@/lib/audit-service';

const pageSize = adminTableDefinitions.audit.defaults.pageSize;

export async function AuditPanel({ page }: { page: number }) {
  let result = await listAudit(page, pageSize);
  const clamped = clampPageIndex(page - 1, pageSize, result.total) + 1;
  if (clamped !== page) {
    page = clamped;
    result = await listAudit(page, pageSize);
  }

  return (
    <>
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Audit Log</h2>
        <p className="text-body-sm text-muted-foreground">
          {result.total} recorded administrative action
          {result.total === 1 ? '' : 's'}.
        </p>
      </div>

      <AdminDataTable
        definition={adminTableDefinitions.audit}
        rows={result.data}
        cells={{
          action: (entry) => <>{entry.action}</>,
          actor: (entry) => <>{entry.actorId}</>,
          target: (entry) => <>{entry.targetId}</>,
          when: (entry) => <>{format(new Date(entry.createdAt), 'PPpp')}</>,
          details: (entry) => (
            <>
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
            </>
          ),
        }}
      />

      <AdminTablePagination
        pageIndex={page - 1}
        pageSize={pageSize}
        total={result.total}
        href={(index) => `?page=${index + 1}`}
      />
    </>
  );
}
