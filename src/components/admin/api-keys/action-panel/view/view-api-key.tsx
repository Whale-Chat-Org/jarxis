'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';
import { apiRequest } from '@/lib/api-client';
import { gatewayKeyResponseSchema } from '@/lib/providers/contracts';
import type { AdminPanelAction } from '@/types/admin-action-panel';

import { apiKeysEndpoint, apiKeysQueryKey } from '../../use-api-keys';
import { RevokeApiKey } from '../confirm/revoke-api-key';
import { EditApiKey } from '../edit/edit-api-key';
import { ApiKeyMetadata } from './api-key-metadata';
export function ViewApiKey({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [action, setAction] = useState<'edit' | 'revoke' | null>(null);
  const query = useQuery({
    queryKey: [...apiKeysQueryKey, 'detail', id],
    queryFn: ({ signal }) =>
      apiRequest(`${apiKeysEndpoint}/${encodeURIComponent(id)}`, gatewayKeyResponseSchema, {
        signal,
      }),
  });
  const record = query.data?.record;
  const actions: AdminPanelAction[] = [
    { id: 'close', label: 'Close', variant: 'outline', onClick: onClose },
  ];
  if (query.isError)
    actions.push({ id: 'retry', label: 'Try again', onClick: () => void query.refetch() });
  if (canManage && record && !record.revokedAt && !query.isError) {
    actions.push(
      { id: 'edit', label: 'Edit', onClick: () => setAction('edit') },
      { id: 'revoke', label: 'Revoke', variant: 'destructive', onClick: () => setAction('revoke') },
    );
  }
  return (
    <>
      <AdminActionPanel
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        header={{ title: record?.name ?? 'API key', description: 'API key details' }}
        state={{
          loading: query.isPending,
          error: query.isError ? 'API key details could not be loaded. Try again.' : undefined,
        }}
        actions={actions}
      >
        {record && <ApiKeyMetadata record={record} />}
      </AdminActionPanel>
      {record && action === 'edit' && (
        <EditApiKey record={record} onClose={() => setAction(null)} onSaved={onChanged} />
      )}
      {record && action === 'revoke' && (
        <RevokeApiKey record={record} onClose={() => setAction(null)} onRevoked={onChanged} />
      )}
    </>
  );
}
