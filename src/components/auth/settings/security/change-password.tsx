'use client';
import { PasswordInput } from '@/components/auth/password-input';
import { validatePasswordLength } from '@/components/auth/password-validation';
import { inlineFormErrors } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  getViewURL,
  isPasswordCompromisedError,
  validateMatchingValue,
  validateStringLength,
} from '@better-auth-ui/core';
import {
  useAuth,
  useChangePassword,
  useFetchOptions,
  useListAccounts,
  useRequestPasswordReset,
  useSession,
} from '@better-auth-ui/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isAuthFormFieldInvalid, useAuthForm } from '../../auth-form';
import { OpenEmailButton } from '../../open-email-button';
import { PasswordStrengthMeter } from '../../password-strength-meter';

export type ChangePasswordProps = {
  className?: string;
};

/**
 * Render a card form for changing the authenticated user's password.
 *
 * When the user has a credential account, displays fields for current password,
 * new password, and optionally confirm password. When the user only has social
 * accounts, displays a prompt to set a password via the reset flow.
 *
 * @returns A JSX element containing the change-password or set-password card
 */
export function ChangePassword({ className }: ChangePasswordProps) {
  const { authClient, emailAndPassword, localization } = useAuth();
  const { data: session } = useSession(authClient);
  const { data: accounts, isPending: isAccountsPending } = useListAccounts(authClient);

  const hasCredentialAccount = accounts?.some((account) => account.providerId === 'credential');

  if (!isAccountsPending && !hasCredentialAccount) {
    return <SetPassword className={className} />;
  }

  return (
    <ChangePasswordForm
      className={className}
      emailAndPassword={emailAndPassword}
      localization={localization}
      session={isAccountsPending ? undefined : session}
    />
  );
}

function SetPassword({ className }: { className?: string }) {
  const { authClient, basePaths, baseURL, localization, plugins, viewPaths } = useAuth();
  const { data: session } = useSession(authClient);
  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const [sentEmail, setSentEmail] = useState('');

  const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(authClient, {
    onError: () => {
      resetFetchOptions();
    },
    onSuccess: (_data, { email }) => {
      setSentEmail(email);
    },
  });

  const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

  const handleSetPassword = () => {
    if (!session) return;

    requestPasswordReset({
      email: session.user.email,
      redirectTo: getViewURL(baseURL, basePaths.auth, viewPaths.auth.resetPassword),
      fetchOptions,
    });
  };

  return (
    <div>
      <h2 className="mb-md text-body-sm font-semibold">{localization.settings.changePassword}</h2>

      <Card className={cn(className)}>
        <CardContent className="flex flex-col gap-lg sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-body-sm leading-tight font-medium">
              {localization.settings.setPassword}
            </p>

            <p className="mt-3xs text-caption text-muted-foreground">
              {localization.settings.setPasswordDescription}
            </p>
          </div>

          {sentEmail ? (
            <div className="flex flex-col items-start gap-md sm:items-end">
              <p className="text-body-sm" role="status">
                {localization.auth.resetLinkSentTo.replace('{{email}}', sentEmail)}
              </p>

              <OpenEmailButton email={sentEmail} className="w-auto" />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-md sm:items-end">
              {Captcha && <div>{Captcha}</div>}

              <Button
                size="sm"
                disabled={isPending || !session?.user.email}
                onClick={handleSetPassword}
              >
                {isPending && <Spinner />}

                {localization.auth.sendResetLink}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChangePasswordForm({
  className,
  emailAndPassword,
  localization,
  session,
}: {
  className?: string;
  emailAndPassword: ReturnType<typeof useAuth>['emailAndPassword'];
  localization: ReturnType<typeof useAuth>['localization'];
  session: ReturnType<typeof useSession>['data'];
}) {
  const { authClient } = useAuth();
  const { mutateAsync: changePassword, isPending } = useChangePassword(authClient, {
    ...inlineFormErrors,
    onError: (error) => {
      // The haveIBeenPwned plugin rejects on the password itself, so it
      // belongs against the field rather than in a toast.
      setIsCompromised(isPasswordCompromisedError(error));
    },
    onSuccess: () => {
      form.reset();
      toast.success(localization.settings.changePasswordSuccess);
    },
  });

  const [isCompromised, setIsCompromised] = useState(false);

  const form = useAuthForm({
    defaultValues: {
      confirmPassword: '',
      currentPassword: '',
      newPassword: '',
    },
    onSubmit: async ({ value }) => {
      try {
        await changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
        });
      } catch (error) {
        throw error;
      }
    },
  });

  return (
    <div>
      <h2 className="mb-md text-body-sm font-semibold">{localization.settings.changePassword}</h2>

      <form.AppForm>
        <form.AuthFormRoot>
          <Card className={cn(className)}>
            <CardContent className="flex flex-col gap-xl">
              <form.AppField
                name="currentPassword"
                validators={{
                  onChange: ({ value }) =>
                    validateStringLength(value, {
                      requiredMessage: localization.auth.fieldRequired,
                    }),
                }}
              >
                {(field) => (
                  <Field data-invalid={isAuthFormFieldInvalid(field.state.meta)}>
                    <FieldLabel htmlFor="currentPassword">
                      {localization.settings.currentPassword}
                    </FieldLabel>

                    {session ? (
                      <PasswordInput
                        id="currentPassword"
                        name={field.name}
                        autoComplete="current-password"
                        placeholder={localization.settings.currentPasswordPlaceholder}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={isPending}
                        required
                        aria-invalid={isAuthFormFieldInvalid(field.state.meta)}
                      />
                    ) : (
                      <Skeleton>
                        <Input className="invisible" />
                      </Skeleton>
                    )}

                    <field.AuthFormFieldError />
                  </Field>
                )}
              </form.AppField>

              <form.AppField
                name="newPassword"
                validators={{
                  onChange: ({ value }) =>
                    validatePasswordLength(value, emailAndPassword, localization.auth),
                }}
              >
                {(field) => {
                  const isInvalid = isAuthFormFieldInvalid(field.state.meta) || isCompromised;

                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="newPassword">{localization.auth.newPassword}</FieldLabel>

                      {session ? (
                        <PasswordInput
                          id="newPassword"
                          name={field.name}
                          autoComplete="new-password"
                          placeholder={localization.auth.newPasswordPlaceholder}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                            setIsCompromised(false);
                          }}
                          minLength={emailAndPassword.minPasswordLength}
                          maxLength={emailAndPassword.maxPasswordLength}
                          disabled={isPending}
                          required
                          aria-invalid={isInvalid}
                        />
                      ) : (
                        <Skeleton>
                          <Input className="invisible" />
                        </Skeleton>
                      )}

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

              {emailAndPassword.confirmPassword && (
                <form.AppField
                  name="confirmPassword"
                  validators={{
                    onChangeListenTo: ['newPassword'],
                    onChange: ({ fieldApi, value }) =>
                      validatePasswordLength(value, emailAndPassword, localization.auth) ??
                      validateMatchingValue(
                        value,
                        fieldApi.form.getFieldValue('newPassword'),
                        localization.auth.passwordsDoNotMatch,
                      ),
                  }}
                >
                  {(field) => (
                    <Field data-invalid={isAuthFormFieldInvalid(field.state.meta)}>
                      <FieldLabel htmlFor="confirmPassword">
                        {localization.auth.confirmPassword}
                      </FieldLabel>

                      {session ? (
                        <PasswordInput
                          id="confirmPassword"
                          name={field.name}
                          autoComplete="new-password"
                          placeholder={localization.auth.confirmPasswordPlaceholder}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          minLength={emailAndPassword.minPasswordLength}
                          maxLength={emailAndPassword.maxPasswordLength}
                          disabled={isPending}
                          required
                          aria-invalid={isAuthFormFieldInvalid(field.state.meta)}
                        />
                      ) : (
                        <Skeleton>
                          <Input className="invisible" />
                        </Skeleton>
                      )}

                      <field.AuthFormFieldError />
                    </Field>
                  )}
                </form.AppField>
              )}
            </CardContent>

            <CardFooter>
              <form.AuthFormServerError />
              <form.AuthFormSubmitButton disabled={isPending || !session} size="sm">
                {localization.settings.updatePassword}
              </form.AuthFormSubmitButton>
            </CardFooter>
          </Card>
        </form.AuthFormRoot>
      </form.AppForm>
    </div>
  );
}
