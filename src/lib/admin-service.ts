import 'server-only';
import { db } from '@/db';

/**
 * Read-side administration queries.
 *
 * User, role and permission *writes* now go through the Better Auth admin plugin; the extra safety
 * rules live in `src/lib/auth/admin-guards.ts`. The previous `adminWrite` helper and the
 * `listUsers`/`updateUser`/`assignRoles`/`listRoles`/`saveRole`/`deleteRole` functions are gone,
 * along with the `roles`/`permissions`/`user_roles`/`role_permissions` tables.
 *
 * What remains is the audit trail, which stays in `audit_logs` because the plugin has no
 * equivalent.
 */
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
