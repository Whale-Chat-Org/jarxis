'use client';
import { useId, useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { apiRequest } from '@/lib/api-client';
import { gatewayKeyResponseSchema, type GatewayKey } from '@/lib/providers/contracts';

import { apiKeysEndpoint } from '../../use-api-keys';
export function EditApiKey({
  record,
  onClose,
  onSaved,
}: {
  record: GatewayKey;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const formId = useId();
  const submission = useAdminSubmission();
  const [name, setName] = useState(record.name);
  const [error, setError] = useState('');
  return (
    <AdminActionPanel
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      header={{
        title: 'Edit API key',
        description: 'Change the name. The key itself stays the same.',
      }}
      state={{ pending: submission.pending, pendingRef: submission.pendingRef, error }}
      actions={[
        { id: 'cancel', label: 'Cancel', variant: 'outline', onClick: onClose },
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          type: 'submit',
          formId,
          disabled: !name.trim() || name.trim() === record.name || !!record.revokedAt,
        },
      ]}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || record.revokedAt) return;
          setError('');
          void submission.run(
            async () => {
              await apiRequest(
                `${apiKeysEndpoint}/${encodeURIComponent(record.id)}`,
                gatewayKeyResponseSchema,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: name.trim() }),
                },
              );
              await onSaved();
              onClose();
            },
            (failure) =>
              setError(safeActionErrorMessage(failure, 'Changes could not be saved. Try again.')),
          );
        }}
      >
        <Field>
          <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
          <Input
            id={`${formId}-name`}
            name="name"
            autoComplete="off"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submission.pending}
          />
        </Field>
      </form>
    </AdminActionPanel>
  );
}
