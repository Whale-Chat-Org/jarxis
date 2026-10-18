import { Suspense } from 'react';

import { parseAuditPage } from '@/components/admin/table/table-definitions';
import { AuditEventsLoading } from '@/components/admin/audit/audit-events-loading';
import { AuditPanel } from '@/components/admin/audit/audit-panel';
import { requirePage } from '@/lib/rbac';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage('audit:read');
  const sp = await searchParams;
  const page = parseAuditPage(sp.page);

  return (
    <div className="flex flex-col gap-stack">
      <Suspense key={page} fallback={<AuditEventsLoading />}>
        <AuditPanel page={page} />
      </Suspense>
    </div>
  );
}
