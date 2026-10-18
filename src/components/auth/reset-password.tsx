'use client';
import { PasswordInput } from '@/components/auth/password-input';
import { validatePasswordLength } from '@/components/auth/password-validation';
import { inlineFormErrors } from '@/lib/api-client';

import {
  getAuthLinkURL,
  isPasswordCompromisedError,
  validateMatchingValue,
} from '@better-auth-ui/core';
import { useAuth, useResetPassword } from '@better-auth-ui/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { isAuthFormFieldInvalid, useAuthForm } from './auth-form';
import { PasswordStrengthMeter } from './password-strength-meter';

export type ResetPasswordProps = {
  className?: string;
};

/**
 * Render a password reset form that validates the reset token from the URL, accepts a new password (and optional confirmation), and submits it to the auth client.
 *
 * The component checks for a `token` query parameter on mount and, if missing, shows an error toast and navigates to the sign-in page. It exposes per-field validation messages, toggles for password visibility, and disables inputs while the reset request is pending.
 *
 * @returns The password reset form UI ready to be mounted in the app layout.
 */
export function ResetPassword({ className }: ResetPasswordProps) {
  const {
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    navigate,
    redirectTo,
    viewPaths,
    Link,
  } = useAuth();
  const signInURL = getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo);

  const { mutateAsync: resetPassword, isPending } = useResetPassword(authClient, {
    ...inlineFormErrors,
    onError: (error) => {
      // The haveIBeenPwned plugin rejects on the password itself, so it
      // belongs against the field rather than in a toast.
      if (isPasswordCompromisedError(error)) {
        setIsCompromised(true);
      }
    },
    onSuccess: () => {
      toast.success(localization.auth.passwordResetSuccess);
      navigate({ to: signInURL });
    },
  });

  const [isCompromised, setIsCompromised] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get('token');

    if (!token) {
      toast.error(localization.auth.invalidResetPasswordToken);
      navigate({ to: signInURL });
    }
  }, [localization.auth.invalidResetPasswordToken, navigate, signInURL]);

  const form = useAuthForm({
    defaultValues: { confirmPassword: '', password: '' },
    onSubmit: async ({ value }) => {
      const searchParams = new URLSearchParams(window.location.search);
      const token = searchParams.get('token');

      if (!token) {
        toast.error(localization.auth.invalidResetPasswordToken);
        navigate({ to: signInURL });
        return;
      }

      try {
        await resetPassword({ token, newPassword: value.password });
      } catch (error) {
        throw error;
      }
    },
  });

  return (
    <Card className={cn('w-full max-w-narrow', className)}>
      <CardHeader>
        <CardTitle className="text-title font-semibold">
          {localization.auth.resetPassword}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <form.AppForm>
          <form.AuthFormRoot>
            <FieldGroup>
              <form.AppField
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    validatePasswordLength(value, emailAndPassword, localization.auth),
                }}
              >
                {(field) => {
                  const isInvalid = isAuthFormFieldInvalid(field.state.meta) || isCompromised;

                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="password">{localization.auth.password}</FieldLabel>

                      <PasswordInput
                        id="password"
                        autoComplete="new-password"
                        placeholder={localization.auth.newPasswordPlaceholder}
                        required
                        minLength={emailAndPassword?.minPasswordLength}
                        maxLength={emailAndPassword?.maxPasswordLength}
                        disabled={isPending}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                          setIsCompromised(false);
                        }}
                        aria-invalid={isInvalid}
                        value={field.state.value}
                      />

                      {isCompromised ? (
                        <FieldError>{localization.auth.passwordCompromised}</FieldError>
                      ) : (
                        <field.AuthFormFieldError />
                      )}

                      <PasswordStrengthMeter password={field.state.value} />
                    </Field>
                  );
                }}
              </form.AppField>

              {emailAndPassword?.confirmPassword && (
                <form.AppField
                  name="confirmPassword"
                  validators={{
                    onChangeListenTo: ['password'],
                    onChange: ({ fieldApi, value }) =>
                      validatePasswordLength(value, emailAndPassword, localization.auth) ??
                      validateMatchingValue(
                        value,
                        fieldApi.form.getFieldValue('password'),
                        localization.auth.passwordsDoNotMatch,
                      ),
                  }}
                >
                  {(field) => {
                    const isInvalid = isAuthFormFieldInvalid(field.state.meta);

                    return (
                      <Field data-invalid={isInvalid}>
                        <FieldLabel htmlFor="confirmPassword">
                          {localization.auth.confirmPassword}
                        </FieldLabel>

                        <PasswordInput
                          id="confirmPassword"
                          name={field.name}
                          autoComplete="new-password"
                          placeholder={localization.auth.confirmPasswordPlaceholder}
                          required
                          minLength={emailAndPassword?.minPasswordLength}
                          maxLength={emailAndPassword?.maxPasswordLength}
                          disabled={isPending}
                          onBlur={field.handleBlur}
                          onChange={(event) => field.handleChange(event.target.value)}
                          aria-invalid={isInvalid}
                          value={field.state.value}
                        />

                        <field.AuthFormFieldError />
                      </Field>
                    );
                  }}
                </form.AppField>
              )}

              <div className="flex flex-col gap-md">
                <form.AuthFormServerError />
                <form.AuthFormSubmitButton disabled={isPending}>
                  {localization.auth.resetPassword}
                </form.AuthFormSubmitButton>
              </div>
            </FieldGroup>
          </form.AuthFormRoot>
        </form.AppForm>

        <div className="mt-lg flex w-full flex-col items-center gap-md">
          <FieldDescription className="text-center">
            {localization.auth.rememberYourPassword}{' '}
            <Link
              href={getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, redirectTo)}
              className="underline underline-offset-4"
            >
              {localization.auth.signIn}
            </Link>
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  );
}
