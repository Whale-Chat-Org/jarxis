/**
 * `pnpm db:seed`, run by the deployment pipeline after migrations.
 *
 * First an integrity check of `src/lib/permissions.ts`: every permission a role can hold must exist
 * in the declared statement map, and every project permission key must be granted by at least one
 * role. Then the `permissions` table and the system rows of `roles` are synced from it (see
 * `seedRbac`); custom roles and owner edits to Viewer and Administrator are preserved.
 */
import 'dotenv/config';
import { db } from '../src/db';
import { seedRbac } from '../src/lib/rbac-seed';
import {
  adminPermissionCatalog,
  declaredPermissionKeys,
  flattenStatements,
  permissionKeys,
  roleCatalog,
  roleNames,
  roles,
  statement,
} from '../src/lib/permissions';

const declared = new Set(
  Object.entries(statement).flatMap(([resource, actions]) =>
    (actions as readonly string[]).map((action) => `${resource}:${action}`),
  ),
);

const unknown = declaredPermissionKeys.filter((key) => !declared.has(key));
if (unknown.length) {
  console.error(`Role grants reference undeclared permissions: ${unknown.join(', ')}`);
  process.exit(1);
}

const granted = new Set(declaredPermissionKeys);
const ungranted = permissionKeys.filter((key) => !granted.has(key));
if (ungranted.length) {
  console.error(`Project permissions granted by no role: ${ungranted.join(', ')}`);
  process.exit(1);
}

const documented = new Set([...permissionKeys, ...Object.keys(adminPermissionCatalog)]);
const undocumented = declaredPermissionKeys.filter((key) => !documented.has(key));
if (undocumented.length) {
  console.error(`Declared permissions missing a catalogue description: ${undocumented.join(', ')}`);
  process.exit(1);
}

for (const name of roleNames) {
  const count = flattenStatements(roles[name]).length;
  console.log(`${roleCatalog[name].name.padEnd(14)} ${count} permission(s)`);
}
// `--reset-roles` restores Viewer and Administrator to their defaults; refused in production.
const reset = process.argv.includes('--reset-roles');
if (reset && process.env.NODE_ENV === 'production')
  throw new Error('Refusing to reset role grants in production');
const result = await seedRbac(db, { reset });
console.log(
  `Seeded ${result.permissions} permission(s)` +
    (result.removedPermissions ? `, removed ${result.removedPermissions} stale` : '') +
    (result.createdRoles.length ? `; created roles: ${result.createdRoles.join(', ')}` : '') +
    '.',
);
await db.$disconnect();
