'use client';

import { getReauthenticationSignInURL, isReauthenticationSignInURL } from '@better-auth-ui/core';
import { useAuth, useSignOut } from '@better-auth-ui/react';
import { useSyncExternalStore } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { subscribeNoop } from '@/hooks/use-is-hydrated';
import { cn } from '@/lib/utils';

function useIsReauthenticationSignIn() {
  return useSyncExternalStore(
    subscribeNoop,
    () => isReauthenticationSignInURL(new URL(window.location.href)),
    () => false,
  );
}

export type ReauthenticationActionProps = {
  className?: string;
};

/** Explains that the session is too old for a sensitive action and offers to sign in again. */
export function ReauthenticationAction({ className }: ReauthenticationActionProps) {
  const { authClient, localization, navigate } = useAuth();
  const authViewPath = useAuthViewPath();
  const signOut = useSignOut(authClient);

  const handleReauthentication = () => {
    const signInURL = getReauthenticationSignInURL(
      new URL(window.location.href),
      authViewPath('signIn'),
    );
    signOut.mutate(undefined, {
      onSuccess: () => navigate({ to: signInURL }),
    });
  };

  return (
    <div className={cn('flex flex-col items-start gap-md p-lg', className)}>
      <div className="flex flex-col gap-2xs">
        <h3 className="text-body-sm font-medium">{localization.settings.reauthenticationTitle}</h3>
        <p className="text-body-sm text-muted-foreground">
          {localization.settings.reauthenticationDescription}
        </p>
      </div>
      <Button disabled={signOut.isPending} onClick={handleReauthentication} size="sm">
        {signOut.isPending ? <Spinner data-icon="inline-start" /> : null}
        {localization.settings.reauthenticationAction}
      </Button>
    </div>
  );
}

/** Sign-in notice shown when the user arrived from a reauthentication request. */
export function ReauthenticationNotice() {
  const { localization } = useAuth();
  const isReauthenticationSignIn = useIsReauthenticationSignIn();
  if (!isReauthenticationSignIn) return null;

  return (
    <Alert className="mx-lg w-auto group-data-[size=sm]/card:mx-md">
      <AlertTitle>{localization.settings.reauthenticationTitle}</AlertTitle>
      <AlertDescription>{localization.settings.reauthenticationDescription}</AlertDescription>
    </Alert>
  );
}
