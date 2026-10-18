'use client';

import { getViewURL } from '@better-auth-ui/core';
import { useAuth, useFetchOptions, useRequestPasswordReset } from '@better-auth-ui/react';

import { useAuthForm } from '@/components/auth/form/auth-form';
import { AuthCaptcha } from '@/components/auth/shared/auth-captcha';
import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { FieldGroup } from '@/components/ui/field';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { RESET_LINK_SENT_STORAGE_KEY } from '@/lib/auth/auth-storage';
import { validateEmail } from '@/lib/auth/auth-validation';

export type ForgotPasswordProps = {
  className?: string;
};

/**
 * Render a card-based "Forgot Password" form that sends a password-reset email.
 *
 * After a successful request the submitted email is stored in `sessionStorage`
 * and the user is redirected to the reset-link-sent view, which offers to open
 * their email provider.
 *
 * @param className - Optional additional CSS class names applied to the card
 * @returns The forgot-password form UI as a JSX element
 */
export function ForgotPassword({ className }: ForgotPasswordProps) {
  const { authClient, baseURL, basePaths, localization, navigate, viewPaths } = useAuth();
  const authViewPath = useAuthViewPath();
  const { fetchOptions, resetFetchOptions } = useFetchOptions();

  const { mutateAsync: requestPasswordReset, isPending } = useRequestPasswordReset(authClient, {
    onError: () => {
      resetFetchOptions();
    },
    onSuccess: (_data, { email }) => {
      sessionStorage.setItem(RESET_LINK_SENT_STORAGE_KEY, email);
      navigate({ to: authViewPath('resetLinkSent') });
    },
  });

  const form = useAuthForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) =>
      await requestPasswordReset({
        email: value.email,
        redirectTo: getViewURL(baseURL, basePaths.auth, viewPaths.auth.resetPassword),
        fetchOptions,
      }),
  });

  return (
    <AuthCard
      className={className}
      title={localization.auth.forgotPassword}
      footer={
        <AuthFooterLink
          prompt={localization.auth.rememberYourPassword}
          label={localization.auth.signIn}
          href={authViewPath('signIn')}
        />
      }
    >
      <form.AppForm>
        <form.AuthFormRoot>
          <FieldGroup>
            <form.AppField
              name="email"
              validators={{ onChange: ({ value }) => validateEmail(value, localization.auth) }}
            >
              {(field) => (
                <field.AuthFormTextField
                  label={localization.auth.email}
                  type="email"
                  autoComplete="email"
                  placeholder={localization.auth.emailPlaceholder}
                  required
                  disabled={isPending}
                />
              )}
            </form.AppField>

            <AuthCaptcha />

            <div className="flex flex-col gap-md">
              <form.AuthFormSubmitButton isPending={isPending} disabled={isPending}>
                {localization.auth.sendResetLink}
              </form.AuthFormSubmitButton>
            </div>
          </FieldGroup>
        </form.AuthFormRoot>
      </form.AppForm>
    </AuthCard>
  );
}
