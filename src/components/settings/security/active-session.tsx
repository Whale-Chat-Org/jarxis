'use client';
import { describeSessionDevice, sessionAge } from '@/lib/session-presentation';

import { useAuth, useRevokeSession, useSession } from '@better-auth-ui/react';
import type { Session } from 'better-auth';
import { LogOut, Monitor, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';

export type ActiveSessionProps = {
  activeSession: Session;
};

/**
 * Render a single active session row with device info and revoke control.
 *
 * Shows the session's browser, OS, and creation time. The current session is marked
 * and navigates to sign-out on click, while other sessions can be revoked individually.
 *
 * @param session - The session object containing id, token, userAgent, ipAddress, and createdAt
 * @returns A JSX element containing the active session row
 */
export function ActiveSession({ activeSession }: ActiveSessionProps) {
  const { authClient, basePaths, localization, viewPaths, navigate } = useAuth();
  const { data: session } = useSession(authClient, { refetchOnMount: false });

  const { mutate: revokeSession, isPending: isRevoking } = useRevokeSession(authClient, {
    onSuccess: () => toast.success(localization.settings.revokeSessionSuccess),
  });

  const isCurrentSession = activeSession.token === session?.session.token;
  const device = describeSessionDevice(activeSession.userAgent);
  const isMobile = device.mobile;

  return (
    <Item>
      <ItemMedia variant="icon">{isMobile ? <Smartphone /> : <Monitor />}</ItemMedia>
      <ItemContent>
        <ItemTitle>{device.name}</ItemTitle>
        {isCurrentSession ? (
          <Badge variant="secondary">{localization.settings.currentSession}</Badge>
        ) : (
          activeSession.createdAt && (
            <ItemDescription className="capitalize">
              {sessionAge(activeSession.createdAt)}
            </ItemDescription>
          )
        )}
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            isCurrentSession
              ? navigate({
                  to: `${basePaths.auth}/${viewPaths.auth.signOut}`,
                })
              : revokeSession(activeSession)
          }
          disabled={isRevoking}
          aria-label={
            isCurrentSession ? localization.auth.signOut : localization.settings.revokeSession
          }
        >
          {isRevoking ? <Spinner /> : isCurrentSession ? <LogOut /> : <X />}

          {isCurrentSession ? localization.auth.signOut : localization.settings.revoke}
        </Button>
      </ItemActions>
    </Item>
  );
}
