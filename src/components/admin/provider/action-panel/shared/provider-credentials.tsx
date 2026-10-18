'use client';
import { EyeIcon, EyeOffIcon } from 'lucide-react';

import { noAutofill } from '@/components/admin/provider/providers-editor-state';
import type { ProviderManagementState } from '@/components/admin/provider/use-provider-management';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
export function ProviderCredentials({ flow }: { flow: ProviderManagementState }) {
  const { editor, setEditor, keyVisible, setKeyVisible } = flow;
  if (!editor) return null;
  return (
    <>
      {' '}
      <Field>
        <FieldLabel htmlFor="connection-key">
          {editor.id ? 'Replace API key (optional)' : 'API key'}
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="connection-key"
            {...noAutofill}
            // Chrome ignores "off" on password inputs; "new-password" stops saved logins.
            autoComplete="new-password"
            type={keyVisible ? 'text' : 'password'}
            required={!editor.id}
            placeholder={editor.id ? 'Saved key is kept unless you enter a new one' : ''}
            value={editor.apiKey}
            onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={keyVisible ? 'Hide API key' : 'Show API key'}
              aria-pressed={keyVisible}
              onClick={() => setKeyVisible((visible) => !visible)}
            >
              {keyVisible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </>
  );
}
