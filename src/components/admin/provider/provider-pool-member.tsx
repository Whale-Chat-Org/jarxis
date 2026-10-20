'use client';

import { Badge } from '@/components/ui/badge';
import type { ProviderData } from '@/lib/providers/contracts';

import { ProviderPoolAliasEditor } from './provider-pool-alias-editor';

type PoolMember = ProviderData['pools'][number]['members'][number];

export function ProviderPoolMember({
  member,
  alias,
  version,
  canManage,
  reload,
}: {
  member: PoolMember;
  alias: string | null;
  version: string;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  return (
    <li className="flex min-w-none flex-col gap-md rounded-lg border border-border p-md">
      <div className="flex min-w-none flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-none">
          <p className="text-body-sm font-semibold wrap-break-word">{member.connectionName}</p>
          <p className="font-mono text-caption break-all text-muted-foreground">
            {member.provider} · {member.upstreamId}
          </p>
          <p className="text-caption text-muted-foreground">Priority {member.priority}</p>
        </div>
        <Badge variant="outline" className="max-w-full whitespace-normal">
          Availability: {member.availability.replaceAll('_', ' ')}
        </Badge>
      </div>
      <ProviderPoolAliasEditor
        connectionId={member.connectionId}
        connectionName={member.connectionName}
        modelId={member.modelId}
        upstreamId={member.upstreamId}
        version={version}
        alias={alias}
        canManage={canManage}
        reload={reload}
      />
    </li>
  );
}
