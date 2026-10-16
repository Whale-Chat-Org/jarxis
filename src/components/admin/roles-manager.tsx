'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type RoleView = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  /** Custom roles only: how many users have the role, which blocks deleting it. */
  userCount?: number;
};
type CatalogEntry = { key: string; description: string; restricted: boolean };
type Draft = { key?: string; name: string; description: string; permissions: string[] };
const areaName: Record<string, string> = {
  dashboard: 'Dashboard',
  user: 'Users',
  users: 'Users',
  roles: 'Roles',
  permissions: 'Roles',
  audit: 'Audit',
  providers: 'ML providers',
  session: 'Sessions',
};

const userLabel = (count: number) => `${count} user${count === 1 ? '' : 's'}`;

export function RolesManager({
  initialRoles,
  catalog,
  canManage,
}: {
  initialRoles: RoleView[];
  catalog: CatalogEntry[];
  canManage: boolean;
}) {
  const [roles, setRoles] = useState(initialRoles);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteRole, setDeleteRole] = useState<RoleView | null>(null);
  const [deleteError, setDeleteError] = useState<{ key: string; message: string } | null>(null);

  const refresh = async () => {
    const response = await fetch('/api/admin/roles', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh roles');
    const data = (await response.json()) as { roles: RoleView[] };
    setRoles(data.roles);
  };
  const edit = (role?: RoleView, duplicate = false) => {
    setError('');
    setDraft({
      key: duplicate ? undefined : role?.key,
      name: duplicate ? `${role?.name ?? ''} copy` : (role?.name ?? ''),
      description: role?.description ?? '',
      permissions:
        role?.permissions.filter(
          (key) => !catalog.find((entry) => entry.key === key)?.restricted,
        ) ?? [],
    });
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        draft.key ? `/api/admin/roles/${encodeURIComponent(draft.key)}` : '/api/admin/roles',
        {
          method: draft.key ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: draft.name,
            description: draft.description,
            permissions: draft.permissions,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json()) as {
          error?: { message?: string; issues?: { message: string }[] };
        };
        throw new Error(
          data.error?.issues?.[0]?.message ?? data.error?.message ?? 'Could not save role',
        );
      }
      await refresh();
      setDraft(null);
      toast.success('Role saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save role');
    } finally {
      setSaving(false);
    }
  };
  const remove = async (role: RoleView) => {
    setSaving(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/roles/${encodeURIComponent(role.key)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Could not delete role');
      }
      await refresh();
      toast.success('Role deleted');
    } catch (cause) {
      setDeleteError({
        key: role.key,
        message: cause instanceof Error ? cause.message : 'Could not delete role',
      });
    } finally {
      setDeleteRole(null);
      setSaving(false);
    }
  };

  const areas = Object.entries(
    Object.groupBy(catalog, (entry) => areaName[entry.key.split(':')[0]] ?? 'Other'),
  );
  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h2 className="text-heading font-semibold">Roles</h2>
          <p className="text-body-sm text-muted-foreground">
            System roles are locked. Custom roles apply on the next request.
          </p>
        </div>
        {canManage && <Button onClick={() => edit()}>Create role</Button>}
      </div>
      <div className="grid gap-lg lg:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.key}>
            <CardHeader>
              <CardTitle className="text-title">{role.name}</CardTitle>
              <CardDescription>{role.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-md">
              <p className="text-body-sm text-muted-foreground">
                {role.permissions.length} permissions ·{' '}
                {role.system ? 'Locked system role' : 'Custom role'}
                {!role.system && ` · ${userLabel(role.userCount ?? 0)}`}
              </p>
              {role.permissions.length > 0 && (
                <ul className="flex flex-wrap gap-xs" aria-label={`${role.name} permissions`}>
                  {role.permissions.map((key) => (
                    <li
                      key={key}
                      className="rounded-sm bg-muted px-sm py-2xs text-caption"
                      title={catalog.find((entry) => entry.key === key)?.description}
                    >
                      {key}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-sm">
                {canManage && (
                  <Button variant="outline" onClick={() => edit(role, true)}>
                    Duplicate
                  </Button>
                )}
                {canManage && !role.system && (
                  <Button variant="outline" onClick={() => edit(role)}>
                    Edit
                  </Button>
                )}
                {canManage && !role.system && (
                  <Button
                    variant="destructive"
                    disabled={Boolean(role.userCount)}
                    aria-describedby={role.userCount ? `role-in-use-${role.key}` : undefined}
                    onClick={() => setDeleteRole(role)}
                  >
                    Delete
                  </Button>
                )}
              </div>
              {canManage && Boolean(role.userCount) && (
                <p id={`role-in-use-${role.key}`} className="text-body-sm text-muted-foreground">
                  Move {userLabel(role.userCount ?? 0)} to another role before deleting it.
                </p>
              )}
              {deleteError?.key === role.key && (
                <p role="alert" className="text-body-sm text-destructive">
                  {deleteError.message}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={draft !== null} onOpenChange={(open) => !open && !saving && setDraft(null)}>
        <DialogContent className="max-h-svh overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.key ? 'Edit role' : 'Create role'}</DialogTitle>
            <DialogDescription>Choose the access granted by this role.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-lg">
              <Field>
                <FieldLabel htmlFor="role-name">Name</FieldLabel>
                <Input
                  id="role-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  maxLength={64}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="role-description">Description</FieldLabel>
                <Textarea
                  id="role-description"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  maxLength={500}
                />
              </Field>
              <div className="flex flex-col gap-lg">
                {areas.map(([area, entries]) => (
                  <fieldset key={area} className="flex flex-col gap-sm">
                    <legend className="font-medium">{area}</legend>
                    {entries?.map((entry) => (
                      <Field key={entry.key} orientation="horizontal">
                        <Checkbox
                          id={`grant-${entry.key}`}
                          checked={draft.permissions.includes(entry.key)}
                          disabled={entry.restricted}
                          onCheckedChange={(checked) =>
                            setDraft({
                              ...draft,
                              permissions: checked
                                ? [...draft.permissions, entry.key]
                                : draft.permissions.filter((key) => key !== entry.key),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`grant-${entry.key}`}>
                          {entry.description}{' '}
                          <span className="text-caption text-muted-foreground">
                            ({entry.key}
                            {entry.restricted ? ' · Owner only' : ''})
                          </span>
                        </FieldLabel>
                      </Field>
                    ))}
                  </fieldset>
                ))}
              </div>
              {error && (
                <p role="alert" className="text-body-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || !draft?.name.trim()}>
              {saving ? 'Saving…' : 'Save role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteRole !== null}
        onOpenChange={(open) => !open && !saving && setDeleteRole(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {deleteRole?.name}? Users assigned to it must be moved first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                if (deleteRole) void remove(deleteRole);
              }}
            >
              {saving ? 'Deleting…' : 'Delete role'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
