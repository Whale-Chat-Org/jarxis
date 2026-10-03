'use client';

import { type RefObject, useEffect, useMemo, useState } from 'react';
import { type AdminAuthClient, setAdminUserRoleOptions } from '@better-auth-ui/core/plugins/admin';
import { useAuth } from '@better-auth-ui/react';
import { useAdminUser } from '@better-auth-ui/react/plugins/admin';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangleIcon, ShieldAlertIcon } from 'lucide-react';
import { toast } from 'sonner';

import { LoadingRegion } from '@/components/skeletons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { safeActionErrorMessage } from '@/lib/action-errors';
import {
  describeRoles,
  ownerBlockedReason,
  roleOptions,
  splitRoleValue,
} from '@/lib/access-display';

const SAVE_FAILED = 'The role was not changed. Try again.';

export type ChangeRoleDialogProps = {
  /** Trigger lives in the table/card, so focus has to be restored explicitly on close. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  userId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerId: string;
};

/**
 * One job: replace the roles stored for a single person.
 *
 * The directory already shows the current role, so this dialog only asks which role to store next.
 * Owner escalation is confirmed inline with a warning line instead of a second modal, and the write
 * goes through the Better Auth admin API, which re-checks every rule on the server.
 */
export function ChangeRoleDialog({
  triggerRef,
  userId,
  open,
  onOpenChange,
  viewerId,
}: ChangeRoleDialogProps) {
  const auth = useAuth<AdminAuthClient>();
  // The detail error renders inline with a retry, so it skips the global error toast.
  const detail = useAdminUser(auth.authClient, userId, {
    enabled: open && Boolean(userId),
    meta: { errorPresentation: 'inline' },
  });
  const user = detail.data;
  const roleOptionsForUser = setAdminUserRoleOptions(auth.authClient, viewerId);
  // The failure is shown inline below, so opt out of the global error toast to avoid reporting it
  // twice. The registry's own `meta` (cache invalidation) is preserved.
  const setRole = useMutation({
    ...roleOptionsForUser,
    meta: { ...roleOptionsForUser.meta, errorPresentation: 'inline' },
  });
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const currentRoles = useMemo(() => splitRoleValue(user?.role), [user?.role]);
  const currentRoleValue = describeRoles(currentRoles)
    .map((role) => role.label)
    .join(', ');

  // Reset only when the dialog moves to another person or the stored roles actually change, so an
  // in-progress choice survives ordinary rerenders and background refetches. Storing the previous
  // key in state is React's documented "adjust state during render" pattern: it avoids a
  // setState-in-effect and the flash of the previous person's draft it would cause.
  const resetKey = `${open}\u0000${userId ?? ''}\u0000${user?.role ?? ''}`;
  const [seenResetKey, setSeenResetKey] = useState<string>('\u0000uninitialised');
  if (seenResetKey !== resetKey) {
    const stored = splitRoleValue(user?.role);
    setSeenResetKey(resetKey);
    setSelectedRole(stored.length === 1 ? stored[0] : null);
  }

  const resetMutation = setRole.reset;
  useEffect(() => {
    // Clear a previous failure when a new edit starts, never during the success refresh: resetting
    // an active mutation observer would discard its success callback before the dialog can close.
    if (open) resetMutation();
  }, [open, userId, resetMutation]);

  const ownerBlocked = user ? ownerBlockedReason(user) : undefined;
  const isPendingSave = setRole.isPending;
  const hasChange = Boolean(
    selectedRole && !(currentRoles.length === 1 && currentRoles[0] === selectedRole),
  );
  const escalatesToOwner = selectedRole === 'owner' && !currentRoles.includes('owner');
  const ownerRefused = selectedRole === 'owner' && Boolean(ownerBlocked);
  const name = user ? user.name || user.email : '';

  const save = () => {
    if (!user || !selectedRole || !hasChange || isPendingSave || ownerRefused) return;
    setRole.mutate(
      // The admin plugin types `role` against its own built-in names; this project declares its
      // own role list and the server validates the value again.
      { userId: user.id, role: [selectedRole] as unknown as ('user' | 'admin')[] },
      {
        onSuccess: async () => {
          // Mutation metadata invalidates the list and detail queries; awaiting the detail refetch
          // keeps the reopened dialog from showing the previous role.
          await detail.refetch();
          toast.success(`Role updated for ${name}`);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A save in flight must not be interrupted by an accidental dismissal.
        if (!next && isPendingSave) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-svh overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = triggerRef.current;
          if (trigger?.isConnected) {
            trigger.focus();
          } else {
            // A successful save refreshes the list and replaces the original trigger node.
            Array.from(document.querySelectorAll<HTMLButtonElement>('[data-access-user-id]'))
              .find(
                (button) =>
                  button.dataset.accessUserId === userId && button.getClientRects().length > 0,
              )
              ?.focus();
          }
        }}
        onEscapeKeyDown={(event) => isPendingSave && event.preventDefault()}
        onInteractOutside={(event) => isPendingSave && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          {detail.isPending ? (
            <DialogDescription>Loading this person’s details.</DialogDescription>
          ) : detail.isError || !user ? (
            <DialogDescription>This person’s details could not be loaded.</DialogDescription>
          ) : (
            <DialogDescription className="break-words">
              {user.name ? `${user.name} · ${user.email}` : user.email}
            </DialogDescription>
          )}
        </DialogHeader>

        {detail.isPending ? (
          <LoadingRegion label="Loading this person’s role…" className="flex flex-col gap-stack">
            <Skeleton className="h-lg w-bar-4xl max-w-full" />
            <Skeleton className="h-2xl w-full" />
            <Skeleton className="h-2xl w-full" />
            <Skeleton className="h-2xl w-full" />
            <Skeleton className="h-2xl w-full" />
          </LoadingRegion>
        ) : detail.isError || !user ? (
          <div className="flex flex-col items-start gap-md">
            <Alert variant="destructive">
              <ShieldAlertIcon />
              <AlertTitle>Details unavailable</AlertTitle>
              <AlertDescription>
                The request did not complete. Check your connection and try again.
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => detail.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-stack">
            <div className="flex flex-col gap-3xs">
              <p className="text-body-sm text-muted-foreground">
                Current: {currentRoles.length === 0 ? 'No role' : currentRoleValue}
              </p>
              {currentRoles.length > 1 ? (
                <p className="text-body-sm text-muted-foreground">
                  Saving replaces all current roles.
                </p>
              ) : null}
            </div>

            <FieldSet>
              <RadioGroup
                aria-label="Role"
                value={selectedRole ?? ''}
                onValueChange={setSelectedRole}
                disabled={isPendingSave}
              >
                {roleOptions.map((role) => {
                  const blocked = role.id === 'owner' ? ownerBlocked : undefined;
                  const inputId = `change-role-${role.id}`;
                  return (
                    <Field key={role.id} orientation="horizontal">
                      <RadioGroupItem
                        id={inputId}
                        value={role.id}
                        disabled={isPendingSave || Boolean(blocked)}
                      />
                      <FieldLabel htmlFor={inputId} className="flex-col items-start gap-3xs">
                        <span className="text-body-sm font-medium">{role.label}</span>
                        <span className="text-caption font-normal text-muted-foreground">
                          {role.description}
                        </span>
                        {blocked ? (
                          <span className="text-caption font-normal text-warning">{blocked}</span>
                        ) : null}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </RadioGroup>
            </FieldSet>

            {escalatesToOwner && !ownerBlocked ? (
              <p className="flex items-start gap-sm text-body-sm text-warning [&>svg]:size-icon [&>svg]:shrink-0">
                <AlertTriangleIcon />
                Owners have full control, including assigning roles and deleting accounts.
              </p>
            ) : null}

            {setRole.isError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Role not changed</AlertTitle>
                <AlertDescription>
                  {safeActionErrorMessage(setRole.error, SAVE_FAILED)}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        {user && !detail.isError ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPendingSave}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!hasChange || isPendingSave || ownerRefused}>
              {isPendingSave ? <Spinner /> : null}
              {escalatesToOwner ? 'Make owner' : 'Save role'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
