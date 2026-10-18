'use client';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/admin-user-utils';
import type { InspectorAccountState } from '@/types/admin-users';
export function UserAccountInformation({ state }: { state: InspectorAccountState }) {
  const { config, user, userIdCopied, copyUserId, auth } = state;
  if (!user) return null;
  return (
    <section className="flex flex-col gap-lg">
      <h3 className="font-medium">{config.localization.accountInformation}</h3>
      <dl className="grid gap-x-2xl gap-y-lg text-body-sm">
        <div className="flex flex-col gap-2xs">
          <dt className="text-muted-foreground">{config.localization.userId}</dt>
          <dd className="flex min-w-none items-center gap-2xs">
            <code className="truncate text-caption">{user.id}</code>
            <Button
              aria-label={
                userIdCopied
                  ? auth.localization.settings.copiedToClipboard
                  : config.localization.copyUserId
              }
              onClick={() => copyUserId(user.id)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {userIdCopied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </dd>
        </div>
        <div className="flex flex-col gap-2xs">
          <dt className="text-muted-foreground">{config.localization.created}</dt>
          <dd>{formatDate(user.createdAt)}</dd>
        </div>
        <div className="flex flex-col gap-2xs">
          <dt className="text-muted-foreground">{config.localization.status}</dt>
          <dd>
            <Badge variant={user.banned ? 'destructive' : 'secondary'}>
              {user.banned ? config.localization.banned : config.localization.active}
            </Badge>
          </dd>
        </div>
        {user.banned && user.banReason ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-muted-foreground">{config.localization.banReason}</dt>
            <dd>{user.banReason}</dd>
          </div>
        ) : null}
        {user.banned && user.banExpires ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-muted-foreground">{config.localization.banExpires}</dt>
            <dd>{formatDate(user.banExpires)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
