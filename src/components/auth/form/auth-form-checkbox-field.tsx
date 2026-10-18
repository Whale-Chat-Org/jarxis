'use client';

import type { ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { useFieldContext } from './auth-form-context';

type AuthFormCheckboxFieldProps = {
  label: ReactNode;
  disabled?: boolean;
};

/** Checkbox with an inline label, bound to the current boolean field. */
export function AuthFormCheckboxField({ label, disabled }: AuthFormCheckboxFieldProps) {
  const field = useFieldContext<boolean>();

  return (
    <Field className="my-2xs">
      <div className="flex items-center gap-md">
        <Checkbox
          id={field.name}
          name={field.name}
          checked={field.state.value}
          disabled={disabled}
          onCheckedChange={(checked) => field.handleChange(checked === true)}
        />

        <FieldLabel htmlFor={field.name} className="cursor-pointer text-body-sm font-normal">
          {label}
        </FieldLabel>
      </div>
    </Field>
  );
}
