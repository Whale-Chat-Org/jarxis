'use client';
import { z } from 'zod';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { request } from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
export function ProviderDeleteConfirmation({ flow }: { flow: ProviderManagementState }) {
  const { confirmation, busy, busyRef, setConfirmation, shownDialogError, perform, reload } = flow;
  return (
    <AdminActionPanel
      open={confirmation !== null}
      onOpenChange={(value) => {
        if (!value) setConfirmation(null);
      }}
      header={{
        title: 'Delete connection?',
        description: <>{confirmation?.name}: This removes the account and all its models.</>,
      }}
      state={{ pending: busy, pendingRef: busyRef, error: shownDialogError }}
      actions={[
        { id: 'cancel', label: 'Cancel', variant: 'outline', onClick: () => setConfirmation(null) },
        {
          id: 'confirm',
          label: 'Confirm',
          variant: 'destructive',
          onClick: () => {
            if (confirmation)
              void perform(async () => {
                await request(z.unknown(), `/${confirmation.id}`, 'DELETE');
                setConfirmation(null);
                await reload();
              });
          },
        },
      ]}
    />
  );
}
