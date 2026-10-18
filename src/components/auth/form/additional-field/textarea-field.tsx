'use client';

import { Textarea } from '@/components/ui/textarea';
import { valueToString } from '@/lib/auth/additional-field-values';
import type { AdditionalFieldProps } from './additional-field';
import { AdditionalFieldFrame } from './additional-field-frame';

export function TextareaField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  return (
    <AdditionalFieldFrame htmlFor={name} label={field.label} isInvalid={isInvalid} errors={errors}>
      <Textarea
        id={name}
        name={name}
        value={valueToString(value)}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value || null)}
        placeholder={field.placeholder}
        required={field.required}
        readOnly={field.readOnly}
        disabled={isPending}
        aria-invalid={isInvalid}
      />
    </AdditionalFieldFrame>
  );
}
