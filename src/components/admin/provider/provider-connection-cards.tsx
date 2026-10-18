'use client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

import { ProviderConnectionModels } from './provider-connection-models';
import type { ProviderManagementState } from './use-provider-management';
export function ProviderConnectionCards({ flow }: { flow: ProviderManagementState }) {
  const { data, canManage, busy, perform, mutate, openEditor, setConfirmation } = flow;
  if (!data) return null;
  return (
    <div className="grid min-w-none gap-stack lg:grid-cols-2 group-data-[panel-open=true]/admin-workspace:lg:grid-cols-1">
      {data.connections.map((connection) => (
        <Card key={connection.id} className="min-w-none">
          <CardHeader>
            <CardTitle className="wrap-break-word">{connection.name}</CardTitle>
            <CardDescription className="break-all">
              {connection.provider} · {connection.baseUrl}
            </CardDescription>
            <div className="flex flex-wrap gap-sm">
              <Badge variant="outline">{connection.status.replaceAll('_', ' ')}</Badge>
              <Badge variant="secondary">Discovery: {connection.discoveryStatus}</Badge>
              <Badge variant="outline">Priority {connection.priority}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex min-w-none flex-col gap-stack">
            {connection.discoveryError && (
              <p className="text-body-sm wrap-break-word">
                Discovery failed: {connection.discoveryError}
              </p>
            )}
            {connection.discoveryStatus === 'unsupported' && (
              <p role="status" className="text-body-sm text-muted-foreground">
                This endpoint does not provide model discovery. Enter model IDs manually.
              </p>
            )}
            <p className="text-caption text-muted-foreground">
              {connection.lastDiscoveredAt
                ? `Last discovery: ${new Date(connection.lastDiscoveredAt).toLocaleString()}`
                : 'No catalog discovered yet.'}{' '}
              Catalogs refresh automatically every hour. Manual models remain available when
              discovery is unsupported.
            </p>
            <div className="flex flex-wrap items-center gap-sm">
              <Switch
                aria-label={`Enable ${connection.name}`}
                checked={connection.enabled}
                disabled={!canManage || busy}
                onCheckedChange={(enabled) =>
                  void perform(() => mutate(`/${connection.id}`, 'PATCH', { enabled }))
                }
              />
              <span className="text-body-sm">{connection.enabled ? 'Enabled' : 'Disabled'}</span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => openEditor(connection, 'view')}
              >
                View
              </Button>
              {canManage && (
                <>
                  <Button variant="outline" disabled={busy} onClick={() => openEditor(connection)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () => mutate(`/${connection.id}/refresh`, 'POST'),
                        'Discovery scheduled.',
                      )
                    }
                  >
                    Refresh models
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        kind: 'connection',
                        id: connection.id,
                        name: connection.name,
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
            <ProviderConnectionModels flow={flow} connection={connection} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
