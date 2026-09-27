import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  adminPermissionCatalog,
  ownerOnly,
  permissionCatalog,
  roleNames,
  type Permission,
} from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

type Entry = { key: string; description: string; scope: string };

function table(entries: Entry[]) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-col-scope">Scope</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.key}>
              <TableCell className="font-mono text-caption font-medium">{entry.key}</TableCell>
              <TableCell className="text-muted-foreground">{entry.description}</TableCell>
              <TableCell>
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

  const application: Entry[] = Object.entries(permissionCatalog).map(([key, description]) => ({
    key,
    description,
    scope: ownerOnly.has(key as Permission) ? 'owner' : 'standard',
  }));
  const administration: Entry[] = Object.entries(adminPermissionCatalog).map(
    ([key, description]) => ({
      key,
      description,
      scope:
        key === 'user:set-role' || key === 'user:delete' || key === 'user:impersonate-admins'
          ? 'owner'
          : 'standard',
    }),
  );
  const total = application.length + administration.length;

  return (
    <div className="flex flex-col gap-stack">
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Permissions</h2>
        <p className="text-body-sm text-muted-foreground">
          {total} permission{total === 1 ? '' : 's'} across {roleNames.length} code-declared roles.
          Roles grant a subset of these.
        </p>
      </div>

      <section className="flex flex-col gap-sm">
        <h3 className="text-title font-medium">Administration</h3>
        <p className="text-body-sm text-muted-foreground">
          Checked by the Better Auth admin plugin on every user-management request.
        </p>
        {table(administration)}
      </section>

      <section className="flex flex-col gap-sm">
        <h3 className="text-title font-medium">Application</h3>
        <p className="text-body-sm text-muted-foreground">
          Checked by this application&apos;s pages and routes.
        </p>
        {table(application)}
      </section>
    </div>
  );
}
