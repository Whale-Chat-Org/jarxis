'use client';
import { AlertCircleIcon } from 'lucide-react';

import { AdminState } from '@/components/admin/admin-state';
import { Button } from '@/components/ui/button';

import { CreateApiKey } from './action-panel/create/create-api-key';
import { ViewApiKey } from './action-panel/view/view-api-key';
import { ApiKeysLoading } from './api-keys-loading';
import { ApiKeysFilters } from './table/api-keys-filters';
import { ApiKeysTable } from './table/api-keys-table';
import { useApiKeys } from './use-api-keys';
export function ApiKeysPanel({ canManage }: { canManage: boolean }) {
  const state = useApiKeys();
  return (
    <div className="flex min-w-none flex-col gap-stack">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-heading font-semibold tracking-tight">API Keys</h2>
          <p className="text-body-sm text-muted-foreground">
            Manage access to the OpenAI-compatible gateway.
          </p>
        </div>
        {canManage && <Button onClick={() => state.setCreating(true)}>Create API key</Button>}
      </div>
      <ApiKeysFilters state={state} />
      {state.query.isError ? (
        <AdminState
          icon={<AlertCircleIcon />}
          title="API keys could not be loaded"
          description="Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void state.query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : state.query.isPending ? (
        <ApiKeysLoading />
      ) : (
        <ApiKeysTable state={state} />
      )}
      {state.creating && (
        <CreateApiKey onClose={() => state.setCreating(false)} onCreated={state.refresh} />
      )}
      {state.selectedId && (
        <ViewApiKey
          key={state.selectedId}
          id={state.selectedId}
          canManage={canManage}
          onClose={() => state.setSelectedId(null)}
          onChanged={state.refresh}
        />
      )}
    </div>
  );
}
