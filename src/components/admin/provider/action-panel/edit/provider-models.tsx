'use client';
import { noAutofill } from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

import { ProviderManualModel } from './provider-manual-model';
export function ProviderModels({ flow }: { flow: ProviderManagementState }) {
  const {
    editor,
    editorModels,
    enabledEditorCount,
    modelSearch,
    setModelSearch,
    visibleEditorModels,
    setEditorModels,
    busy,
    shownDialogError,
    dialogError,
    perform,
    reloadEditorModels,
  } = flow;
  if (!editor) return null;
  return (
    <>
      {' '}
      {editor.id && editorModels && (
        <section
          aria-label="Connection models"
          className="flex min-w-none grow basis-none flex-col gap-sm"
        >
          <h3 className="text-body-sm font-semibold">
            Models ({enabledEditorCount}/{editorModels.models.length})
          </h3>
          <Input
            aria-label="Search models"
            {...noAutofill}
            name="model-search"
            type="search"
            placeholder="Search by name or ID"
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
          />
          <div className="flex flex-wrap gap-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || visibleEditorModels.length === 0}
              onClick={() => {
                const ids = new Set(visibleEditorModels.map((model) => model.id));
                setEditorModels(
                  (current) =>
                    current && {
                      ...current,
                      models: current.models.map((model) =>
                        ids.has(model.id) ? { ...model, enabled: true } : model,
                      ),
                    },
                );
              }}
            >
              Enable all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || visibleEditorModels.length === 0}
              onClick={() => {
                const ids = new Set(visibleEditorModels.map((model) => model.id));
                setEditorModels(
                  (current) =>
                    current && {
                      ...current,
                      models: current.models.map((model) =>
                        ids.has(model.id) ? { ...model, enabled: false } : model,
                      ),
                    },
                );
              }}
            >
              Disable all
            </Button>
          </div>
          <div className="flex min-h-list-min min-w-none grow basis-none flex-col gap-sm overflow-y-auto">
            {visibleEditorModels.length === 0 && (
              <p className="text-body-sm text-muted-foreground">No matching models.</p>
            )}
            {visibleEditorModels.map((model) => (
              <div key={model.id} className="flex min-w-none items-center justify-between gap-sm">
                <div className="min-w-none">
                  <p className="text-body-sm wrap-break-word">{model.displayName}</p>
                  <p className="font-mono text-caption break-all text-muted-foreground">
                    {model.publicId}
                  </p>
                </div>
                <Switch
                  aria-label={`Enable ${model.displayName} (${model.publicId})`}
                  checked={model.enabled}
                  disabled={busy}
                  onCheckedChange={(enabled) =>
                    setEditorModels(
                      (current) =>
                        current && {
                          ...current,
                          models: current.models.map((item) =>
                            item.id === model.id ? { ...item, enabled } : item,
                          ),
                        },
                    )
                  }
                />
              </div>
            ))}
          </div>

          {shownDialogError && dialogError?.code === 'MODEL_CATALOG_CHANGED' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void perform(() => reloadEditorModels(editor.id!))}
            >
              Reload models
            </Button>
          )}
          <ProviderManualModel flow={flow} />
        </section>
      )}
    </>
  );
}
