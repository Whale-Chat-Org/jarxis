import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { permissionCatalog } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';
import { listPermissions } from '@/lib/roles';

type Entry = { key: string; description: string; scope: string };

/**
 * The permission key is shown as supporting mono text under its description, in the same cell, so
 * there is no separate key column to widen the table on narrow screens.
 */
function table(entries: Entry[]) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permission</TableHead>
            <TableHead className="w-col-scope">Scope</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.key}>
              <TableCell className="align-top whitespace-normal">
                <div className="text-foreground">{entry.description}</div>
                <code className="font-mono text-caption break-all text-muted-foreground">
                  {entry.key}
                </code>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {entry.scope === 'owner' ? (
                  <Badge variant="outline">Owner only</Badge>
                ) : (
                  <Badge variant="secondary">Standard</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function PermissionsPage() {
  await requirePage('permissions:read');

  const entries: Entry[] = (await listPermissions()).map((entry) => ({
    key: entry.key,
    description: entry.description,
    scope: entry.restricted ? 'owner' : 'standard',
  }));
  const isApplication = (key: string) => Object.hasOwn(permissionCatalog, key);
  const application = entries.filter((entry) => isApplication(entry.key));
  const administration = entries.filter((entry) => !isApplication(entry.key));
  const total = application.length + administration.length;

  return (
    <div className="flex flex-col gap-stack">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-heading font-semibold tracking-tight">Permissions</h2>
        <p className="text-body-sm text-muted-foreground">
          {total} permission{total === 1 ? '' : 's'} in the catalog. Owner and User are fixed;
          owners can grant standard permissions to any other role.
        </p>
        <p className="text-body-sm text-muted-foreground">
          <span className="font-medium">Standard</span> marks the scope of a permission, not who
          holds it — it only means the permission is not restricted to owners. A role still grants
          it only if it is listed in that role.
        </p>
      </div>

      <section className="flex flex-col gap-sm">
        <h3 className="text-title font-medium">Administration</h3>
        <p className="text-body-sm text-muted-foreground">
          Actions available when managing user accounts and sessions.
        </p>
        {table(administration)}
      </section>

      <section className="flex flex-col gap-sm">
        <h3 className="text-title font-medium">Application</h3>
        <p className="text-body-sm text-muted-foreground">
          Access to administration screens and their actions.
        </p>
        {table(application)}
      </section>
    </div>
  );
}
