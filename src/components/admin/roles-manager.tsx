'use client';

import { useState } from 'react';
import { CopyIcon, EllipsisIcon, PencilIcon, Trash2Icon, EyeIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogScrollArea,
  DialogTitle,
} from '@/components/ui/admin-panel';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

export type RoleView = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  /** Owners may change it: custom roles, Viewer and Administrator. Owner and User are locked. */
  editable: boolean;
  /** Users holding the role; a custom role in use cannot be deleted. */
  userCount: number;
};
type CatalogEntry = { key: string; description: string; restricted: boolean };
type Draft = {
  key?: string;
  system: boolean;
  readOnly: boolean;
  name: string;
  description: string;
  permissions: string[];
};
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
  const [deleteError, setDeleteError] = useState('');

  const restricted = (key: string) => catalog.find((entry) => entry.key === key)?.restricted;
  const refresh = async () => {
    const response = await fetch('/api/admin/roles', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not refresh roles');
    const data = (await response.json()) as { roles: RoleView[] };
    setRoles(data.roles);
  };
  /** Opens the side panel: edit an editable role, view any other, or start a new one. */
  const open = (role?: RoleView, duplicate = false) => {
    setError('');
    const readOnly = Boolean(role && !duplicate && !(canManage && role.editable));
    setDraft({
      key: duplicate ? undefined : role?.key,
      system: !duplicate && Boolean(role?.system),
      readOnly,
      name: duplicate ? `${role?.name ?? ''} copy` : (role?.name ?? ''),
      description: role?.description ?? '',
      // A locked role is shown with every grant it holds; an editable copy drops owner-only ones.
      permissions: readOnly
        ? (role?.permissions ?? [])
        : (role?.permissions.filter((key) => !restricted(key)) ?? []),
    });
  };
  const save = async () => {
    if (!draft || draft.readOnly || saving || draft.name.trim().length < 2) return;
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
    setDeleteError('');
    try {
      const response = await fetch(`/api/admin/roles/${encodeURIComponent(role.key)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Could not delete role');
      }
      await refresh();
      if (draft?.key === role.key) setDraft(null);
      toast.success('Role deleted');
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete role');
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
            Owner and User are locked. Changes to other roles apply on the next request.
          </p>
        </div>
        {canManage && <Button onClick={() => open()}>Create role</Button>}
      </div>
      {deleteError && (
        <p role="alert" className="text-body-sm text-destructive">
          {deleteError}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Permissions</TableHead>
              <TableHead className="hidden md:table-cell">Users</TableHead>
              <TableHead className="w-col-actions">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => {
              const canEdit = canManage && role.editable;
              const canDelete = canManage && !role.system;
              return (
                <TableRow
                  key={role.key}
                  aria-selected={draft?.key === role.key}
                  className="cursor-pointer"
                  onClick={() => open(role)}
                >
                  <TableCell className="whitespace-normal">
                    <Button
                      className="h-auto min-w-none justify-start p-none font-medium"
                      variant="link"
                      onClick={(event) => {
                        event.stopPropagation();
                        open(role);
                      }}
                    >
                      {role.name}
                    </Button>
                    <div className="line-clamp-2 text-caption text-muted-foreground">
                      {role.description}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={role.system ? 'outline' : 'secondary'}>
                      {role.system ? (role.editable ? 'System' : 'Locked') : 'Custom'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                    {role.permissions.length}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                    {role.userCount}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={`Actions for ${role.name}`}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <EllipsisIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => open(role)}>
                          {canEdit ? <PencilIcon /> : <EyeIcon />}
                          {canEdit ? 'Edit' : 'View'}
                        </DropdownMenuItem>
                        {canManage && (
                          <DropdownMenuItem onSelect={() => open(role, true)}>
                            <CopyIcon />
                            Duplicate
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={role.userCount > 0}
                              onSelect={() => setDeleteRole(role)}
                            >
                              <Trash2Icon />
                              {role.userCount > 0
                                ? `Delete (move ${userLabel(role.userCount)} first)`
                                : 'Delete'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Dialog open={draft !== null} onOpenChange={(value) => !value && !saving && setDraft(null)}>
        <DialogContent
          layout="inspector"
          onEscapeKeyDown={(event) => saving && event.preventDefault()}
          onInteractOutside={(event) => saving && event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {draft?.readOnly ? draft.name : draft?.key ? 'Edit role' : 'Create role'}
            </DialogTitle>
            <DialogDescription>
              {draft?.readOnly
                ? 'This role is locked. Duplicate it to create an editable copy.'
                : 'Choose the access granted by this role.'}
            </DialogDescription>
          </DialogHeader>
          <DialogForm
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <DialogScrollArea className="p-xl">
              {draft && (
                <div className="flex flex-col gap-lg">
                  <Field>
                    <FieldLabel htmlFor="role-name">Name</FieldLabel>
                    <Input
                      id="role-name"
                      value={draft.name}
                      disabled={draft.readOnly || draft.system}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      maxLength={64}
                    />
                    {draft.system && !draft.readOnly && (
                      <FieldDescription>System roles keep their name.</FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="role-description">Description</FieldLabel>
                    <Textarea
                      id="role-description"
                      value={draft.description}
                      disabled={draft.readOnly}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      maxLength={500}
                    />
                  </Field>
                  {areas.map(([area, entries]) => (
                    <FieldSet key={area} className="gap-sm">
                      <FieldLegend variant="label">{area}</FieldLegend>
                      {entries?.map((entry) => (
                        <Field key={entry.key} orientation="horizontal">
                          <Checkbox
                            id={`grant-${entry.key}`}
                            checked={draft.permissions.includes(entry.key)}
                            disabled={draft.readOnly || entry.restricted}
                            onCheckedChange={(checked) =>
                              setDraft({
                                ...draft,
                                permissions: checked
                                  ? [...draft.permissions, entry.key]
                                  : draft.permissions.filter((key) => key !== entry.key),
                              })
                            }
                          />
                          <FieldLabel htmlFor={`grant-${entry.key}`} className="flex-wrap">
                            {entry.description}{' '}
                            <span className="text-caption font-normal text-muted-foreground">
                              ({entry.key}
                              {entry.restricted ? ' · Owner only' : ''})
                            </span>
                          </FieldLabel>
                        </Field>
                      ))}
                    </FieldSet>
                  ))}
                  {error && (
                    <p role="alert" className="text-body-sm text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </DialogScrollArea>
            <DialogFooter showCloseButton={draft?.readOnly}>
              {!draft?.readOnly && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDraft(null)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving || (draft !== null && draft.name.trim().length < 2)}
                  >
                    {saving ? 'Saving…' : 'Save role'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogForm>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteRole !== null}
        onOpenChange={(value) => !value && !saving && setDeleteRole(null)}
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
