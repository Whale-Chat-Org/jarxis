/**
 * Roles and permissions are declared in `src/lib/permissions.ts` and shipped with the application,
 * so there is nothing to seed. This script keeps the `pnpm db:seed` contract used by the deployment
 * pipeline and turns it into an integrity check: every permission a role can hold must exist in the
 * declared statement map, and every project permission key must be granted by at least one role.
 */
import 'dotenv/config';
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
console.log('Role catalog verified; roles are code-declared and no rows are written.');
