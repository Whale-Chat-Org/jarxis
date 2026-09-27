import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/**
 * Permission vocabulary for the application's own pages and routes.
 *
 * These keys are what `requirePage`, `authorize` and `nav-items.ts` speak. The Better Auth admin
 * plugin additionally exposes `user:*` and `session:*` actions, described by
 * {@link adminPermissionCatalog}; a role must hold both kinds to drive the admin UI.
 */
export const permissionCatalog = {
  'dashboard:read': 'View the administration overview',
  'users:read': 'List user profiles and assigned roles',
  'users:update': 'Change user names and account status',
  'roles:read': 'View roles and their permissions',
  'roles:update': 'Manage roles (owner only)',
  'roles:assign': 'Assign and remove user roles (owner only)',
  'permissions:read': 'View the permission catalog',
  'audit:read': 'View security and administrative audit events',
} as const;
export type Permission = keyof typeof permissionCatalog;
export const permissionKeys = Object.keys(permissionCatalog) as Permission[];
export const ownerOnly = new Set<Permission>(['roles:update', 'roles:assign']);

/**
 * The `user:*` / `session:*` actions the Better Auth admin plugin checks. The registry admin UI
 * gates each control on one of these, so they are part of a role's grant even though the project's
 * own pages never name them.
 */
export const adminPermissionCatalog = {
  'user:create': 'Create users from the administration UI',
  'user:list': 'List users',
  'user:get': 'Open a user inspector',
  'user:update': 'Change user profile fields',
  'user:set-role': 'Change a user role (owner only)',
  'user:set-password': 'Set a user password',
  'user:set-email': 'Change a user email address',
  'user:ban': 'Ban and unban users',
  'user:delete': 'Delete users (owner only)',
  'user:impersonate': 'Sign in as another user',
  'user:impersonate-admins': 'Impersonate another administrator (owner only)',
  'session:list': 'View a user session list',
  'session:revoke': 'Revoke a user session',
  'session:delete': 'Delete a user session',
} as const;
export type AdminPermission = keyof typeof adminPermissionCatalog;

/**
 * Full statement map. The admin plugin's own resources come from `defaultStatements`; the rest are
 * this application's. Both are declared in one place so a role's grant and the plugin's
 * authorization checks can never disagree.
 */
export const statement = {
  ...defaultStatements,
  dashboard: ['read'],
  users: ['read', 'update'],
  roles: ['read', 'update', 'assign'],
  permissions: ['read'],
  audit: ['read'],
} as const;

export const ac = createAccessControl(statement);

export const roleNames = ['user', 'viewer', 'administrator', 'owner'] as const;
export type RoleName = (typeof roleNames)[number];

/** Roles a fresh account lands on: no administrative access at all (deny by default). */
export const defaultRole = 'user' satisfies RoleName;

/** Roles the admin plugin treats as administrators for the impersonation guard. */
export const adminRoles: RoleName[] = ['owner', 'administrator'];

export const roleStatements = {
  user: {},
  viewer: {
    user: ['list', 'get'],
    session: [],
    dashboard: ['read'],
    users: ['read'],
    roles: ['read'],
    permissions: ['read'],
    audit: ['read'],
  },
  administrator: {
    user: ['create', 'list', 'get', 'update', 'ban', 'set-password', 'set-email'],
    session: ['list', 'revoke'],
    dashboard: ['read'],
    users: ['read', 'update'],
    roles: ['read'],
    permissions: ['read'],
    audit: ['read'],
  },
  owner: {
    user: [...defaultStatements.user],
    session: [...defaultStatements.session],
    dashboard: ['read'],
    users: ['read', 'update'],
    roles: ['read', 'update', 'assign'],
    permissions: ['read'],
    audit: ['read'],
  },
} as const;

/** Better Auth role objects, handed to `admin({ roles })` and read back by `grants()`. */
export const roles = {
  user: ac.newRole(roleStatements.user),
  viewer: ac.newRole(roleStatements.viewer),
  administrator: ac.newRole(roleStatements.administrator),
  owner: ac.newRole(roleStatements.owner),
};

/** Human-readable metadata for the read-only roles page. */
export const roleCatalog: Record<RoleName, { name: string; description: string }> = {
  user: { name: 'User', description: 'Signed-in account with no administrative access.' },
  viewer: { name: 'Viewer', description: 'Read-only access to administration screens.' },
  administrator: {
    name: 'Administrator',
    description: 'Manage users and view operational information. Cannot change roles.',
  },
  owner: {
    name: 'Owner',
    description: 'Full administration, including role assignment and user removal.',
  },
};

/**
 * Flatten a role's statements into `resource:action` keys — the same shape as
 * {@link permissionCatalog} and {@link adminPermissionCatalog}, so `grants()` can build one set.
 */
export function flattenStatements(role: { statements?: Record<string, unknown> }): string[] {
  const statements = role.statements ?? {};
  return Object.entries(statements).flatMap(([resource, actions]) =>
    (Array.isArray(actions) ? actions : []).map((action) => `${resource}:${String(action)}`),
  );
}

/** Every permission any declared role can hold, for validation and the permissions page. */
export const declaredPermissionKeys = [
  ...new Set(Object.values(roles).flatMap((role) => flattenStatements(role))),
].sort();

/** Split a stored `user.role` value into recognised role names. Unknown names grant nothing. */
export function parseRoles(role: string | null | undefined): RoleName[] {
  return (role ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is RoleName => (roleNames as readonly string[]).includes(value));
}

export function isAllowed(
  permissions: ReadonlySet<string>,
  assignedRoles: readonly string[],
  permission: Permission,
) {
  return (
    permissions.has(permission) && (!ownerOnly.has(permission) || assignedRoles.includes('owner'))
  );
}
