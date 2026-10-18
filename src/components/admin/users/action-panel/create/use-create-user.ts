'use client';
import {
  getAdditionalFieldDefaultValues,
  getAdditionalFieldSubmitValues,
} from '@better-auth-ui/core';
import { type AdminAuthClient, createAdminUserOptions } from '@better-auth-ui/core/plugins/admin';
import { useAuth, useAuthPlugin, useSession } from '@better-auth-ui/react';
import { useAdminPermission } from '@better-auth-ui/react/plugins/admin';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useEffectEvent } from 'react';

import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { useAuthForm } from '@/components/auth/form/auth-form';
import { asAdminRoles, withInlineErrors } from '@/lib/admin-user-utils';
import { adminPlugin } from '@/lib/auth/admin-plugin';
import type { CreateUserProps } from '@/types/admin-users';
export function useCreateUser({ open, onOpenChange, roles }: CreateUserProps) {
  const auth = useAuth<AdminAuthClient>();
  const config = useAuthPlugin(adminPlugin);
  const { data: session } = useSession(auth.authClient);
  const createUser = useMutation(
    withInlineErrors(createAdminUserOptions(auth.authClient, session?.user.id)),
  );
  const canSetRole = useAdminPermission(auth.authClient, {
    user: ['set-role'],
  });
  const submission = useAdminSubmission();
  const additionalFields = auth.additionalFields ?? [];
  const form = useAuthForm({
    defaultValues: {
      additionalFields: getAdditionalFieldDefaultValues(additionalFields),
      email: '',
      emailVerified: false,
      name: '',
      password: '',
      roles: [config.defaultRole],
    },
    onSubmit: async ({ value }) => {
      await submission.run(
        async () => {
          await createUser.mutateAsync(
            {
              data: {
                ...getAdditionalFieldSubmitValues(additionalFields, value.additionalFields),
                emailVerified: value.emailVerified,
              },
              email: value.email,
              name: value.name,
              password: value.password,
              ...(canSetRole.data?.success ? { role: asAdminRoles(value.roles) } : {}),
            },
            { onSuccess: close },
          );
        },
        () => {
          /* The mutation exposes safe inline errors. */
        },
      );
    },
  });

  const normalizeCreateRoles = useEffectEvent(() => {
    if (!config.allowMultipleRoles) form.setFieldValue('roles', (current) => current.slice(0, 1));
  });
  useEffect(() => normalizeCreateRoles(), [config.allowMultipleRoles]);

  const close = () => {
    form.reset();
    createUser.reset();
    onOpenChange(false);
  };

  const isCreating = createUser.isPending || submission.pending;

  return {
    auth,
    config,
    createUser,
    canSetRole,
    submission,
    additionalFields,
    form,
    close,
    isCreating,
    open,
    onOpenChange,
    roles,
  };
}
