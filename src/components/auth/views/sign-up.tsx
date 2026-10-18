'use client';

import { getAuthLinkURL, validateStringLength } from '@better-auth-ui/core';
import { AuthPrompts, useAuth } from '@better-auth-ui/react';

import { NewPasswordFields } from '@/components/auth/form/new-password-fields';
import { AuthCaptcha } from '@/components/auth/shared/auth-captcha';
import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { PluginAuthButtons } from '@/components/auth/shared/plugin-auth-buttons';
import { FieldGroup } from '@/components/ui/field';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useIsAuthMutating } from '@/hooks/use-is-auth-mutating';
import { getAuthAdditionalFieldValidators } from '@/lib/auth/auth-form-utils';
import { validateEmail } from '@/lib/auth/auth-validation';
import { useSignUpForm } from './use-sign-up-form';

export type SignUpProps = {
  className?: string;
  /**
   * Runs instead of the post-sign-up redirect, but only when the sign-up
   * created an immediately usable session. Email verification still takes
   * priority.
   */
  onSignUpSuccess?: () => void;
};

/**
 * Renders a sign-up form with name, email, password and any configured
 * additional fields. Email verification redirects to the verify-email view;
 * otherwise `onSignUpSuccess` or the configured redirect runs.
 */
export function SignUp({ className, onSignUpSuccess }: SignUpProps) {
  const { emailAndPassword, localization, redirectTo } = useAuth();
  const authViewPath = useAuthViewPath();
  const isPending = useIsAuthMutating();
  const { form, signUpFields, compromised } = useSignUpForm(onSignUpSuccess);

  /** Additional fields render either above the password fields or below them. */
  const renderAdditionalFields = (above: boolean) =>
    signUpFields
      .filter((configuredField) => (configuredField.signUp === 'above') === above)
      .map((configuredField) => (
        <form.AppField
          key={configuredField.name}
          name={`additionalFields.${configuredField.name}`}
          validators={getAuthAdditionalFieldValidators(
            configuredField,
            localization.auth.fieldRequired,
          )}
        >
          {(field) => (
            <field.AuthFormAdditionalField
              field={configuredField}
              isPending={isPending}
              optionalLabel={localization.auth.optional}
            />
          )}
        </form.AppField>
      ));

  return (
    <AuthCard
      className={className}
      title={localization.auth.signUp}
      header={<AuthPrompts view="signUp" />}
      footer={
        emailAndPassword?.enabled && (
          <AuthFooterLink
            prompt={localization.auth.alreadyHaveAnAccount}
            label={localization.auth.signIn}
            href={getAuthLinkURL(authViewPath('signIn'), redirectTo)}
          />
        )
      }
    >
      {emailAndPassword?.enabled && (
        <form.AppForm>
          <form.AuthFormRoot>
            <FieldGroup>
              {emailAndPassword.name !== false && (
                <form.AppField
                  name="name"
                  validators={{
                    onChange: ({ value }) =>
                      validateStringLength(value, {
                        requiredMessage: localization.auth.fieldRequired,
                        trim: true,
                      }),
                  }}
                >
                  {(field) => (
                    <field.AuthFormTextField
                      label={localization.auth.name}
                      type="text"
                      autoComplete="name"
                      placeholder={localization.auth.namePlaceholder}
                      required
                      disabled={isPending}
                    />
                  )}
                </form.AppField>
              )}

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

              {renderAdditionalFields(true)}

              <NewPasswordFields
                form={form}
                fields={{ password: 'password', confirmPassword: 'confirmPassword' }}
                label={localization.auth.password}
                placeholder={localization.auth.passwordPlaceholder}
                disabled={isPending}
                isCompromised={compromised.isCompromised}
                onPasswordChange={compromised.clear}
              />

              {renderAdditionalFields(false)}

              <AuthCaptcha />

              <div className="flex flex-col gap-md">
                <form.AuthFormServerError />
                <form.AuthFormSubmitButton disabled={isPending}>
                  {localization.auth.signUp}
                </form.AuthFormSubmitButton>

                <PluginAuthButtons view="signUp" />
              </div>
            </FieldGroup>
          </form.AuthFormRoot>
        </form.AppForm>
      )}
    </AuthCard>
  );
}
