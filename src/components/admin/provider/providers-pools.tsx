'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProviderData } from '@/lib/providers/contracts';

import { ProviderPoolMember } from './provider-pool-member';

export function ProvidersPools({
  data,
  canManage,
  reload,
}: {
  data: ProviderData;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.pools.filter((pool) =>
      `${pool.id} ${pool.members.map((member) => `${member.connectionName} ${member.upstreamId}`).join(' ')}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.pools, search]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const modelByKey = new Map(
    data.connections.flatMap((connection) =>
      connection.models.map((model) => [
        `${connection.id}:${model.id}`,
        { alias: model.alias, version: connection.modelStateVersion },
      ]),
    ),
  );

  return (
    <Card role="region" aria-labelledby="model-pools-heading">
      <CardHeader>
        <CardTitle>
          <h2 id="model-pools-heading">Model pools</h2>
        </CardTitle>
        <CardDescription>
          Models sharing an ID can route across their available provider connections.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-none flex-col gap-lg">
        <Field>
          <FieldLabel htmlFor="pool-search">Search model pools</FieldLabel>
          <Input
            id="pool-search"
            name="poolSearch"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </Field>
        {data.pools.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No model pools are available yet.</p>
        ) : (
          filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((pool) => (
            <section
              key={pool.id}
              aria-labelledby={`pool-${pool.id}`}
              className="flex min-w-none flex-col gap-md border-t border-border pt-lg first:border-t-0 first:pt-none"
            >
              <div className="min-w-none">
                <h3 id={`pool-${pool.id}`} className="font-mono text-body wrap-break-word">
                  {pool.id}
                </h3>
                {!pool.advertised && (
                  <p role="status" className="text-body-sm font-medium text-warning">
                    Alias required before this pool can be advertised.
                  </p>
                )}
              </div>
              <ul className="flex min-w-none flex-col gap-sm">
                {pool.members.map((member) => {
                  const state = modelByKey.get(`${member.connectionId}:${member.modelId}`);
                  return (
                    <ProviderPoolMember
                      key={`${member.connectionId}:${member.modelId}`}
                      member={member}
                      alias={state?.alias ?? null}
                      version={state?.version ?? ''}
                      canManage={canManage && Boolean(state)}
                      reload={reload}
                    />
                  );
                })}
              </ul>
            </section>
          ))
        )}
        {data.pools.length > 0 && filtered.length === 0 && (
          <p role="status" className="text-body-sm text-muted-foreground">
            No matching model pools.
          </p>
        )}
        {filtered.length > 25 && (
          <nav aria-label="Model pool pages" className="flex flex-wrap items-center gap-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous pools
            </Button>
            <p className="text-body-sm" role="status">
              Page {currentPage + 1} of {lastPage + 1}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Next pools
            </Button>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}
