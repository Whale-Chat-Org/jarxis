'use client';
import { noAutofill } from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
export function ProviderManualModel({ flow }: { flow: ProviderManagementState }) {
  const { editor, manualModel, setManualModel, addManualModel, busy } = flow;
  if (!editor) return null;
  return (
    <>
      {' '}
      <Field className="shrink-0">
        <FieldLabel htmlFor="connection-manual-model">Manual upstream model ID</FieldLabel>
        <div className="flex min-w-none gap-sm">
          <Input
            id="connection-manual-model"
            {...noAutofill}
            name="manual-model"
            value={manualModel}
            onChange={(event) => setManualModel(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the model instead of saving the whole connection.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addManualModel(editor.id!);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !manualModel.trim()}
            onClick={() => addManualModel(editor.id!)}
          >
            Add model
          </Button>
        </div>
      </Field>
    </>
  );
}
