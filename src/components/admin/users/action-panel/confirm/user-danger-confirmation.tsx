'use client';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import type { InspectorDangerState } from '@/types/admin-users';

export function UserDangerConfirmation({ state }: { state: InspectorDangerState }) {
  const {
    dangerousAction,
    isConfirming,
    confirmationInFlight,
    closeDangerousAction,
    dangerLabel,
    user,
    config,
    banReason,
    setBanReason,
    banDuration,
    setBanDuration,
    dangerousError,
    isSelf,
    banDurationSeconds,
    confirm,
  } = state;
  if (!user) return null;
  return (
    <AdminActionPanel
      open={Boolean(dangerousAction)}
      onOpenChange={(value) => {
        if (!value) closeDangerousAction();
      }}
      header={{ title: dangerLabel, description: user.email }}
      state={{ pending: isConfirming, pendingRef: confirmationInFlight, error: dangerousError }}
      actions={[
        {
          id: 'cancel',
          label: config.localization.cancel,
          variant: 'outline',
          onClick: closeDangerousAction,
        },
        {
          id: 'confirm',
          label: dangerLabel,
          variant: dangerousAction === 'delete' ? 'destructive' : 'default',
          disabled: isSelf || (dangerousAction === 'ban' && banDurationSeconds === null),
          onClick: confirm,
        },
      ]}
    >
      {dangerousAction === 'ban' ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="admin-ban-reason">{config.localization.banReason}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="admin-ban-reason"
                onChange={(event) => setBanReason(event.target.value)}
                value={banReason}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="admin-ban-duration">{config.localization.banDuration}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="admin-ban-duration"
                min="1"
                onChange={(event) => setBanDuration(event.target.value)}
                step="1"
                type="number"
                value={banDuration}
              />
            </InputGroup>
            <p className="text-caption text-muted-foreground">
              {config.localization.banDurationDescription}
            </p>
          </Field>
        </FieldGroup>
      ) : null}
    </AdminActionPanel>
  );
}
