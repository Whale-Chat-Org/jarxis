'use client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Connection } from '@/lib/providers/contracts';

import type { ProviderManagementState } from './use-provider-management';
export function ProviderConnectionModels({
  flow,
  connection,
}: {
  flow: ProviderManagementState;
  connection: Connection;
}) {
  const { expandedCards, setExpandedCards } = flow;
  return (
    <Collapsible
      open={expandedCards[connection.id] ?? false}
      onOpenChange={(open) =>
        setExpandedCards((current) => ({ ...current, [connection.id]: open }))
      }
      className="flex min-w-none flex-col gap-sm"
    >
      <h3 className="text-body-sm font-semibold">
        Models ({connection.models.filter((model) => model.enabled).length}/
        {connection.models.length})
      </h3>
      {connection.models.length === 0 && (
        <p className="text-body-sm text-muted-foreground">
          No models yet. Refresh the catalog, or add an upstream model ID from Edit.
        </p>
      )}
      {connection.models.slice(0, 3).map((model) => (
        <div key={model.id} className="flex min-w-none items-start justify-between gap-md">
          <div className="min-w-none">
            <p className="text-body-sm wrap-break-word">{model.displayName}</p>
            <p className="font-mono text-caption break-all text-muted-foreground">
              {model.publicId}
            </p>
            <Badge variant="outline">{model.discovered ? 'Discovered' : 'Manual'}</Badge>
          </div>
          <Badge variant="outline" className="shrink-0">
            {model.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      ))}
      {connection.models.length > 3 && (
        <>
          <CollapsibleContent className="flex min-w-none flex-col gap-sm">
            {connection.models.slice(3).map((model) => (
              <div key={model.id} className="flex min-w-none items-start justify-between gap-md">
                <div className="min-w-none">
                  <p className="text-body-sm wrap-break-word">{model.displayName}</p>
                  <p className="font-mono text-caption break-all text-muted-foreground">
                    {model.publicId}
                  </p>
                  <Badge variant="outline">{model.discovered ? 'Discovered' : 'Manual'}</Badge>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {model.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            ))}
          </CollapsibleContent>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="self-start">
              {expandedCards[connection.id]
                ? 'Show less'
                : `Show all (${connection.models.length})`}
            </Button>
          </CollapsibleTrigger>
        </>
      )}
    </Collapsible>
  );
}
