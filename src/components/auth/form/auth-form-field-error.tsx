'use client';

import { getFormFieldErrors } from '@better-auth-ui/core';

import { FieldError } from '@/components/ui/field';
import { isAuthFormFieldInvalid } from '@/lib/auth/auth-form-utils';
import { useFieldContext } from './auth-form-context';

/** Validator errors for the current field, shown once it has been touched. */
export function AuthFormFieldError() {
  const field = useFieldContext<unknown>();

  if (!isAuthFormFieldInvalid(field.state.meta)) return null;

  const errors = getFormFieldErrors(field.state.meta.errors);

  return errors.length > 0 ? <FieldError errors={errors} /> : null;
}
