'use client';
import { type AdminAuthClient, isAdminTarget } from '@better-auth-ui/core/plugins/admin';
import { useAuth, useAuthPlugin, useCopyToClipboard, useSession } from '@better-auth-ui/react';
import {
  useAdminPermission,
  useAdminUser,
  useAdminUserSessions,
} from '@better-auth-ui/react/plugins/admin';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { adminPlugin } from '@/lib/auth/admin-plugin';
import type { UserInspectorProps } from '@/types/admin-users';
export function useUserInspectorData({ canGetUser, open, userId }: UserInspectorProps) {
  const auth = useAuth<AdminAuthClient>();
  const config = useAuthPlugin(adminPlugin);
  const contributedTabs = auth.plugins.flatMap((plugin) =>
    (plugin.adminUserTabs ?? []).map((tab) => ({
      ...tab,
      value: `${plugin.id}:${tab.id}`,
    })),
  );
  const detail = useAdminUser(auth.authClient, userId, {
    enabled: canGetUser,
  });
  const user = detail.data;
  const sessionsPermission = useAdminPermission(
    auth.authClient,
    {
      session: ['list'],
    },
    { enabled: Boolean(userId) },
  );
  const sessions = useAdminUserSessions(auth.authClient, userId, {
    enabled: sessionsPermission.data?.success === true,
  });
  const { data: actor } = useSession(auth.authClient);
  const canSetRole = useAdminPermission(
    auth.authClient,
    {
      user: ['set-role'],
    },
    { enabled: Boolean(userId) },
  );
  const canUpdate = useAdminPermission(
    auth.authClient,
    { user: ['update'] },
    { enabled: Boolean(userId) },
  );
  const canSetEmail = useAdminPermission(
    auth.authClient,
    { user: ['set-email'] },
    { enabled: Boolean(userId) },
  );
  const canSetPassword = useAdminPermission(
    auth.authClient,
    {
      user: ['set-password'],
    },
    { enabled: Boolean(userId) },
  );
  const canBan = useAdminPermission(
    auth.authClient,
    { user: ['ban'] },
    { enabled: Boolean(userId) },
  );
  const canImpersonate = useAdminPermission(
    auth.authClient,
    {
      user: ['impersonate'],
    },
    { enabled: Boolean(userId) },
  );
  const targetIsAdmin = user ? isAdminTarget(user, config.adminRoles, config.adminUserIds) : false;
  const canImpersonateAdmins = useAdminPermission(
    auth.authClient,
    { user: ['impersonate-admins'] },
    { enabled: Boolean(userId && targetIsAdmin) },
  );
  const canDelete = useAdminPermission(
    auth.authClient,
    { user: ['delete'] },
    { enabled: Boolean(userId) },
  );
  const canRevoke = useAdminPermission(
    auth.authClient,
    {
      session: ['revoke'],
    },
    { enabled: Boolean(userId) },
  );
  const {
    copied: userIdCopied,
    copy: copyUserId,
    reset: resetUserIdCopy,
  } = useCopyToClipboard({
    onError: () => toast.error(auth.localization.errors.copyFailed),
  });

  useEffect(() => {
    if (open && userId) resetUserIdCopy();
  }, [open, userId, resetUserIdCopy]);

  const isSelf = user?.id === actor?.user.id;
  return {
    auth,
    config,
    contributedTabs,
    detail,
    user,
    sessionsPermission,
    sessions,
    actor,
    canSetRole,
    canUpdate,
    canSetEmail,
    canSetPassword,
    canBan,
    canImpersonate,
    targetIsAdmin,
    canImpersonateAdmins,
    canDelete,
    canRevoke,
    userIdCopied,
    copyUserId,
    isSelf,
    userId,
  };
}
