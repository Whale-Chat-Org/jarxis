'use client';

import { getFormFieldErrors } from '@better-auth-ui/core';

import { FieldError } from '@/components/ui/field';
import { useFormContext } from './auth-form-context';

/** Form-level server error set by `setAuthFormServerError`. */
export function AuthFormServerError() {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.errorMap.onServer}>
      {(error) => {
        const formError =
          error && typeof error === 'object' && 'form' in error ? error.form : error;
        const errors = getFormFieldErrors(formError ? [formError] : []);
        return errors.length > 0 ? <FieldError errors={errors} /> : null;
      }}
    </form.Subscribe>
  );
}
