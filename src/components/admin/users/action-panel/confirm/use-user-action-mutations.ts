'use client';
import {
  banAdminUserOptions,
  impersonateAdminUserOptions,
  removeAdminUserOptions,
  revokeAdminUserSessionOptions,
  revokeAdminUserSessionsOptions,
  unbanAdminUserOptions,
} from '@better-auth-ui/core/plugins/admin';
import { useMutation } from '@tanstack/react-query';

import { withInlineErrors } from '@/lib/admin-user-utils';
import type { UserInspectorData } from '@/types/admin-users';
export function useUserActionMutations({
  auth,
  actor,
  userId,
}: Pick<UserInspectorData, 'auth' | 'actor' | 'userId'>) {
  const ban = useMutation(withInlineErrors(banAdminUserOptions(auth.authClient, actor?.user.id)));
  const unban = useMutation(
    withInlineErrors(unbanAdminUserOptions(auth.authClient, actor?.user.id)),
  );
  const remove = useMutation(
    withInlineErrors(removeAdminUserOptions(auth.authClient, actor?.user.id)),
  );
  const impersonate = useMutation(
    withInlineErrors(impersonateAdminUserOptions(auth.authClient, actor?.user.id)),
  );
  // The per-session revoke control shows no inline error, so it keeps the default toast behaviour.
  const revokeSession = useMutation(
    revokeAdminUserSessionOptions(auth.authClient, actor?.user.id, userId),
  );
  const revokeSessions = useMutation(
    withInlineErrors(revokeAdminUserSessionsOptions(auth.authClient, actor?.user.id, userId)),
  );
  return { ban, unban, remove, impersonate, revokeSession, revokeSessions };
}
