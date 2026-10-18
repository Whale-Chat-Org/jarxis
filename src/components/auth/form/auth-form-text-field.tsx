'use client';

import type { ComponentProps, ReactNode } from 'react';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clearAuthFormFieldServerError, isAuthFormFieldInvalid } from '@/lib/auth/auth-form-utils';
import { useFieldContext, useFormContext } from './auth-form-context';
import { AuthFormFieldError } from './auth-form-field-error';

type AuthFormTextFieldProps = Omit<
  ComponentProps<typeof Input>,
  'name' | 'onBlur' | 'onChange' | 'value'
> & {
  description?: ReactNode;
  label: ReactNode;
};

/** Labelled text input bound to the current string field. */
export function AuthFormTextField({ description, id, label, ...props }: AuthFormTextFieldProps) {
  const field = useFieldContext<string>();
  const form = useFormContext();
  const isInvalid = isAuthFormFieldInvalid(field.state.meta);
  const inputId = id ?? field.name;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        {...props}
        aria-busy={field.state.meta.isValidating || undefined}
        aria-invalid={isInvalid}
        id={inputId}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(event) => {
          clearAuthFormFieldServerError(form, field.name);
          field.handleChange(event.target.value);
        }}
        value={field.state.value}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <AuthFormFieldError />
    </Field>
  );
}
