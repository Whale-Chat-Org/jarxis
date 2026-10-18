'use client';
import { PasswordInput } from '@/components/auth/password-input';
import { validatePasswordLength } from '@/components/auth/password-validation';
import { inlineFormErrors } from '@/lib/api-client';

import { authMutationKeys, validateEmailAddress } from '@better-auth-ui/core';
import {
  isPasskeyAutoFillEnabled,
  withPasskeyAutoFill,
} from '@better-auth-ui/core/plugins/passkey';
import { AuthPrompts, useAuth, useFetchOptions, useSignInEmail } from '@better-auth-ui/react';
import { useIsMutating } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSignInContinuation } from '@/lib/auth/use-sign-in-continuation';
import { cn } from '@/lib/utils';
import { isAuthFormFieldInvalid, useAuthForm } from './auth-form';
import { LastUsedBadge } from './last-login-method/last-used-badge';
import { ReauthenticationNotice } from './reauthentication';

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
  const {
    authClient,
    basePaths,
    emailAndPassword,
    localization,
    plugins,
    viewPaths,
    navigate,
    Link,
  } = useAuth();

  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const continueSignIn = useSignInContinuation();

  const { mutateAsync: signInEmail, isPending: signInEmailPending } = useSignInEmail(authClient, {
    ...inlineFormErrors,
    onError: (error, { email }) => {
      if (error.error?.code === 'EMAIL_NOT_VERIFIED') {
        sessionStorage.setItem('better-auth-ui.verify-email', email);
        navigate({
          to: `${basePaths.auth}/${viewPaths.auth.verifyEmail}`,
        });
      }

      resetFetchOptions();
    },
    onSuccess: (data) => continueSignIn(data),
  });

  const signInMutating = useIsMutating({
    mutationKey: authMutationKeys.signIn.all,
  });
  const signUpMutating = useIsMutating({
    mutationKey: authMutationKeys.signUp.all,
  });
  const isPending = signInMutating + signUpMutating > 0;

  const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

  const passkeyAutoFill = isPasskeyAutoFillEnabled(plugins);

  const form = useAuthForm({
    defaultValues: { email: '', password: '', rememberMe: false },
    onSubmit: async ({ value }) =>
      await signInEmail({
        email: value.email,
        password: value.password,
        ...(emailAndPassword?.rememberMe ? { rememberMe: value.rememberMe } : {}),
        fetchOptions,
      }),
  });

  return (
    <Card className={cn('w-full max-w-narrow', className)}>
      <AuthPrompts view="signIn" />
      <ReauthenticationNotice />
      <CardHeader>
        <CardTitle className="text-title font-semibold">{localization.auth.signIn}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-xl">
          {emailAndPassword?.enabled && (
            <form.AppForm>
              <form.AuthFormRoot>
                <FieldGroup>
                  <form.AppField
                    name="email"
                    validators={{
                      onChange: ({ value }) =>
                        validateEmailAddress(value, {
                          invalidMessage: localization.auth.invalidEmail,
                          requiredMessage: localization.auth.fieldRequired,
                        }),
                    }}
                  >
                    {(field) => {
                      const isInvalid = isAuthFormFieldInvalid(field.state.meta);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="email">{localization.auth.email}</FieldLabel>

                          <Input
                            id="email"
                            name={field.name}
                            type="email"
                            autoComplete={withPasskeyAutoFill('email', passkeyAutoFill)}
                            placeholder={localization.auth.emailPlaceholder}
                            required
                            disabled={isPending}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-invalid={isInvalid}
                          />
                          <field.AuthFormFieldError />
                        </Field>
                      );
                    }}
                  </form.AppField>

                  <form.AppField
                    name="password"
                    validators={{
                      onChange: ({ value }) =>
                        validatePasswordLength(value, emailAndPassword, localization.auth),
                    }}
                  >
                    {(field) => {
                      const isInvalid = isAuthFormFieldInvalid(field.state.meta);
                      return (
                        <Field data-invalid={isInvalid}>
                          <FieldLabel htmlFor="password">{localization.auth.password}</FieldLabel>

                          <PasswordInput
                            id="password"
                            name={field.name}
                            autoComplete={withPasskeyAutoFill('current-password', passkeyAutoFill)}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            placeholder={localization.auth.passwordPlaceholder}
                            required
                            minLength={emailAndPassword?.minPasswordLength}
                            maxLength={emailAndPassword?.maxPasswordLength}
                            disabled={isPending}
                            aria-invalid={isInvalid}
                          />

                          <field.AuthFormFieldError />
                        </Field>
                      );
                    }}
                  </form.AppField>

                  {emailAndPassword.rememberMe && (
                    <form.AppField name="rememberMe">
                      {(field) => (
                        <Field className="my-2xs">
                          <div className="flex items-center gap-md">
                            <Checkbox
                              id="rememberMe"
                              name={field.name}
                              checked={field.state.value}
                              disabled={isPending}
                              onCheckedChange={(checked) => field.handleChange(checked === true)}
                            />

                            <FieldLabel
                              htmlFor="rememberMe"
                              className="cursor-pointer text-body-sm font-normal"
                            >
                              {localization.auth.rememberMe}
                            </FieldLabel>
                          </div>
                        </Field>
                      )}
                    </form.AppField>
                  )}

                  {Captcha && <div className="flex justify-center">{Captcha}</div>}

                  <div className="flex flex-col gap-md">
                    <form.AuthFormServerError />
                    <form.AuthFormSubmitButton
                      isPending={signInEmailPending}
                      className="relative overflow-visible"
                      disabled={isPending}
                    >
                      {localization.auth.signIn}

                      <LastUsedBadge method="email" floating />
                    </form.AuthFormSubmitButton>

                    {plugins.flatMap((plugin) =>
                      (plugin.authButtons ?? []).map((AuthButton, index) => (
                        <AuthButton key={`${plugin.id}-${index.toString()}`} view="signIn" />
                      )),
                    )}
                  </div>
                </FieldGroup>
              </form.AuthFormRoot>
            </form.AppForm>
          )}
        </div>

        <div className="mt-lg flex w-full flex-col items-center gap-md">
          {emailAndPassword?.enabled && emailAndPassword?.forgotPassword && (
            <Link
              href={`${basePaths.auth}/${viewPaths.auth.forgotPassword}`}
              className="self-center text-body-sm underline-offset-4 hover:underline"
            >
              {localization.auth.forgotPasswordLink}
            </Link>
          )}

          {emailAndPassword?.enabled && (
            <FieldDescription className="text-center">
              {localization.auth.needToCreateAnAccount}{' '}
              <Link
                href={`${basePaths.auth}/${viewPaths.auth.signUp}`}
                className="underline underline-offset-4"
              >
                {localization.auth.signUp}
              </Link>
            </FieldDescription>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
