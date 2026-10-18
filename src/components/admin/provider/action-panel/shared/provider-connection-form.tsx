'use client';
import { FieldSet } from '@/components/ui/field';

import type { ProviderManagementState } from '../../use-provider-management';
import { ProviderModelPreview } from '../create/provider-model-preview';
import { ProviderModels } from '../edit/provider-models';
import { ProviderConnectionFields } from './provider-connection-fields';
import { ProviderCredentials } from './provider-credentials';
export function ProviderConnectionForm({
  flow,
  formId,
}: {
  flow: ProviderManagementState;
  formId: string;
}) {
  const { editor, editorMode, dirty, saveConnection } = flow;
  if (!editor) return null;
  return (
    <form id={formId} autoComplete="off" onSubmit={saveConnection}>
      <FieldSet disabled={editorMode === 'view'} data-dirty={dirty}>
        <ProviderConnectionFields flow={flow} />
        <ProviderCredentials flow={flow} />
        <ProviderModels flow={flow} />
        <ProviderModelPreview flow={flow} />
      </FieldSet>
    </form>
  );
}
