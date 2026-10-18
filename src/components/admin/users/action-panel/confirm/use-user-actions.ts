'use client';
import { useRef, useState } from 'react';

import { getAdminErrorMessage, getBanDurationSeconds } from '@/lib/admin-user-utils';
import type { DangerousAction, UserInspectorData, UserInspectorProps } from '@/types/admin-users';
import { useUserActionMutations } from '@/components/admin/users/action-panel/confirm/use-user-action-mutations';
export function useUserActions(
  data: UserInspectorData,
  { onOpenChange }: Pick<UserInspectorProps, 'onOpenChange'>,
) {
  const { auth, config, user } = data;
  const { ban, unban, remove, impersonate, revokeSession, revokeSessions } =
    useUserActionMutations(data);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState('');
  const banDurationSeconds = getBanDurationSeconds(banDuration);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [dangerousAction, setDangerousAction] = useState<DangerousAction>();
  const confirmationInFlight = useRef(false);
  const settled = () => {
    confirmationInFlight.current = false;
  };
  const actions = {
    ban: {
      label: config.localization.banUser,
      execute: () => {
        if (!user || banDurationSeconds === null) return;
        ban.mutate(
          {
            userId: user.id,
            banExpiresIn: banDurationSeconds,
            banReason: banReason.trim() || undefined,
          },
          {
            onSettled: settled,
            onSuccess: () => {
              setBanDuration('');
              setBanReason('');
              setDangerousAction(undefined);
            },
          },
        );
      },
    },
    delete: {
      label: config.localization.deleteUser,
      execute: () => {
        if (user)
          remove.mutate(
            { userId: user.id },
            {
              onSettled: settled,
              onSuccess: () => {
                setDangerousAction(undefined);
                onOpenChange(false);
              },
            },
          );
      },
    },
    revokeAll: {
      label: config.localization.revokeAllSessions,
      execute: () => {
        if (user)
          revokeSessions.mutate(
            { userId: user.id },
            { onSettled: settled, onSuccess: () => setDangerousAction(undefined) },
          );
      },
    },
    impersonate: {
      label: config.localization.impersonateUser,
      execute: () => {
        if (user)
          impersonate.mutate(
            { userId: user.id },
            {
              onSettled: settled,
              onSuccess: () => {
                setDangerousAction(undefined);
                if (config.impersonationRedirectTo)
                  auth.navigate({ to: config.impersonationRedirectTo });
              },
            },
          );
      },
    },
  } satisfies Record<DangerousAction, { label: string; execute: () => void }>;
  const selectedAction = actions[dangerousAction ?? 'impersonate'];
  const confirm = () => {
    if (
      !user ||
      !dangerousAction ||
      confirmationInFlight.current ||
      (dangerousAction === 'ban' && banDurationSeconds === null)
    )
      return;
    confirmationInFlight.current = true;
    selectedAction.execute();
  };
  const closeDangerousAction = () => {
    ban.reset();
    remove.reset();
    revokeSessions.reset();
    impersonate.reset();
    setBanDuration('');
    setBanReason('');
    setDangerousAction(undefined);
  };
  const selectedMutation = { ban, delete: remove, revokeAll: revokeSessions, impersonate }[
    dangerousAction ?? 'impersonate'
  ];
  const dangerousError = getAdminErrorMessage(selectedMutation.error);
  const isConfirming = selectedMutation.isPending;
  const dangerLabel = selectedAction.label;
  return {
    banReason,
    setBanReason,
    banDuration,
    setBanDuration,
    banDurationSeconds,
    passwordOpen,
    setPasswordOpen,
    dangerousAction,
    setDangerousAction,
    confirmationInFlight,
    closeDangerousAction,
    dangerousError,
    isConfirming,
    dangerLabel,
    confirm,
    unban,
    revokeSession,
  };
}
