'use client';

import { Input } from '@/components/ui/input';
import { getFractionStep, getNumericInputMode } from '@/lib/auth/additional-field-values';
import type { AdditionalFieldProps } from './additional-field';
import { AdditionalFieldFrame } from './additional-field-frame';

export function NumberField({
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
      <Input
        id={name}
        name={name}
        type="number"
        inputMode={getNumericInputMode(field)}
        min={field.min}
        max={field.max}
        step={field.step ?? getFractionStep(field)}
        value={typeof value === 'number' ? value : ''}
        onBlur={onBlur}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : event.target.valueAsNumber)
        }
        placeholder={field.placeholder}
        required={field.required}
        readOnly={field.readOnly}
        disabled={isPending}
        aria-invalid={isInvalid}
      />
    </AdditionalFieldFrame>
  );
}
