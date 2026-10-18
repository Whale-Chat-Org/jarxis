'use client';

import { useAuth, useSignOut } from '@better-auth-ui/react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { cn } from '@/lib/utils';

export type SignOutProps = {
  className?: string;
};

/**
 * Signs the current user out on mount and renders a centered spinner while the operation completes.
 *
 * @param className - Optional additional class names appended to the root element
 * @returns The spinner shown during sign-out
 */
export function SignOut({ className }: SignOutProps) {
  const { authClient, navigate } = useAuth();
  const authViewPath = useAuthViewPath();

  const {
    mutate: signOut,
    isError,
    isPending,
  } = useSignOut(authClient, {
    onSuccess: () => navigate({ to: authViewPath('signIn'), replace: true }),
  });

  const hasSignedOut = useRef(false);

  useEffect(() => {
    if (hasSignedOut.current) return;
    hasSignedOut.current = true;

    signOut();
  }, [signOut]);

  if (isError) {
    return (
      <Button className={className} disabled={isPending} onClick={() => signOut()}>
        Try signing out again
      </Button>
    );
  }

  return <Spinner className={cn('mx-auto my-auto', className)} />;
}
