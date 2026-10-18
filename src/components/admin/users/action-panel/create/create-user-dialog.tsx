'use client';
import { useId } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { useCreateUser } from '@/components/admin/users/action-panel/create/use-create-user';
import { getAdminErrorMessage } from '@/lib/admin-user-utils';
import type { CreateUserProps } from '@/types/admin-users';

import { CreateUserForm } from './create-user-form';
export function CreateUserDialog(props: CreateUserProps) {
  const state = useCreateUser(props);
  const { form, config, isCreating, submission, open, onOpenChange, close, createUser } = state;
  const formId = useId();
  return (
    <form.AppForm>
      <form.Subscribe selector={(value) => [value.canSubmit, value.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <AdminActionPanel
            open={open}
            onOpenChange={(value) => (value ? onOpenChange(true) : close())}
            header={{
              title: config.localization.createUser,
              description: config.localization.usersDescription,
            }}
            state={{
              pending: isCreating || isSubmitting,
              pendingRef: submission.pendingRef,
              error: getAdminErrorMessage(createUser.error),
            }}
            actions={[
              {
                id: 'cancel',
                label: config.localization.cancel,
                variant: 'outline',
                onClick: close,
              },
              {
                id: 'create',
                label: config.localization.createUser,
                type: 'submit',
                formId,
                disabled: !canSubmit,
              },
            ]}
          >
            <CreateUserForm state={state} formId={formId} />
          </AdminActionPanel>
        )}
      </form.Subscribe>
    </form.AppForm>
  );
}
