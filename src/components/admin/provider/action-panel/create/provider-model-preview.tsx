'use client';
import { AlertCircleIcon } from 'lucide-react';

import {
  genericPreviewFailure,
  noAutofill,
} from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
export function ProviderModelPreview({ flow }: { flow: ProviderManagementState }) {
  const { editor, shownPreview, retryPreview, setEditor } = flow;
  if (!editor) return null;
  return (
    <>
      {' '}
      {!editor.id && (
        <section
          aria-label="Model preview"
          aria-live="polite"
          className="flex min-w-none flex-col gap-sm rounded-md border border-border bg-muted p-md"
        >
          <h3 className="text-body-sm font-semibold">
            {shownPreview?.status === 'ok'
              ? `Available models (${shownPreview.models.length})`
              : 'Available models'}
          </h3>
          {!shownPreview && (
            <p className="text-body-sm text-muted-foreground">
              {editor.provider === 'custom'
                ? 'Enter an API key and an HTTPS base URL to preview available models.'
                : 'Enter an API key to preview available models.'}
            </p>
          )}
          {shownPreview?.status === 'loading' && (
            <p className="flex items-center gap-sm text-body-sm text-muted-foreground">
              <Spinner aria-label="Checking available models" />
              Checking available models…
            </p>
          )}
          {shownPreview?.status === 'ok' && shownPreview.models.length === 0 && (
            <p className="text-body-sm text-muted-foreground">
              No models were returned. Add model IDs manually below.
            </p>
          )}
          {shownPreview?.status === 'ok' && shownPreview.models.length > 0 && (
            <ul
              aria-label="Discovered models"
              className="flex max-h-list-max min-w-none flex-col gap-xs overflow-y-auto"
            >
              {shownPreview.models.map((model, index) => (
                <li key={`${index}-${model.id}`} className="min-w-none">
                  <p className="text-body-sm wrap-break-word">{model.name}</p>
                  {model.name !== model.id && (
                    <p className="font-mono text-caption break-all text-muted-foreground">
                      {model.id}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {shownPreview?.status === 'unsupported' && (
            <p className="text-body-sm text-muted-foreground">
              This endpoint does not provide model discovery. Add model IDs manually below.
            </p>
          )}
          {shownPreview?.status === 'failed' && (
            <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-sm text-body-sm wrap-break-word">
                <AlertCircleIcon aria-hidden className="size-icon shrink-0 text-warning" />
                {shownPreview.message ?? genericPreviewFailure}
              </p>
              <Button type="button" variant="outline" onClick={retryPreview}>
                Retry
              </Button>
            </div>
          )}
        </section>
      )}
      {!editor.id && (
        <Field>
          <FieldLabel htmlFor="connection-models">
            Manual model IDs (one per line, optional)
          </FieldLabel>
          <Textarea
            id="connection-models"
            {...noAutofill}
            value={editor.manualModels}
            onChange={(event) => setEditor({ ...editor, manualModels: event.target.value })}
          />
        </Field>
      )}
    </>
  );
}
