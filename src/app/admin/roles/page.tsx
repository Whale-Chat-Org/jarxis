import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { guideCategories, grantsForRoles, roleOptions } from '@/lib/access-display';
import { requirePage } from '@/lib/rbac';

/**
 * Roles are declared in `src/lib/permissions.ts` and shipped with the application, so this page is
 * read-only: changing a role means a code change and a deploy, not a database write. One view per
 * size — a card per role on mobile, one comparison table on desktop — and every answer is derived
 * from the role's live grants rather than a hand-kept matrix.
 */
export default async function RolesPage() {
  const grants = await requirePage('roles:read');
  const canReadUsers = grants.permissions.has('users:read');

  const roles = roleOptions.map((role) => ({ ...role, grants: grantsForRoles([role.id]) }));

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-heading font-semibold tracking-tight">Roles</h2>
          <p className="text-body-sm text-muted-foreground">
            {roles.length} role{roles.length === 1 ? '' : 's'} define the available access levels.
            These roles are fixed and cannot be edited here.
          </p>
        </div>
        {canReadUsers ? (
          <Button asChild variant="outline">
            <Link href="/admin/users">
              Manage user access
              <ArrowRightIcon />
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Mobile: one card per role, so each role reads top to bottom without sideways scrolling. */}
      <div className="flex flex-col gap-lg lg:hidden">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="text-body font-medium">{role.label}</CardTitle>
              <CardDescription>{role.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-sm">
                {guideCategories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-baseline justify-between gap-md border-b pb-sm last:border-b-0 last:pb-none"
                  >
                    <dt className="text-body-sm font-medium">{category.title}</dt>
                    <dd className="text-right text-body-sm text-muted-foreground">
                      {category.summarise(role.grants)}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop: a comparison table, roles across the top. */}
      <div className="hidden overflow-hidden rounded-lg border lg:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">Capability</TableHead>
              {roles.map((role) => (
                <TableHead key={role.id} className="align-top whitespace-normal">
                  <div className="flex flex-col gap-3xs py-sm">
                    <span className="font-medium">{role.label}</span>
                    <span className="text-caption font-normal text-muted-foreground">
                      {role.description}
                    </span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {guideCategories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="align-top whitespace-normal">
                  <div className="font-medium">{category.title}</div>
                  <div className="text-caption text-muted-foreground">{category.description}</div>
                </TableCell>
                {roles.map((role) => (
                  <TableCell
                    key={role.id}
                    className="align-top whitespace-normal text-muted-foreground"
                  >
                    {category.summarise(role.grants)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
