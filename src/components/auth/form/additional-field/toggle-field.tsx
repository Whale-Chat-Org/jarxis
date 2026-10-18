'use client';

import { getFormFieldErrors, resolveInputType } from '@better-auth-ui/core';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldError, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import type { AdditionalFieldProps } from './additional-field';

/** Switch or checkbox with the label beside it, for boolean fields. */
export function ToggleField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  const controlProps = {
    id: name,
    name,
    checked: value === true,
    onBlur,
    disabled: isPending || field.readOnly,
    'aria-invalid': isInvalid,
  };

  return (
    <Field data-invalid={isInvalid} orientation="horizontal">
      {resolveInputType(field) === 'switch' ? (
        <Switch {...controlProps} onCheckedChange={onChange} />
      ) : (
        <Checkbox
          {...controlProps}
          onCheckedChange={(checked) => onChange(checked === true)}
          required={field.required}
        />
      )}

      <FieldContent>
        <FieldLabel htmlFor={name}>{field.label}</FieldLabel>
      </FieldContent>
      <FieldError errors={getFormFieldErrors(errors ?? [])} />
    </Field>
  );
}
