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
import { Switch } from '@/components/ui/switch';
import type { InspectorProfileFieldsState } from '@/types/admin-users';
export function UserProfileForm({
  state,
  formId,
}: {
  state: InspectorProfileFieldsState;
  formId: string;
}) {
  const {
    profileForm,
    config,
    recordMode,
    canUpdate,
    canSetEmail,
    roles,
    isSelf,
    canSetRole,
    configuredUserFields,
    auth,
    updateUser,
  } = state;
  return (
    <profileForm.AuthFormRoot id={formId}>
      <section className="flex flex-col gap-lg-plus">
        <h3 className="font-medium">{config.localization.profileAndAccess}</h3>
        <FieldGroup className="grid gap-lg-plus">
          <profileForm.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="admin-user-name">{config.localization.name}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    disabled={recordMode === 'view' || !canUpdate.data?.success}
                    id="admin-user-name"
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </InputGroup>
              </Field>
            )}
          </profileForm.Field>
          <profileForm.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="admin-user-email">{config.localization.email}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    disabled={
                      recordMode === 'view' ||
                      !canUpdate.data?.success ||
                      !canSetEmail.data?.success
                    }
                    id="admin-user-email"
                    name={field.name}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                    type="email"
                    value={field.state.value}
                  />
                </InputGroup>
              </Field>
            )}
          </profileForm.Field>
          <profileForm.Field name="emailVerified">
            {(field) => (
              <Field orientation="horizontal">
                <Switch
                  checked={field.state.value}
                  disabled={
                    recordMode === 'view' || !canUpdate.data?.success || !canSetEmail.data?.success
                  }
                  id="admin-user-email-verified"
                  onCheckedChange={field.handleChange}
                />
                <FieldContent>
                  <FieldLabel htmlFor="admin-user-email-verified">
                    {config.localization.emailVerified}
                  </FieldLabel>
                </FieldContent>
              </Field>
            )}
          </profileForm.Field>

          <FieldSet>
            <FieldLegend variant="label">{config.localization.role}</FieldLegend>
            <profileForm.Field name="roles">
              {(field) => (
                <RolePicker
                  roles={roles}
                  value={field.state.value}
                  onChange={(next) => {
                    if (next.length) field.handleChange(next);
                  }}
                  multiple={config.allowMultipleRoles}
                  disabled={recordMode === 'view' || isSelf || !canSetRole.data?.success}
                  label={config.localization.role}
                  idPrefix="admin-user-role"
                />
              )}
            </profileForm.Field>
          </FieldSet>
          {configuredUserFields.map((configuredField) => (
            <profileForm.AppField
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
                  isPending={
                    recordMode === 'view' || updateUser.isPending || !canUpdate.data?.success
                  }
                />
              )}
            </profileForm.AppField>
          ))}
        </FieldGroup>
      </section>
    </profileForm.AuthFormRoot>
  );
}
