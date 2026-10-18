'use client';

import { type AdditionalFieldFormValue, getFormFieldErrors } from '@better-auth-ui/core';

import { clearAuthFormFieldServerError, isAuthFormFieldInvalid } from '@/lib/auth/auth-form-utils';
import { AdditionalField, type AdditionalFieldProps } from './additional-field/additional-field';
import { useFieldContext, useFormContext } from './auth-form-context';

type AuthFormAdditionalFieldProps = Omit<
  AdditionalFieldProps,
  'errors' | 'isInvalid' | 'name' | 'onBlur' | 'onChange' | 'value'
>;

/** A configured additional user field bound to the current form field. */
export function AuthFormAdditionalField(props: AuthFormAdditionalFieldProps) {
  const field = useFieldContext<AdditionalFieldFormValue>();
  const form = useFormContext();
  const isInvalid = isAuthFormFieldInvalid(field.state.meta);

  return (
    <AdditionalField
      {...props}
      errors={isInvalid ? getFormFieldErrors(field.state.meta.errors) : undefined}
      isInvalid={isInvalid}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(value) => {
        clearAuthFormFieldServerError(form, field.name);
        field.handleChange(value);
      }}
      value={field.state.value}
    />
  );
}
