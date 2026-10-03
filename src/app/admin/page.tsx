import { formatDistanceToNow } from 'date-fns';
import { KeyRoundIcon, ScrollTextIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { listAudit } from '@/lib/admin-service';
import { adminPermissionCatalog, permissionKeys, roleNames } from '@/lib/permissions';
import { requirePage } from '@/lib/rbac';

export default async function AdminDashboardPage() {
  const { permissions } = await requirePage('dashboard:read');
  const can = (permission: string) => permissions.has(permission);

  const [usersTotal, bannedTotal, audit] = await Promise.all([
    can('users:read') ? db.user.count() : Promise.resolve(null),
    can('users:read') ? db.user.count({ where: { banned: true } }) : Promise.resolve(null),
    can('audit:read') ? listAudit(1, 5) : Promise.resolve(null),
  ]);

  const permissionTotal = permissionKeys.length + Object.keys(adminPermissionCatalog).length;

  const cards = [
    can('users:read') && usersTotal !== null && bannedTotal !== null
      ? {
          key: 'users',
          href: '/admin/users',
          icon: UsersIcon,
          title: 'Users & access',
          value: usersTotal,
          description: `${usersTotal - bannedTotal} active, ${bannedTotal} banned`,
        }
      : null,
    can('roles:read')
      ? {
          key: 'roles',
          href: '/admin/roles',
          icon: ShieldCheckIcon,
          title: 'Roles',
          value: roleNames.length,
          description: 'Compare available access levels',
        }
      : null,
    can('permissions:read')
      ? {
          key: 'permissions',
          href: '/admin/permissions',
          icon: KeyRoundIcon,
          title: 'Permissions',
          value: permissionTotal,
          description: 'Entries in the permission catalog',
        }
      : null,
    can('audit:read') && audit
      ? {
          key: 'audit',
          href: '/admin/audit',
          icon: ScrollTextIcon,
          title: 'Audit events',
          value: audit.total,
          description: 'Total recorded administrative actions',
        }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div className="flex flex-col gap-section">
      <div>
        <h2 className="text-heading font-semibold tracking-tight">Overview</h2>
        <p className="text-body-sm text-muted-foreground">
          A snapshot of the data your role can access.
        </p>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No data available</CardTitle>
            <CardDescription>
              Your role doesn&apos;t grant access to any overview metrics yet.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link key={card.key} href={card.href}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardDescription>{card.title}</CardDescription>
                    <card.icon className="size-icon text-muted-foreground" />
                  </div>
                  <CardTitle className="text-headline font-semibold">{card.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-caption text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {can('audit:read') && audit && audit.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The latest administrative actions across the system.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-md">
            {audit.data.map((entry: { id: string; action: string; createdAt: Date | string }) => (
              <div key={entry.id} className="flex items-center justify-between gap-lg text-body-sm">
                <span className="truncate font-medium">{entry.action}</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
