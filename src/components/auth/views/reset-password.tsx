'use client';

import { getAuthLinkURL } from '@better-auth-ui/core';
import { useAuth, useResetPassword } from '@better-auth-ui/react';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';

import { useAuthForm } from '@/components/auth/form/auth-form';
import { NewPasswordFields } from '@/components/auth/form/new-password-fields';
import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { FieldGroup } from '@/components/ui/field';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useCompromisedPassword } from '@/hooks/use-compromised-password';
import { inlineFormErrors } from '@/lib/api-client';

export type ResetPasswordProps = {
  className?: string;
};

function getResetToken() {
  return new URLSearchParams(window.location.search).get('token');
}

/**
 * Render a password reset form for the `token` in the URL. A missing token
 * shows an error toast and returns to sign-in, both on mount and on submit.
 *
 * @returns The password reset form UI ready to be mounted in the app layout.
 */
export function ResetPassword({ className }: ResetPasswordProps) {
  const { authClient, localization, navigate, redirectTo } = useAuth();
  const authViewPath = useAuthViewPath();
  const signInURL = getAuthLinkURL(authViewPath('signIn'), redirectTo);
  const compromised = useCompromisedPassword();

  const { mutateAsync: resetPassword, isPending } = useResetPassword(authClient, {
    ...inlineFormErrors,
    onError: compromised.flag,
    onSuccess: () => {
      toast.success(localization.auth.passwordResetSuccess);
      navigate({ to: signInURL });
    },
  });

  const rejectMissingToken = useCallback(() => {
    toast.error(localization.auth.invalidResetPasswordToken);
    navigate({ to: signInURL });
  }, [localization.auth.invalidResetPasswordToken, navigate, signInURL]);

  useEffect(() => {
    if (!getResetToken()) rejectMissingToken();
  }, [rejectMissingToken]);

  const form = useAuthForm({
    defaultValues: { confirmPassword: '', password: '' },
    onSubmit: async ({ value }) => {
      const token = getResetToken();
      if (!token) return rejectMissingToken();

      await resetPassword({ token, newPassword: value.password });
    },
  });

  return (
    <AuthCard
      className={className}
      title={localization.auth.resetPassword}
      footer={
        <AuthFooterLink
          prompt={localization.auth.rememberYourPassword}
          label={localization.auth.signIn}
          href={signInURL}
        />
      }
    >
      <form.AppForm>
        <form.AuthFormRoot>
          <FieldGroup>
            <NewPasswordFields
              form={form}
              fields={{ password: 'password', confirmPassword: 'confirmPassword' }}
              label={localization.auth.password}
              placeholder={localization.auth.newPasswordPlaceholder}
              disabled={isPending}
              isCompromised={compromised.isCompromised}
              onPasswordChange={compromised.clear}
            />

            <div className="flex flex-col gap-md">
              <form.AuthFormServerError />
              <form.AuthFormSubmitButton disabled={isPending}>
                {localization.auth.resetPassword}
              </form.AuthFormSubmitButton>
            </div>
          </FieldGroup>
        </form.AuthFormRoot>
      </form.AppForm>
    </AuthCard>
  );
}
