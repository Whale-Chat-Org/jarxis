'use client';
import {
  noAutofill,
  Provider,
  providers,
} from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
export function ProviderConnectionFields({ flow }: { flow: ProviderManagementState }) {
  const { editor, setEditor } = flow;
  if (!editor) return null;
  return (
    <>
      {' '}
      <Field>
        <FieldLabel htmlFor="connection-name">Name</FieldLabel>
        <Input
          id="connection-name"
          {...noAutofill}
          maxLength={100}
          required
          value={editor.name}
          onChange={(event) => setEditor({ ...editor, name: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="connection-provider">Provider</FieldLabel>
        <Select
          value={editor.provider}
          disabled={!!editor.id}
          onValueChange={(provider: Provider) =>
            setEditor({ ...editor, provider, baseUrl: '', apiKey: '' })
          }
        >
          <SelectTrigger id="connection-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {provider}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="connection-url">
          Base URL {editor.provider !== 'custom' && '(optional)'}
        </FieldLabel>
        <Input
          id="connection-url"
          {...noAutofill}
          type="url"
          required={editor.provider === 'custom'}
          placeholder="https://…"
          value={editor.baseUrl}
          onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="connection-priority">Priority</FieldLabel>
        <Input
          id="connection-priority"
          {...noAutofill}
          type="number"
          min={-10000}
          max={10000}
          step="1"
          required
          value={editor.priority}
          onChange={(event) => setEditor({ ...editor, priority: event.target.value })}
        />
      </Field>
    </>
  );
}
