'use client';

import { DEFAULT_TABLE_SEARCH_DEBOUNCE_MS, getClampedTablePageIndex } from '@better-auth-ui/core';
import {
  type AdminAuthClient,
  type AdminListUsersParams,
  type AdminUser,
} from '@better-auth-ui/core/plugins/admin';
import { useAuth } from '@better-auth-ui/react';
import { useAdminPermission, useAdminUsers } from '@better-auth-ui/react/plugins/admin';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, ShieldAlertIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { UserAvatar } from '@/components/auth/user/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { describeRoles, isAccountBanned, splitRoleValue } from '@/lib/access-display';

import { AccessListSkeleton } from './access-skeleton';
import { ChangeRoleDialog } from './change-role-dialog';

const PAGE_SIZE = 10;
const inlineErrors = { errorPresentation: 'inline' };

export type AccessManagerProps = {
  /** The signed-in operator; their own row offers no role change and the server re-checks writes. */
  currentUserId: string;
  /** Owner + `roles:assign`, decided on the server; the client additionally gates on `user:set-role`. */
  canManageAccess: boolean;
};

/**
 * Server-paginated access directory.
 *
 * One search box, one row per account showing the person, their role and their status, and — for an
 * owner who may assign roles — a single "Change role" action. Writes go through the Better Auth
 * admin API, so this never touches the database directly.
 */
export function AccessManager({ currentUserId, canManageAccess }: AccessManagerProps) {
  const auth = useAuth<AdminAuthClient>();
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [debouncedSearch] = useDebouncedValue(search.trim(), {
    wait: DEFAULT_TABLE_SEARCH_DEBOUNCE_MS,
  });

  // One box searches both fields: an "@" means the operator is typing an address.
  const searchField = debouncedSearch.includes('@') ? 'email' : 'name';

  // A new search returns to the first page so the operator never lands on an empty tail page.
  // Storing the previous key in state is React's documented "adjust state during render" pattern,
  // which avoids a setState-in-effect and the extra committed render it would cause.
  const filterKey = `${debouncedSearch}\u0000${searchField}`;
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (seenFilterKey !== filterKey) {
    setSeenFilterKey(filterKey);
    if (pageIndex !== 0) setPageIndex(0);
  }

  const params = useMemo<AdminListUsersParams>(
    () => ({
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
      searchField,
      searchOperator: 'contains',
      searchValue: debouncedSearch || undefined,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    }),
    [debouncedSearch, pageIndex, searchField],
  );

  // These queries render their own error state with a retry, so they skip the global error toast.
  const permission = useAdminPermission(
    auth.authClient,
    { user: ['list'] },
    { meta: inlineErrors },
  );
  const rolePermission = useAdminPermission(auth.authClient, { user: ['set-role'] });
  const canManage = canManageAccess && rolePermission.data?.success === true;
  const users = useAdminUsers(auth.authClient, {
    meta: inlineErrors,
    enabled: permission.data?.success === true,
    params,
  });

  const total = users.data?.total ?? 0;
  const rows = users.data?.users ?? [];

  // Clamp to the last populated page when a search shrinks the result set beneath the current page.
  // Done during render so the clamped offset is requested immediately rather than after a commit.
  if (users.isSuccess && !users.isFetching) {
    const clamped = getClampedTablePageIndex(pageIndex, PAGE_SIZE, total);
    if (clamped !== pageIndex) setPageIndex(clamped);
  }

  const from = total ? pageIndex * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * PAGE_SIZE);
  const canPreviousPage = pageIndex > 0;
  const canNextPage = to < total;

  const openDialog = (userId: string, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedUserId(userId);
    setDialogOpen(true);
  };

  const rowAction = (user: AdminUser, className?: string) => {
    if (user.id === currentUserId) return <Badge variant="outline">You</Badge>;
    return (
      <Button
        className={className}
        variant="outline"
        size="sm"
        data-access-user-id={user.id}
        onClick={(event) => openDialog(user.id, event.currentTarget)}
      >
        Change role
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-stack">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search by name or email"
          placeholder="Search by name or email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </InputGroup>

      {permission.isPending ? (
        <AccessListSkeleton />
      ) : permission.isError ? (
        <AccessState
          title="Could not check access"
          description="Try checking your access again."
          action={
            <Button variant="outline" onClick={() => permission.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !permission.data?.success ? (
        <AccessState
          title="Access denied"
          description="You do not have permission to view the people in this workspace."
        />
      ) : users.isError ? (
        <AccessState
          title="Could not load people"
          description="The request did not complete. Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => users.refetch()}>
              Try again
            </Button>
          }
        />
      ) : users.isPending || users.isFetching || search.trim() !== debouncedSearch ? (
        <AccessListSkeleton />
      ) : rows.length === 0 ? (
        <AccessState
          title="No people found"
          description="No account matches this search. Clear it to see everyone again."
        />
      ) : (
        <>
          {/* Desktop: a readable table. The whole directory stays scannable from lg upward. */}
          <div
            aria-busy={users.isFetching}
            className="hidden overflow-hidden rounded-lg border lg:block"
          >
            <Table className="table-fixed group-data-[panel-open=true]/admin-workspace:min-w-inspector">
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="w-1/4">Role</TableHead>
                  <TableHead className="w-select-sm">Status</TableHead>
                  {canManage ? (
                    <TableHead className="w-menu-sm text-right">
                      <span className="sr-only">Role change</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <TableRow key={user.id} data-pending={users.isFetching ? '' : undefined}>
                    <TableCell className="whitespace-normal">
                      <PersonCell user={user} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <RoleBadges user={user} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <StatusBadges user={user} />
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">{rowAction(user)}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards keep the essentials — role, status and the role action. */}
          <ul aria-busy={users.isFetching} className="flex flex-col gap-sm lg:hidden">
            {rows.map((user) => (
              <li key={user.id}>
                <Card>
                  <CardContent className="flex flex-col gap-md">
                    <PersonCell user={user} />
                    <div className="flex flex-wrap items-center gap-sm">
                      <RoleBadges user={user} />
                      <StatusBadges user={user} />
                    </div>
                    {canManage ? rowAction(user, 'h-control-lg w-full') : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-md text-body-sm text-muted-foreground">
            <span className="tabular-nums">
              {from}–{to} of {total}
            </span>
            <div className="flex gap-2xs">
              <Button
                aria-label="Previous page"
                disabled={!canPreviousPage || users.isFetching}
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                size="icon-sm"
                variant="outline"
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                aria-label="Next page"
                disabled={!canNextPage || users.isFetching}
                onClick={() => setPageIndex((index) => index + 1)}
                size="icon-sm"
                variant="outline"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </>
      )}

      <ChangeRoleDialog
        triggerRef={triggerRef}
        userId={selectedUserId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        viewerId={currentUserId}
      />
    </div>
  );
}

function PersonCell({ user }: { user: AdminUser }) {
  return (
    <div className="flex min-w-none items-center gap-md">
      <UserAvatar className="size-2xl shrink-0" user={user} />
      <div className="min-w-none">
        <div className="font-medium break-words lg:truncate" title={user.name || user.email}>
          {user.name || user.email}
        </div>
        <div
          className="text-caption break-all text-muted-foreground lg:truncate"
          title={user.email}
        >
          {user.email}
        </div>
      </div>
    </div>
  );
}

function RoleBadges({ user }: { user: AdminUser }) {
  const roles = describeRoles(splitRoleValue(user.role));
  if (roles.length === 0) {
    return <span className="text-caption text-muted-foreground">No role</span>;
  }
  return (
    <div className="flex flex-wrap gap-2xs">
      {roles.map((role) => (
        <Badge
          key={role.id}
          className="max-w-full break-all whitespace-normal"
          variant={role.known ? 'secondary' : 'outline'}
        >
          {role.label}
        </Badge>
      ))}
    </div>
  );
}

function StatusBadges({ user }: { user: AdminUser }) {
  const banned = isAccountBanned(user);
  return (
    <div className="flex flex-wrap gap-2xs">
      <Badge variant={banned ? 'destructive' : 'secondary'}>{banned ? 'Banned' : 'Active'}</Badge>
      {user.emailVerified ? null : <Badge variant="outline">Unverified</Badge>}
    </div>
  );
}

function AccessState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-list-max flex-col items-center justify-center gap-md rounded-lg border border-dashed p-2xl text-center">
      <span className="text-muted-foreground [&>svg]:size-2xl">
        <ShieldAlertIcon />
      </span>
      <div className="flex flex-col gap-2xs">
        <h3 className="font-medium">{title}</h3>
        <p className="max-w-form text-body-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
