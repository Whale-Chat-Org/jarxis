'use client';
import { BanIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { getAdminErrorMessage } from '@/lib/admin-user-utils';
import type { InspectorSecurityState } from '@/types/admin-users';
export function UserSecurityActions({ state }: { state: InspectorSecurityState }) {
  const {
    config,
    canSetPassword,
    setPasswordOpen,
    canBan,
    isSelf,
    user,
    unban,
    setDangerousAction,
    canDelete,
  } = state;
  if (!user) return null;
  return (
    <>
      <section className="flex flex-col gap-lg">
        <h3 className="font-medium">{config.localization.security}</h3>
        <div>
          <Button
            disabled={canSetPassword.isPending || !canSetPassword.data?.success}
            onClick={() => setPasswordOpen(true)}
            type="button"
            variant="outline"
          >
            <KeyRoundIcon />
            {config.localization.setPassword}
          </Button>
        </div>
      </section>
      <Separator />
      <section className="flex flex-col gap-lg">
        <h3 className="font-medium">{config.localization.dangerZone}</h3>
        <div className="flex flex-wrap gap-sm">
          <Button
            disabled={canBan.isPending || !canBan.data?.success || isSelf}
            onClick={() =>
              user.banned ? unban.mutate({ userId: user.id }) : setDangerousAction('ban')
            }
            type="button"
            variant="outline"
          >
            <BanIcon />
            {user.banned ? config.localization.unbanUser : config.localization.banUser}
          </Button>
          <Button
            disabled={canDelete.isPending || !canDelete.data?.success || isSelf}
            onClick={() => setDangerousAction('delete')}
            type="button"
            variant="destructive"
          >
            <Trash2Icon />
            {config.localization.deleteUser}
          </Button>
        </div>
        {unban.error ? <FieldError>{getAdminErrorMessage(unban.error)}</FieldError> : null}
      </section>
    </>
  );
}
