'use client';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAdminRecordDraft } from '@/components/admin/use-admin-record-draft';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { rolesResponseSchema, type RoleView } from '@/lib/admin-contracts';
import { apiAction, apiRequest } from '@/lib/api-client';
import type { Draft, RolesManagerProps } from '@/types/admin-roles';
const areaName: Record<string, string> = {
  dashboard: 'Dashboard',
  user: 'Users',
  users: 'Users',
  roles: 'Roles',
  permissions: 'Roles',
  audit: 'Audit',
  providers: 'Providers',
  session: 'Sessions',
};

export function useRolesManagement({ initialRoles, catalog, canManage }: RolesManagerProps) {
  const [roles, setRoles] = useState(initialRoles);
  const { draft, setDraft, initialize: initializeDraft } = useAdminRecordDraft<Draft | null>(null);
  const submission = useAdminSubmission();
  const saving = submission.pending;
  const [error, setError] = useState('');
  const [deleteRole, setDeleteRole] = useState<RoleView | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const restricted = (key: string) => catalog.find((entry) => entry.key === key)?.restricted;
  const refresh = async () => {
    const data = await apiRequest('/api/admin/roles', rolesResponseSchema);
    setRoles(data.roles);
  };
  /** Opens the side panel: edit an editable role, view any other, or start a new one. */
  const open = (role?: RoleView, duplicate = false) => {
    setError('');
    const readOnly = Boolean(role && !duplicate && !(canManage && role.editable));
    initializeDraft({
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
    if (!draft || draft.readOnly || draft.name.trim().length < 2) return;
    setError('');
    await submission.run(
      async () => {
        await apiAction(
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
        await refresh();
        setDraft(null);
        toast.success('Role saved');
      },
      (cause) => setError(safeActionErrorMessage(cause, 'Could not save role')),
    );
  };
  const remove = async (role: RoleView) => {
    setDeleteError('');
    await submission.run(
      async () => {
        await apiAction(`/api/admin/roles/${encodeURIComponent(role.key)}`, { method: 'DELETE' });
        await refresh();
        if (draft?.key === role.key) setDraft(null);
        setDeleteRole(null);
        toast.success('Role deleted');
      },
      (cause) => setDeleteError(safeActionErrorMessage(cause, 'Could not delete role')),
    );
  };

  const areas = Object.entries(
    Object.groupBy(catalog, (entry) => areaName[entry.key.split(':')[0]] ?? 'Other'),
  );
  return {
    roles,
    draft,
    setDraft,
    initializeDraft,
    submission,
    saving,
    error,
    deleteRole,
    setDeleteRole,
    deleteError,
    open,
    save,
    remove,
    areas,
    canManage,
  };
}
