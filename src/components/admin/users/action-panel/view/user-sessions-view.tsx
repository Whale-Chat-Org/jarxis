'use client';
import { Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { skeletonRowIds } from '@/lib/admin-user-skeletons';
import { formatDate } from '@/lib/admin-user-utils';
import { describeSessionDevice } from '@/lib/session-presentation';
import type { InspectorSessionsState } from '@/types/admin-users';
export function UserSessionsView({ state }: { state: InspectorSessionsState }) {
  const {
    sessionsPermission,
    sessions,
    config,
    canRevoke,
    isSelf,
    setDangerousAction,
    revokeSession,
  } = state;
  return (
    <>
      <div className="flex flex-col gap-md">
        {sessionsPermission.isPending || sessions.isPending ? (
          skeletonRowIds
            .slice(0, 3)
            .map((id) => <Skeleton className="h-bar-sm w-full" key={`session-${id}`} />)
        ) : !sessionsPermission.data?.success ? (
          <p className="text-body-sm text-muted-foreground">
            {config.localization.accessDeniedDescription}
          </p>
        ) : sessions.data?.sessions.length ? (
          <>
            <Button
              className="self-end"
              disabled={canRevoke.isPending || !canRevoke.data?.success || isSelf}
              onClick={() => setDangerousAction('revokeAll')}
              variant="outline"
            >
              {config.localization.revokeAllSessions}
            </Button>
            {sessions.data.sessions.map((item) => (
              <div
                className="flex items-start justify-between gap-md rounded-lg border p-md"
                key={item.id}
              >
                <div className="min-w-none text-body-sm">
                  <div className="truncate font-medium">
                    {describeSessionDevice(item.userAgent).name}
                  </div>
                  <div className="text-caption text-muted-foreground">
                    {formatDate(item.createdAt)} · {formatDate(item.expiresAt)}
                  </div>
                  {config.showIpAddress && item.ipAddress ? (
                    <div className="mt-2xs font-mono text-caption text-muted-foreground">
                      {item.ipAddress}
                    </div>
                  ) : null}
                </div>
                <Button
                  aria-label={config.localization.revoke}
                  disabled={
                    revokeSession.isPending ||
                    canRevoke.isPending ||
                    !canRevoke.data?.success ||
                    isSelf
                  }
                  onClick={() => revokeSession.mutate({ sessionToken: item.token })}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </>
        ) : (
          <p className="py-2xl text-center text-body-sm text-muted-foreground">
            {config.localization.noSessions}
          </p>
        )}
      </div>
    </>
  );
}
