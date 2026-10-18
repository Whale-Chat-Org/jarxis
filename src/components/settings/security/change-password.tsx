'use client';

import { getViewURL, validateStringLength } from '@better-auth-ui/core';
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

import { useAuthForm } from '@/components/auth/form/auth-form';
import { NewPasswordFields } from '@/components/auth/form/new-password-fields';
import { AuthCaptcha } from '@/components/auth/shared/auth-captcha';
import { OpenEmailButton } from '@/components/auth/shared/open-email-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useCompromisedPassword } from '@/hooks/use-compromised-password';
import { inlineFormErrors } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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
  const { authClient, localization } = useAuth();
  const { data: session } = useSession(authClient);
  const { data: accounts, isPending: isAccountsPending } = useListAccounts(authClient);

  const hasCredentialAccount = accounts?.some((account) => account.providerId === 'credential');

  if (!isAccountsPending && !hasCredentialAccount) {
    return <SetPassword className={className} />;
  }

  return (
    <ChangePasswordForm
      className={className}
      localization={localization}
      session={isAccountsPending ? undefined : session}
    />
  );
}

function SetPassword({ className }: { className?: string }) {
  const { authClient, basePaths, baseURL, localization, viewPaths } = useAuth();
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
              <AuthCaptcha className="justify-start" />

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
  localization,
  session,
}: {
  className?: string;
  localization: ReturnType<typeof useAuth>['localization'];
  session: ReturnType<typeof useSession>['data'];
}) {
  const { authClient } = useAuth();
  const compromised = useCompromisedPassword();
  const { mutateAsync: changePassword, isPending } = useChangePassword(authClient, {
    ...inlineFormErrors,
    onError: compromised.flag,
    onSuccess: () => {
      form.reset();
      toast.success(localization.settings.changePasswordSuccess);
    },
  });

  const form = useAuthForm({
    defaultValues: {
      confirmPassword: '',
      currentPassword: '',
      newPassword: '',
    },
    onSubmit: async ({ value }) =>
      await changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true,
      }),
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
                  <field.AuthFormPasswordField
                    label={localization.settings.currentPassword}
                    autoComplete="current-password"
                    placeholder={localization.settings.currentPasswordPlaceholder}
                    disabled={isPending}
                    isLoading={!session}
                    required
                  />
                )}
              </form.AppField>

              <NewPasswordFields
                form={form}
                fields={{ password: 'newPassword', confirmPassword: 'confirmPassword' }}
                label={localization.auth.newPassword}
                placeholder={localization.auth.newPasswordPlaceholder}
                disabled={isPending}
                isLoading={!session}
                isCompromised={compromised.isCompromised}
                onPasswordChange={compromised.clear}
              />
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
