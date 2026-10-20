'use client';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const aliasError = 'Use 1–200 letters, numbers, dots, underscores, colons or hyphens.';

export function ProviderPoolAliasForm({
  inputId,
  connectionName,
  upstreamId,
  value,
  alias,
  error,
  saving,
  valid,
  unchanged,
  onValueChange,
  onSave,
  onRemove,
  onCancel,
}: {
  inputId: string;
  connectionName: string;
  upstreamId: string;
  value: string;
  alias: string | null;
  error: string;
  saving: boolean;
  valid: boolean;
  unchanged: boolean;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const normalized = value.trim();
  return (
    <Field>
      <FieldLabel htmlFor={inputId}>
        Alias for {upstreamId} on {connectionName}
      </FieldLabel>
      <Input
        id={inputId}
        name="modelAlias"
        autoComplete="off"
        spellCheck={false}
        disabled={saving}
        value={value}
        maxLength={200}
        aria-invalid={normalized.length > 0 && !valid}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <FieldDescription id={`${inputId}-hint`}>
        Use 1–200 letters, numbers, dots, underscores, colons or hyphens.
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
      {normalized.length > 0 && !valid && <FieldError>{aliasError}</FieldError>}
      <div className="flex flex-wrap gap-sm">
        <Button type="button" size="sm" disabled={saving || !valid || unchanged} onClick={onSave}>
          {saving ? 'Saving…' : 'Save alias'}
        </Button>
        {alias && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={saving}
            onClick={onRemove}
          >
            Remove alias
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Field>
  );
}
