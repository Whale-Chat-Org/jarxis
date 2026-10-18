'use client';
import { useId, useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { apiRequest } from '@/lib/api-client';
import { createdGatewayKeySchema } from '@/lib/providers/contracts';

import { apiKeysEndpoint } from '../../use-api-keys';
export function CreateApiKey({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<unknown>;
}) {
  const formId = useId();
  const submission = useAdminSubmission();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  function close() {
    if (submission.pendingRef.current) return;
    setSecret(null);
    onClose();
  }
  function create() {
    setError('');
    void submission.run(
      async () => {
        const result = await apiRequest(apiKeysEndpoint, createdGatewayKeySchema, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        setSecret(result.key);
        void onCreated();
      },
      (failure) =>
        setError(safeActionErrorMessage(failure, 'The API key could not be created. Try again.')),
    );
  }
  return (
    <AdminActionPanel
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      header={{
        title: secret ? 'Save your API key' : 'Create API key',
        description: secret
          ? 'Copy this key now. It cannot be retrieved after closing.'
          : 'Give this gateway key a descriptive name.',
      }}
      state={{ pending: submission.pending, pendingRef: submission.pendingRef, error }}
      actions={
        secret
          ? [
              {
                id: 'copy',
                label: copied ? 'Copied' : 'Copy key',
                variant: 'outline',
                onClick: () => {
                  setError('');
                  void submission.run(
                    async () => {
                      await navigator.clipboard.writeText(secret);
                      setCopied(true);
                    },
                    () => setError('The key could not be copied. Select it and copy it manually.'),
                  );
                },
              },
              { id: 'done', label: 'Done', onClick: close },
            ]
          : [
              { id: 'cancel', label: 'Cancel', variant: 'outline', onClick: close },
              {
                id: 'create',
                label: 'Create API key',
                pendingLabel: 'Creating…',
                type: 'submit',
                formId,
                disabled: !name.trim(),
              },
            ]
      }
    >
      {secret ? (
        <Field>
          <FieldLabel htmlFor={`${formId}-secret`}>API key</FieldLabel>
          <Textarea
            id={`${formId}-secret`}
            readOnly
            value={secret}
            className="font-mono break-all"
          />
        </Field>
      ) : (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create();
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
      )}
    </AdminActionPanel>
  );
}
