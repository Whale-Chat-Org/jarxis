'use client';

import { getAuthRedirectAction } from '@better-auth-ui/core';
import { useAuth, useSession } from '@better-auth-ui/react';
import { useEffect, useRef } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { cn } from '@/lib/utils';

export type AuthRedirectProps = {
  className?: string;
};

/**
 * Redirects authenticated users to a validated same-origin target.
 *
 * Signed-out users are sent through the sign-in view first. The redirect view
 * is preserved as the post-authentication destination so API callbacks receive
 * a full-page request after the session is established.
 *
 * @param className - Optional additional class names applied to the spinner
 * @returns The centered spinner shown while the session and redirect resolve
 */
export function AuthRedirect({ className }: AuthRedirectProps) {
  const { authClient } = useAuth();
  const authViewPath = useAuthViewPath();
  const { data: session, isPending } = useSession(authClient);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (isPending || hasRedirected.current) return;
    hasRedirected.current = true;

    const action = getAuthRedirectAction(
      new URL(window.location.href),
      Boolean(session),
      authViewPath('signIn'),
    );

    window.location.replace(action.to);
  }, [authViewPath, isPending, session]);

  return <Spinner className={cn('mx-auto my-auto', className)} />;
}
