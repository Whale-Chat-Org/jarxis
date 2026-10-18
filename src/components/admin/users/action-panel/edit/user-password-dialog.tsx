'use client';
import {
  type AdminAuthClient,
  setAdminUserPasswordOptions,
} from '@better-auth-ui/core/plugins/admin';
import { useAuth, useAuthPlugin } from '@better-auth-ui/react';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import { getAdminErrorMessage, withInlineErrors } from '@/lib/admin-user-utils';
import { adminPlugin } from '@/lib/auth/admin-plugin';
export function PasswordDialog({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
}) {
  const formId = useId();
  const passwordSubmission = useAdminSubmission();
  const auth = useAuth<AdminAuthClient>();
  const config = useAuthPlugin(adminPlugin);
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const mutation = useMutation(
    withInlineErrors(
      setAdminUserPasswordOptions(auth.authClient, () => {
        setTimeout(() => mutation.reset(), 0);
      }),
    ),
  );
  const close = () => {
    setPassword('');
    setErrorMessage(undefined);
    mutation.reset();
    onOpenChange(false);
  };
  const isSaving = mutation.isPending || passwordSubmission.pending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(undefined);
    if (userId)
      void passwordSubmission.run(
        async () => {
          await mutation.mutateAsync({ userId, newPassword: password });
          close();
        },
        (error) => setErrorMessage(getAdminErrorMessage(error)),
      );
  };
  return (
    <AdminActionPanel
      open={open}
      onOpenChange={(value) => (value ? onOpenChange(true) : close())}
      header={{
        title: config.localization.setPassword,
        description: config.localization.userDetails,
      }}
      state={{ pending: isSaving, pendingRef: passwordSubmission.pendingRef, error: errorMessage }}
      actions={[
        { id: 'cancel', label: config.localization.cancel, variant: 'outline', onClick: close },
        {
          id: 'save',
          label: config.localization.setPassword,
          type: 'submit',
          formId,
          disabled: !password,
        },
      ]}
    >
      <form id={formId} onSubmit={submit}>
        {' '}
        <Field data-invalid={Boolean(errorMessage)}>
          <FieldLabel htmlFor="admin-new-password">{config.localization.password}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              aria-invalid={Boolean(errorMessage)}
              autoComplete="new-password"
              id="admin-new-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </InputGroup>
        </Field>
      </form>
    </AdminActionPanel>
  );
}
