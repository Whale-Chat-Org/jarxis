'use client';
import { useId } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';

import type { ProviderManagementState } from '../../use-provider-management';
import { ProviderConnectionForm } from './provider-connection-form';
export function ProviderConnectionEditor({ flow }: { flow: ProviderManagementState }) {
  const {
    editor,
    editorMode,
    busy,
    busyRef,
    closeEditor,
    shownDialogError,
    canManage,
    setEditorMode,
  } = flow;
  const formId = useId();
  return (
    <AdminActionPanel
      open={editor !== null}
      onOpenChange={(value) => {
        if (!value) closeEditor();
      }}
      header={{
        title:
          editorMode === 'view'
            ? 'Connection details'
            : editor?.id
              ? 'Edit connection'
              : 'Add connection',
        description: 'Connect a provider using an API key.',
      }}
      state={{ pending: busy, pendingRef: busyRef, error: shownDialogError }}
      actions={[
        {
          id: 'cancel',
          label: editorMode === 'view' ? 'Close' : 'Cancel',
          variant: 'outline',
          onClick: closeEditor,
        },
        ...(editorMode === 'view'
          ? canManage
            ? [{ id: 'edit', label: 'Edit connection', onClick: () => setEditorMode('edit') }]
            : []
          : [{ id: 'save', label: 'Save connection', type: 'submit' as const, formId }]),
      ]}
    >
      <ProviderConnectionForm flow={flow} formId={formId} />
    </AdminActionPanel>
  );
}
