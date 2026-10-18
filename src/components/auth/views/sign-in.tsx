'use client';

import {
  isPasskeyAutoFillEnabled,
  withPasskeyAutoFill,
} from '@better-auth-ui/core/plugins/passkey';
import { AuthPrompts, useAuth } from '@better-auth-ui/react';

import { AuthCaptcha } from '@/components/auth/shared/auth-captcha';
import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { PluginAuthButtons } from '@/components/auth/shared/plugin-auth-buttons';
import { ReauthenticationNotice } from '@/components/auth/shared/reauthentication';
import { FieldGroup } from '@/components/ui/field';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useIsAuthMutating } from '@/hooks/use-is-auth-mutating';
import {
  getPasswordLengthProps,
  validateEmail,
  validatePasswordLength,
} from '@/lib/auth/auth-validation';
import { useSignInForm } from './use-sign-in-form';

export type SignInProps = {
  className?: string;
};

/**
 * Render the email/password sign-in form.
 *
 * @param className - Optional additional container class names
 * @returns The rendered sign-in UI as a JSX element
 */
export function SignIn({ className }: SignInProps) {
  const { emailAndPassword, localization, plugins, Link } = useAuth();
  const authViewPath = useAuthViewPath();
  const { form, isSigningIn } = useSignInForm();
  const isPending = useIsAuthMutating();
  const passkeyAutoFill = isPasskeyAutoFillEnabled(plugins);

  const footer = emailAndPassword?.enabled && (
    <>
      {emailAndPassword.forgotPassword && (
        <Link
          href={authViewPath('forgotPassword')}
          className="self-center text-body-sm underline-offset-4 hover:underline"
        >
          {localization.auth.forgotPasswordLink}
        </Link>
      )}

      <AuthFooterLink
        prompt={localization.auth.needToCreateAnAccount}
        label={localization.auth.signUp}
        href={authViewPath('signUp')}
      />
    </>
  );

  return (
    <AuthCard
      className={className}
      title={localization.auth.signIn}
      header={
        <>
          <AuthPrompts view="signIn" />
          <ReauthenticationNotice />
        </>
      }
      footer={footer}
    >
      {emailAndPassword?.enabled && (
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
                    autoComplete={withPasskeyAutoFill('email', passkeyAutoFill)}
                    placeholder={localization.auth.emailPlaceholder}
                    required
                    disabled={isPending}
                  />
                )}
              </form.AppField>

              <form.AppField
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    validatePasswordLength(value, emailAndPassword, localization.auth),
                }}
              >
                {(field) => (
                  <field.AuthFormPasswordField
                    label={localization.auth.password}
                    autoComplete={withPasskeyAutoFill('current-password', passkeyAutoFill)}
                    placeholder={localization.auth.passwordPlaceholder}
                    required
                    {...getPasswordLengthProps(emailAndPassword)}
                    disabled={isPending}
                  />
                )}
              </form.AppField>

              {emailAndPassword.rememberMe && (
                <form.AppField name="rememberMe">
                  {(field) => (
                    <field.AuthFormCheckboxField
                      label={localization.auth.rememberMe}
                      disabled={isPending}
                    />
                  )}
                </form.AppField>
              )}

              <AuthCaptcha />

              <div className="flex flex-col gap-md">
                <form.AuthFormServerError />
                <form.AuthFormSubmitButton isPending={isSigningIn} disabled={isPending}>
                  {localization.auth.signIn}
                </form.AuthFormSubmitButton>

                <PluginAuthButtons view="signIn" />
              </div>
            </FieldGroup>
          </form.AuthFormRoot>
        </form.AppForm>
      )}
    </AuthCard>
  );
}
