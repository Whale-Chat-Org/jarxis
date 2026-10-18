import { db } from '@/db';
import 'server-only';

/** Read-only paginated audit queries, newest first with a stable ID tie-breaker. */
export async function listAudit(page = 1, pageSize = 20) {
  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.auditLog.count(),
  ]);
  return { data, total, page, pageSize };
}
