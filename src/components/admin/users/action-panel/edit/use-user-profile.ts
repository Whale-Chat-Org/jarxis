'use client';
import {
  fieldsWithModelValues,
  getAdditionalFieldDefaultValues,
  getAdditionalFieldSubmitValues,
} from '@better-auth-ui/core';
import {
  setAdminUserRoleOptions,
  updateAdminUserOptions,
} from '@better-auth-ui/core/plugins/admin';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';

import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { useAuthForm } from '@/components/auth/auth-form';
import { asAdminRoles, parseAdminRoles, sameRoles, withInlineErrors } from '@/lib/admin-user-utils';
import type { UserInspectorData, UserInspectorProps } from '@/types/admin-users';
export function useUserProfile(
  data: Pick<
    UserInspectorData,
    'auth' | 'config' | 'user' | 'actor' | 'canUpdate' | 'canSetEmail' | 'canSetRole' | 'isSelf'
  >,
  { open, onOpenChange }: Pick<UserInspectorProps, 'open' | 'onOpenChange'>,
) {
  const { auth, config, user, actor, canUpdate, canSetEmail, canSetRole, isSelf } = data;
  const [recordMode, setRecordMode] = useState<'view' | 'edit'>('edit');
  const profileSubmission = useAdminSubmission();
  const profileInFlight = profileSubmission.pendingRef;

  const updateUser = useMutation(
    withInlineErrors(updateAdminUserOptions(auth.authClient, actor?.user.id)),
  );

  const resetUserMutation = useEffectEvent(() => updateUser.reset());
  useEffect(() => {
    if (user?.id) resetUserMutation();
  }, [user?.id]);

  useEffect(() => {
    if (!open) resetUserMutation();
  }, [open]);

  const setRoleMutation = useMutation(
    withInlineErrors(setAdminUserRoleOptions(auth.authClient, actor?.user.id)),
  );
  const configuredUserFields = useMemo(
    () =>
      fieldsWithModelValues(
        auth.additionalFields ?? [],
        user ? (user as unknown as Record<string, unknown>) : {},
      ),
    [auth.additionalFields, user],
  );
  const profileForm = useAuthForm({
    defaultValues: {
      additionalFields: getAdditionalFieldDefaultValues(configuredUserFields),
      // Keep hook defaults aligned with reset values: later permission/query renders
      // otherwise replace an untouched profile with the empty initial defaults.
      email: user?.email ?? '',
      emailVerified: user?.emailVerified ?? false,
      name: user?.name ?? '',
      roles: parseAdminRoles(user?.role, config.defaultRole, config.allowMultipleRoles),
    },
    onSubmit: async ({ value }) => {
      if (!user || recordMode === 'view') return;
      await profileSubmission.run(
        async () => {
          const mutations: Promise<unknown>[] = [];
          if (canUpdate.data?.success) {
            mutations.push(
              updateUser.mutateAsync({
                userId: user.id,
                data: {
                  ...getAdditionalFieldSubmitValues(configuredUserFields, value.additionalFields),
                  name: value.name.trim(),
                  ...(canSetEmail.data?.success
                    ? {
                        email: value.email.trim(),
                        emailVerified: value.emailVerified,
                      }
                    : {}),
                },
              }),
            );
          }
          // An untouched role is not re-sent: the single-role control holds only the first stored
          // role, so re-sending it would drop the others and audit a role change that never happened.
          const rolesChanged = !sameRoles(
            value.roles,
            parseAdminRoles(user.role, config.defaultRole, config.allowMultipleRoles),
          );
          if (canSetRole.data?.success && !isSelf && rolesChanged) {
            mutations.push(
              setRoleMutation.mutateAsync({
                userId: user.id,
                role: asAdminRoles(value.roles),
              }),
            );
          }

          await Promise.all(mutations);
          onOpenChange(false);
        },
        () => {
          /* Each mutation exposes its safe inline error beside the form. */
        },
      );
    },
  });

  const resetProfile = useEffectEvent(() => {
    profileForm.reset({
      additionalFields: getAdditionalFieldDefaultValues(configuredUserFields),
      email: user?.email ?? '',
      emailVerified: user?.emailVerified ?? false,
      name: user?.name ?? '',
      roles: parseAdminRoles(user?.role, config.defaultRole, config.allowMultipleRoles),
    });
  });
  useEffect(() => {
    resetProfile();
  }, [open, user?.id, config.allowMultipleRoles]);

  const isSavingProfile = updateUser.isPending || setRoleMutation.isPending;
  return {
    recordMode,
    setRecordMode,
    profileInFlight,
    profileForm,
    configuredUserFields,
    updateUser,
    setRoleMutation,
    isSavingProfile,
  };
}
