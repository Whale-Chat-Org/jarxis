'use client';

import { isReauthenticationRequiredError } from '@better-auth-ui/core';
import { useAuth, useListSessions, useSession } from '@better-auth-ui/react';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemSeparator } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { ReauthenticationAction } from '@/components/auth/shared/reauthentication';
import { ActiveSession } from './active-session';
import { SessionActions } from './session-actions';

export type ActiveSessionsProps = {
  className?: string;
};

/**
 * Render a card listing all active sessions for the current user with revoke controls.
 *
 * Shows each session's browser, OS, IP address, and creation time. The current session is marked
 * and navigates to sign-out on click, while other sessions can be revoked individually.
 *
 * @returns A JSX element containing the sessions card
 */
export function ActiveSessions({ className }: ActiveSessionsProps) {
  const { authClient, localization } = useAuth();
  const { data: session } = useSession(authClient);

  const sessionsQuery = useListSessions(authClient, {
    meta: { errorPresentation: 'inline' },
  });
  const { data: sessions, error, isPending } = sessionsQuery;

  const activeSessions = [...(sessions ?? [])].sort((activeSession) =>
    activeSession.id === session?.session.id ? -1 : 1,
  );

  return (
    <div>
      <h2 className="mb-md text-body-sm font-semibold">{localization.settings.activeSessions}</h2>

      <Card className={cn('gap-none p-none', className)}>
        <CardContent className="p-none">
          {isReauthenticationRequiredError(error) ? (
            <ReauthenticationAction />
          ) : error ? (
            <div className="flex flex-col items-start gap-sm p-lg text-body-sm" role="alert">
              <span className="text-foreground">
                {safeActionErrorMessage(error, localization.errors.generic)}
              </span>
              <Button onClick={() => sessionsQuery.refetch()} size="sm" variant="outline">
                Try again
              </Button>
            </div>
          ) : isPending ? (
            <SessionRowSkeleton />
          ) : (
            <ItemGroup className="gap-none">
              {activeSessions?.map((activeSession, index) => (
                <Fragment key={activeSession.id}>
                  {index > 0 && <ItemSeparator className="my-none" />}
                  <ActiveSession activeSession={activeSession} />
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </CardContent>
        {!isPending && !error && (
          <SessionActions
            hasOtherSessions={activeSessions.some(
              (activeSession) => activeSession.id !== session?.session.id,
            )}
          />
        )}
      </Card>
    </div>
  );
}

function SessionRowSkeleton() {
  return (
    <Item>
      <ItemMedia>
        <Skeleton className="size-control-lg rounded-md" />
      </ItemMedia>
      <ItemContent>
        <Skeleton className="h-icon w-bar-sm" />
        <Skeleton className="h-md w-bar-xl" />
      </ItemContent>
    </Item>
  );
}
