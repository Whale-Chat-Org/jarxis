'use client';
import { RolePicker } from '@/components/admin/role-picker';
import { getAuthAdditionalFieldValidators } from '@/lib/auth/auth-form-utils';
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { passwordPolicy } from '@/lib/password-policy';
import type { CreateUserState } from '@/types/admin-users';
export function CreateUserForm({ state, formId }: { state: CreateUserState; formId: string }) {
  const { form, config, canSetRole, roles, additionalFields, auth, createUser } = state;
  return (
    <form.AuthFormRoot id={formId}>
      <FieldGroup>
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="admin-create-name">{config.localization.name}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="admin-create-name"
                  name={field.name}
                  onChange={(event) => field.handleChange(event.target.value)}
                  required
                  value={field.state.value}
                />
              </InputGroup>
            </Field>
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="admin-create-email">{config.localization.email}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  autoComplete="off"
                  id="admin-create-email"
                  name={field.name}
                  onChange={(event) => field.handleChange(event.target.value)}
                  required
                  type="email"
                  value={field.state.value}
                />
              </InputGroup>
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="admin-create-password">
                {config.localization.password}
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  autoComplete="new-password"
                  id="admin-create-password"
                  minLength={passwordPolicy.minLength}
                  maxLength={passwordPolicy.maxLength}
                  name={field.name}
                  onChange={(event) => field.handleChange(event.target.value)}
                  required
                  type="password"
                  value={field.state.value}
                />
              </InputGroup>
            </Field>
          )}
        </form.Field>

        {canSetRole.isPending ? (
          <Skeleton className="h-2xl w-full" />
        ) : canSetRole.data?.success ? (
          <FieldSet>
            <FieldLegend variant="label">{config.localization.role}</FieldLegend>
            <form.Field name="roles">
              {(field) => (
                <RolePicker
                  roles={roles}
                  value={field.state.value}
                  onChange={(next) => {
                    if (next.length) field.handleChange(next);
                  }}
                  multiple={config.allowMultipleRoles}
                  radio
                  label={config.localization.role}
                  idPrefix="admin-create-role"
                />
              )}
            </form.Field>
          </FieldSet>
        ) : null}
        <form.Field name="emailVerified">
          {(field) => (
            <Field orientation="horizontal">
              <Switch
                checked={field.state.value}
                id="admin-create-email-verified"
                onCheckedChange={field.handleChange}
              />
              <FieldContent>
                <FieldLabel htmlFor="admin-create-email-verified">
                  {config.localization.emailVerified}
                </FieldLabel>
              </FieldContent>
            </Field>
          )}
        </form.Field>
        {additionalFields.map((configuredField) => (
          <form.AppField
            key={configuredField.name}
            name={`additionalFields.${configuredField.name}`}
            validators={getAuthAdditionalFieldValidators(
              configuredField,
              auth.localization.auth.fieldRequired,
            )}
          >
            {(field) => (
              <field.AuthFormAdditionalField
                field={configuredField}
                isPending={createUser.isPending}
              />
            )}
          </form.AppField>
        ))}
      </FieldGroup>
    </form.AuthFormRoot>
  );
}
