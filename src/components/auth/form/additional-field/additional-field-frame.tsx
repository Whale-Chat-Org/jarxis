import { getFormFieldErrors } from '@better-auth-ui/core';
import type { ReactNode } from 'react';

import { Field, FieldError, FieldLabel } from '@/components/ui/field';

type AdditionalFieldFrameProps = {
  /** Id of the control the label points at. */
  htmlFor: string;
  label: ReactNode;
  isInvalid?: boolean;
  errors?: unknown[];
  children: ReactNode;
};

/** Label above, control, then validation errors: the layout shared by the stacked field types. */
export function AdditionalFieldFrame({
  htmlFor,
  label,
  isInvalid,
  errors,
  children,
}: AdditionalFieldFrameProps) {
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      <FieldError errors={getFormFieldErrors(errors ?? [])} />
    </Field>
  );
}
