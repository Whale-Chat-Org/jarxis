'use client';
import { useId } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import type { AdminPanelAction } from '@/types/admin-action-panel';
import type { RolesManagementState } from '@/types/admin-roles';

import { RoleForm } from '../edit/role-form';
export function RoleActionPanel({ state }: { state: RolesManagementState }) {
  const { draft, saving, submission, setDraft, canManage, initializeDraft, error } = state;
  const formId = useId();
  const close = () => setDraft(null);
  const actions: AdminPanelAction[] = draft?.readOnly
    ? [
        ...(canManage && draft.key && !['owner', 'user'].includes(draft.key)
          ? [
              {
                id: 'edit',
                label: 'Edit role',
                onClick: () => initializeDraft({ ...draft, readOnly: false }),
              },
            ]
          : []),
        { id: 'close', label: 'Close', variant: 'outline', onClick: close },
      ]
    : [
        { id: 'cancel', label: 'Cancel', variant: 'outline', onClick: close },
        {
          id: 'save',
          label: 'Save role',
          pendingLabel: 'Saving…',
          type: 'submit',
          formId,
          disabled: draft !== null && draft.name.trim().length < 2,
        },
      ];
  return (
    <AdminActionPanel
      open={draft !== null}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      header={{
        title: draft?.readOnly ? draft.name : draft?.key ? 'Edit role' : 'Create role',
        description: draft?.readOnly
          ? draft.key && ['owner', 'user'].includes(draft.key)
            ? 'This role is locked. Duplicate it to create an editable copy.'
            : 'Role details. Editing requires owner access.'
          : 'Choose the access granted by this role.',
      }}
      state={{ pending: saving, pendingRef: submission.pendingRef, error }}
      actions={actions}
    >
      <RoleForm state={state} formId={formId} />
    </AdminActionPanel>
  );
}
