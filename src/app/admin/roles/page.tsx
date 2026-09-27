import { ShieldCheckIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { flattenStatements, roleCatalog, roleNames, roles } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

/**
 * Roles are declared in `src/lib/permissions.ts` and shipped with the application, so this page is
 * read-only: changing a role means a code change and a deploy, not a database write. That is what
 * keeps the system roles protected.
 */
export default async function RolesPage() {
  await requirePage('roles:read');

  const data = roleNames.map((name) => ({
    id: name,
    ...roleCatalog[name],
    permissions: flattenStatements(roles[name]).sort(),
  }));

  return (
    <div className="flex flex-col gap-stack">
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Roles</h2>
        <p className="text-body-sm text-muted-foreground">
          {data.length} role{data.length === 1 ? '' : 's'} declared in code. Owners assign them from
          the users screen.
        </p>
      </div>

      <div className="grid gap-lg md:grid-cols-2">
        {data.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-sm">
                {role.name}
                <Badge variant="outline">
                  <ShieldCheckIcon /> System
                </Badge>
              </CardTitle>
              <CardDescription>{role.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2xs">
                {role.permissions.length === 0 ? (
                  <span className="text-caption text-muted-foreground">No permissions granted</span>
                ) : (
                  role.permissions.map((permission) => (
                    <Badge key={permission} variant="secondary">
                      {permission}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
