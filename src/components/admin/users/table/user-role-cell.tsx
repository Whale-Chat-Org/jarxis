'use client';
import { type AdminAuthClient, setAdminUserRoleOptions } from '@better-auth-ui/core/plugins/admin';
import { useAuth } from '@better-auth-ui/react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { RolePicker } from '@/components/admin/role-picker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import type { RoleView } from '@/lib/admin-contracts';
import { parseRoleKeys } from '@/lib/role-keys';

export function UserRoleCell({
  user,
  currentUserId,
  canManageAccess,
  roles,
}: {
  user: { id: string; name: string; email: string; role?: string | null };
  currentUserId: string;
  canManageAccess: boolean;
  roles: RoleView[];
}) {
  const auth = useAuth<AdminAuthClient>();
  const setRole = useMutation(setAdminUserRoleOptions(auth.authClient, currentUserId));
  const [candidate, setCandidate] = useState<string>();
  const [message, setMessage] = useState('');
  const assignedKeys = parseRoleKeys(user.role);
  const current = assignedKeys.length === 1 ? assignedKeys[0] : '';
  const label =
    assignedKeys.map((key) => roles.find((item) => item.key === key)?.name ?? key).join(', ') ||
    'No role';
  const ownRow = user.id === currentUserId;
  const editable = canManageAccess && !ownRow;
  const confirm = async () => {
    if (!candidate || (assignedKeys.length < 2 && candidate === current) || setRole.isPending)
      return;
    try {
      await setRole.mutateAsync({ userId: user.id, role: [candidate] as ('user' | 'admin')[] });
      const next = roles.find((item) => item.key === candidate)?.name ?? candidate;
      setMessage(`${user.name || user.email} is now ${next}`);
      toast.success(`Role updated for ${user.name || user.email}`);
      setCandidate(undefined);
    } catch {
      setMessage('The role was not changed');
      toast.error('The role was not changed. Try again.');
    }
  };

  return (
    <div onClick={(event) => event.stopPropagation()}>
      {editable ? (
        <RolePicker
          roles={roles}
          value={assignedKeys}
          display={label}
          label={`Role for ${user.name || user.email}`}
          disabled={setRole.isPending}
          onChange={([value]) => setCandidate(value)}
        />
      ) : (
        <span className="flex flex-wrap items-center gap-xs">
          <Badge variant="outline">{label}</Badge>
          {ownRow && <span className="text-caption text-muted-foreground">You</span>}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      <AlertDialog
        open={Boolean(candidate)}
        onOpenChange={(open) => !open && !setRole.isPending && setCandidate(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change role?</AlertDialogTitle>
            <AlertDialogDescription>
              Change {user.name || user.email} from {label} to{' '}
              {roles.find((item) => item.key === candidate)?.name}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setRole.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={setRole.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {setRole.isPending ? 'Saving…' : 'Change role'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
