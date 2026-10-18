'use client';
import { useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { apiAction } from '@/lib/api-client';
import type { GatewayKey } from '@/lib/providers/contracts';

import { apiKeysEndpoint } from '../../use-api-keys';
export function RevokeApiKey({
  record,
  onClose,
  onRevoked,
}: {
  record: GatewayKey;
  onClose: () => void;
  onRevoked: () => Promise<unknown>;
}) {
  const submission = useAdminSubmission();
  const [error, setError] = useState('');
  return (
    <AdminActionPanel
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      header={{
        title: 'Revoke API key?',
        description: `${record.name}: Clients using this key will lose access immediately. The record will be retained.`,
      }}
      state={{ pending: submission.pending, pendingRef: submission.pendingRef, error }}
      actions={[
        { id: 'cancel', label: 'Cancel', variant: 'outline', onClick: onClose },
        {
          id: 'revoke',
          label: 'Revoke',
          pendingLabel: 'Revoking…',
          variant: 'destructive',
          onClick: () => {
            setError('');
            void submission.run(
              async () => {
                await apiAction(`${apiKeysEndpoint}/${encodeURIComponent(record.id)}`, {
                  method: 'DELETE',
                });
                await onRevoked();
                onClose();
              },
              (failure) =>
                setError(
                  safeActionErrorMessage(failure, 'The key could not be revoked. Try again.'),
                ),
            );
          },
        },
      ]}
    />
  );
}
