import type { GatewayKey } from '@/lib/providers/contracts';
export function ApiKeyMetadata({ record }: { record: GatewayKey }) {
  const date = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : '—';
  return (
    <dl className="flex min-w-none flex-col gap-lg">
      {[
        ['Name', record.name],
        ['Prefix', `${record.prefix}…`],
        ['Status', record.revokedAt ? 'Revoked' : 'Active'],
        ['Created', date(record.createdAt)],
        ['Last used', record.lastUsedAt ? date(record.lastUsedAt) : 'Never used'],
        ['Revoked', date(record.revokedAt)],
      ].map(([label, value]) => (
        <div key={label} className="min-w-none">
          <dt className="text-body-sm text-muted-foreground">{label}</dt>
          <dd className="text-body-sm wrap-break-word">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
