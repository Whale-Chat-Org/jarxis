'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { connectionResponseSchema } from '@/lib/providers/contracts';

import { request } from './providers-editor-state';
import { ProviderPoolAliasForm } from './provider-pool-alias-form';

export const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function ProviderPoolAliasEditor({
  connectionId,
  connectionName,
  modelId,
  upstreamId,
  version,
  alias,
  canManage,
  reload,
}: {
  connectionId: string;
  connectionName: string;
  modelId: string;
  upstreamId: string;
  version: string;
  alias: string | null;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(alias ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const normalized = value.trim();
  const valid = aliasPattern.test(normalized);

  function cancel() {
    setValue(alias ?? '');
    setError('');
    setEditing(false);
  }

  async function changeAlias(nextAlias: string | null) {
    setSaving(true);
    setError('');
    try {
      await request(
        connectionResponseSchema,
        `/${encodeURIComponent(connectionId)}/models/${encodeURIComponent(modelId)}/alias`,
        'PATCH',
        { alias: nextAlias, version },
      );
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.code === 'MODEL_CATALOG_CHANGED') {
        try {
          await reload();
          const message = 'Models changed. The latest data is loaded; review the alias and retry.';
          setError(message);
          toast.info(message);
        } catch {
          setError('Models changed, but the latest data could not be loaded. Reload Providers.');
        }
      } else {
        setError('The alias could not be updated. Try again.');
      }
      setSaving(false);
      return;
    }

    setEditing(false);
    try {
      await reload();
    } catch {
      setError('The alias was saved, but the latest data could not be loaded. Reload Providers.');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage)
    return (
      <p className="text-body-sm text-muted-foreground">
        Alias: <span className="wrap-break-word text-foreground">{alias ?? 'None'}</span>
      </p>
    );

  if (!editing)
    return (
      <div className="flex min-w-none flex-wrap items-center gap-sm">
        <p className="min-w-none text-body-sm">
          Alias: <span className="font-medium wrap-break-word">{alias ?? 'None'}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setValue(alias ?? '');
            setEditing(true);
          }}
        >
          Edit alias
        </Button>
        {error && (
          <p role="alert" className="basis-full text-body-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <ProviderPoolAliasForm
      inputId={inputId}
      connectionName={connectionName}
      upstreamId={upstreamId}
      value={value}
      alias={alias}
      error={error}
      saving={saving}
      valid={valid}
      unchanged={normalized === alias}
      onValueChange={(next) => {
        setValue(next);
        setError('');
      }}
      onSave={() => void changeAlias(normalized)}
      onRemove={() => void changeAlias(null)}
      onCancel={cancel}
    />
  );
}
