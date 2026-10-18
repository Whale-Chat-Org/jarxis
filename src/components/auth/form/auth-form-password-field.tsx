'use client';

import type { ComponentProps, ReactNode } from 'react';

import { PasswordInput } from '@/components/auth/password/password-input';
import { PasswordStrengthMeter } from '@/components/auth/password/password-strength-meter';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isAuthFormFieldInvalid } from '@/lib/auth/auth-form-utils';
import { useFieldContext } from './auth-form-context';
import { AuthFormFieldError } from './auth-form-field-error';

type AuthFormPasswordFieldProps = Omit<
  ComponentProps<typeof PasswordInput>,
  'name' | 'onBlur' | 'onChange' | 'value'
> & {
  label: ReactNode;
  /** Replaces the validator errors, e.g. a compromised-password rejection from the server. */
  error?: ReactNode;
  /** Renders a skeleton in place of the input while the data it depends on loads. */
  isLoading?: boolean;
  /** Shows the strength meter under the input for a new password. */
  showStrength?: boolean;
  onValueChange?: (value: string) => void;
};

/** Labelled password input with a visibility toggle, bound to the current string field. */
export function AuthFormPasswordField({
  error,
  id,
  isLoading,
  label,
  onValueChange,
  showStrength,
  ...props
}: AuthFormPasswordFieldProps) {
  const field = useFieldContext<string>();
  const isInvalid = isAuthFormFieldInvalid(field.state.meta) || Boolean(error);
  const inputId = id ?? field.name;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>

      {isLoading ? (
        <Skeleton>
          <Input className="invisible" />
        </Skeleton>
      ) : (
        <PasswordInput
          {...props}
          aria-invalid={isInvalid}
          id={inputId}
          name={field.name}
          onBlur={field.handleBlur}
          onChange={(event) => {
            field.handleChange(event.target.value);
            onValueChange?.(event.target.value);
          }}
          value={field.state.value}
        />
      )}

      {error ? <FieldError>{error}</FieldError> : <AuthFormFieldError />}

      {showStrength ? <PasswordStrengthMeter password={field.state.value} /> : null}
    </Field>
  );
}
