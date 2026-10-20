/** Persisted vocabulary: user/role/bootstrap actions retain their existing wire spelling. */
export const adminAuditActions = {
  '/admin/create-user': 'user.create',
  '/admin/update-user': 'user.update',
  '/admin/set-role': 'user.roles.replace',
  '/admin/set-user-password': 'user.password.set',
  '/admin/ban-user': 'user.ban',
  '/admin/unban-user': 'user.unban',
  '/admin/remove-user': 'user.delete',
  '/admin/revoke-user-session': 'user.session.revoke',
  '/admin/revoke-user-sessions': 'user.sessions.revoke',
  '/admin/impersonate-user': 'user.impersonate',
  '/admin/stop-impersonating': 'user.impersonate.stop',
} as const;
export type ProviderAuditOperation =
  | 'connection:create'
  | 'connection:update'
  | 'connection:delete'
  | 'connection:refresh'
  | 'model:add'
  | 'model:update'
  | 'model:alias'
  | 'key:rename'
  | 'key:issue'
  | 'key:revoke';
export type AuditAction =
  | (typeof adminAuditActions)[keyof typeof adminAuditActions]
  | `role.${'create' | 'update' | 'delete'}`
  | `providers:${ProviderAuditOperation}`
  | 'owner.bootstrap'
  | 'user.seed';

/** Canonical grouping for consumers; historical database rows are never rewritten. */
export function auditActionParts(action: string): string[] {
  return action.replace(/^ml:/, 'providers:').split(/[.:]/);
}
