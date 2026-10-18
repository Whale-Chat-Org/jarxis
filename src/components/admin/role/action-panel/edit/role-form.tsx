'use client';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { RolesManagementState } from '@/types/admin-roles';
export function RoleForm({ state, formId }: { state: RolesManagementState; formId: string }) {
  const { draft, setDraft, areas, save } = state;
  if (!draft) return null;
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {' '}
      <div className="flex flex-col gap-lg">
        <Field>
          <FieldLabel htmlFor="role-name">Name</FieldLabel>
          <Input
            id="role-name"
            value={draft.name}
            disabled={draft.readOnly || draft.system}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            maxLength={64}
          />
          {draft.system && !draft.readOnly && (
            <FieldDescription>System roles keep their name.</FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="role-description">Description</FieldLabel>
          <Textarea
            id="role-description"
            value={draft.description}
            disabled={draft.readOnly}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            maxLength={500}
          />
        </Field>
        {areas.map(([area, entries]) => (
          <FieldSet key={area} className="gap-sm">
            <FieldLegend variant="label">{area}</FieldLegend>
            {entries?.map((entry) => (
              <Field key={entry.key} orientation="horizontal">
                <Checkbox
                  id={`grant-${entry.key}`}
                  checked={draft.permissions.includes(entry.key)}
                  disabled={draft.readOnly || entry.restricted}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      permissions: checked
                        ? [...draft.permissions, entry.key]
                        : draft.permissions.filter((key) => key !== entry.key),
                    })
                  }
                />
                <FieldLabel htmlFor={`grant-${entry.key}`} className="flex-wrap">
                  {entry.description}{' '}
                  <span className="text-caption font-normal text-muted-foreground">
                    ({entry.key}
                    {entry.restricted ? ' · Owner only' : ''})
                  </span>
                </FieldLabel>
              </Field>
            ))}
          </FieldSet>
        ))}
      </div>
    </form>
  );
}
