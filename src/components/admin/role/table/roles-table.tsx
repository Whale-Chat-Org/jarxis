'use client';
import { CopyIcon, EllipsisIcon, EyeIcon, PencilIcon, Trash2Icon } from 'lucide-react';

import { AdminDataTable } from '@/components/admin/table/data-table';
import { adminTableDefinitions } from '@/components/admin/table/table-definitions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RolesManagementState } from '@/types/admin-roles';
const userLabel = (count: number) => `${count} user${count === 1 ? '' : 's'}`;
export function RolesTable({ state }: { state: RolesManagementState }) {
  const { roles, draft, open, canManage, setDraft, setDeleteRole } = state;
  return (
    <AdminDataTable
      definition={adminTableDefinitions.roles}
      rows={roles}
      rowProps={(role) => ({
        'aria-selected': draft?.key === role.key,
        className: 'cursor-pointer',
        onClick: () => open(role),
      })}
      cells={{
        name: (role) => {
          return (
            <div>
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
            </div>
          );
        },
        type: (role) => {
          return (
            <div>
              <Badge variant={role.system ? 'outline' : 'secondary'}>
                {role.system ? (role.editable ? 'System' : 'Locked') : 'Custom'}
              </Badge>
            </div>
          );
        },
        permissions: (role) => {
          return <div>{role.permissions.length}</div>;
        },
        users: (role) => {
          return <div>{role.userCount}</div>;
        },
        actions: (role) => {
          const canEdit = canManage && role.editable;
          const canDelete = canManage && !role.system;
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={`Actions for ${role.name}`} size="icon-sm" variant="ghost">
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem
                      onSelect={() => {
                        open(role);
                        setDraft((current) => current && { ...current, readOnly: true });
                      }}
                    >
                      <EyeIcon />
                      View
                    </DropdownMenuItem>
                  )}
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
            </div>
          );
        },
      }}
    />
  );
}
