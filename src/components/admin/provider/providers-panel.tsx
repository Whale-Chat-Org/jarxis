'use client';
import { AlertCircleIcon } from 'lucide-react';

import { adminTableDefinitions } from '@/components/admin/table/table-definitions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { ProviderDeleteConfirmation } from './action-panel/confirm/provider-delete-confirmation';
import { ProviderConnectionEditor } from './action-panel/shared/provider-connection-editor';
import { ProviderConnectionCards } from './provider-connection-cards';
import { emptyEditor } from './providers-editor-state';
import { ProvidersLoading } from './providers-loading';
import { useProviderManagement } from './use-provider-management';
export function ProvidersPanel({ canManage }: { canManage: boolean }) {
  const flow = useProviderManagement(canManage);
  const {
    busy,
    perform,
    reload,
    setKeyVisible,
    setEditorMode,
    initializeEditor,
    loadError,
    notice,
    data,
  } = flow;
  if (!data && !loadError) return <ProvidersLoading />;
  return (
    <div
      className="flex min-w-none flex-col gap-stack"
      data-admin-presentation={adminTableDefinitions.providers.presentation}
    >
      <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-none">
          <h2 className="text-heading font-semibold tracking-tight">Providers</h2>
          <p className="text-body-sm text-muted-foreground">
            Manage provider accounts and available models.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          <Button variant="outline" disabled={busy} onClick={() => void perform(() => reload())}>
            Reload
          </Button>
          {canManage && (
            <Button
              disabled={busy}
              onClick={() => {
                setKeyVisible(false);
                setEditorMode('create');
                initializeEditor({ ...emptyEditor });
              }}
            >
              Add connection
            </Button>
          )}
        </div>
      </div>
      {loadError && (
        <Alert role="alert">
          <AlertCircleIcon />
          <AlertTitle>Providers not up to date</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-sm wrap-break-word">
            {loadError}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void perform(
                  () => reload(),
                  undefined,
                  'Providers could not be loaded. Try again shortly.',
                )
              }
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-body-sm wrap-break-word">
          {notice}
        </p>
      )}
      {data && (
        <>
          {data.connections.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No provider connections</CardTitle>
                <CardDescription>Add an API-key provider to get started.</CardDescription>
              </CardHeader>
            </Card>
          )}
          <ProviderConnectionCards flow={flow} />
        </>
      )}
      <ProviderConnectionEditor flow={flow} />
      <ProviderDeleteConfirmation flow={flow} />
    </div>
  );
}
